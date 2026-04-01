import io
import uuid
from copy import copy, deepcopy
from itertools import product
from os import PathLike
from typing import Any, Generator

from fontTools.colorLib import unbuilder as colrUnbuilder
from fontTools.misc.fixedTools import fixedToFloat
from fontTools.misc.psCharStrings import SimpleT2Decompiler
from fontTools.pens.pointPen import GuessSmoothPointPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.otTables import NO_VARIATION_INDEX
from fontTools.varLib.models import piecewiseLinearMap
from fontTools.varLib.varStore import VarStoreInstancer

from ..core.classes import (
    Axes,
    CrossAxisMapping,
    DiscreteFontAxis,
    FontAxis,
    FontInfo,
    FontSource,
    GlyphSource,
    Kerning,
    Layer,
    LineMetric,
    OpenTypeFeatures,
    RGBAColor,
    ShaperFontData,
    ShaperFontGlyphOrderSorting,
    StaticGlyph,
    VariableGlyph,
)
from ..core.instancer import FontSourcesInstancer
from ..core.path import PackedPath, PackedPathPointPen
from ..core.protocols import ReadableFontBackend
from ..core.varutils import locationToTuple, unnormalizeLocation, unnormalizeValue
from .base import ReadableBaseBackend
from .filewatcher import Change
from .watchable import WatchableBackend

shaperFontTables = {
    "fvar",
    "head",
    "maxp",
    "name",
    "GDEF",
    "GSUB",
    "GPOS",
    "BASE",
    "post",
}


def _convertPaintGraphToFontra(paint: dict) -> dict:
    """
    Recursively convert a fontTools COLRv1 paint graph (PascalCase keys, Format integers)
    into Fontra format (camelCase keys, type strings).
    """
    if not isinstance(paint, dict):
        return paint

    fmt = paint.get("Format")

    # ── PaintColrLayers (fmt 1) ──────────────────────────────────────────
    if fmt == 1:
        return {
            "type": "PaintColrLayers",
            "layers": [
                _convertPaintGraphToFontra(layer) for layer in paint.get("Layers", [])
            ],
        }

    # ── PaintSolid (fmt 2) ──────────────────────────────────────────────
    if fmt == 2:
        return {
            "type": "PaintSolid",
            "colorIndex": paint.get("Color", {}).get("PaletteIndex", 0),
            "alpha": paint.get("Color", {}).get("Alpha", 1.0),
        }

    # ── PaintLinearGradient (fmt 4) ─────────────────────────────────────
    if fmt == 4:
        return {
            "type": "PaintLinearGradient",
            "colorLine": _convertColorLine(paint.get("ColorLine", {})),
            "x0": paint.get("x0", 0),
            "y0": paint.get("y0", 0),
            "x1": paint.get("x1", 0),
            "y1": paint.get("y1", 0),
            "x2": paint.get("x2", 0),
            "y2": paint.get("y2", 0),
        }

    # ── PaintRadialGradient (fmt 6) ─────────────────────────────────────
    if fmt == 6:
        return {
            "type": "PaintRadialGradient",
            "colorLine": _convertColorLine(paint.get("ColorLine", {})),
            "x0": paint.get("x0", 0),
            "y0": paint.get("y0", 0),
            "r0": paint.get("r0", 0),
            "x1": paint.get("x1", 0),
            "y1": paint.get("y1", 0),
            "r1": paint.get("r1", 0),
        }

    # ── PaintSweepGradient (fmt 8) ──────────────────────────────────────
    if fmt == 8:
        return {
            "type": "PaintSweepGradient",
            "colorLine": _convertColorLine(paint.get("ColorLine", {})),
            "centerX": paint.get("centerX", 0),
            "centerY": paint.get("centerY", 0),
            "startAngle": paint.get("startAngle", 0) / 360,
            "endAngle": paint.get("endAngle", 0) / 360,
        }

    # ── PaintGlyph (fmt 10) ─────────────────────────────────────────────
    if fmt == 10:
        return {
            "type": "PaintGlyph",
            "glyph": paint.get("Glyph", ""),  # ← Fontra uses "glyph"
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
        }

    # ── PaintColrGlyph (fmt 11) ─────────────────────────────────────────
    if fmt == 11:
        return {
            "type": "PaintColrGlyph",
            "glyph": paint.get("Glyph", ""),
        }

    # ── PaintTransform (fmt 12) ─────────────────────────────────────────
    if fmt == 12:
        t = paint.get("Transform", {})
        return {
            "type": "PaintTransform",
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "transform": {
                "xx": t.get("xx", 1),
                "yx": t.get("yx", 0),
                "xy": t.get("xy", 0),
                "yy": t.get("yy", 1),
                "dx": t.get("dx", 0),
                "dy": t.get("dy", 0),
            },
        }

    # ── PaintTranslate (fmt 14) ─────────────────────────────────────────
    if fmt == 14:
        return {
            "type": "PaintTranslate",
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "dx": paint.get("dx", 0),
            "dy": paint.get("dy", 0),
        }

    # ── PaintComposite (fmt 32) ─────────────────────────────────────────
    if fmt == 32:
        return {
            "type": "PaintComposite",
            "mode": paint.get("CompositeMode", "src_over"),
            "sourcePaint": _convertPaintGraphToFontra(paint.get("SourcePaint", {})),
            "backdropPaint": _convertPaintGraphToFontra(paint.get("BackdropPaint", {})),
        }

    # ── Unknown / passthrough ────────────────────────────────────────────
    return paint


def _convertColorLine(colorLine: dict) -> dict:
    return {
        "extend": colorLine.get("Extend", "pad"),
        "colorStops": [
            {
                "offset": s.get("StopOffset", 0),
                "colorIndex": s.get("Color", {}).get("PaletteIndex", 0),
                "alpha": s.get("Color", {}).get("Alpha", 1.0),
            }
            for s in colorLine.get("ColorStop", [])
        ],
    }


def _collectPaintGlyphNames(paint: dict, result: list) -> None:
    """Recursively collect glyph names from Fontra-format paint graph."""
    if not isinstance(paint, dict):
        return
    if paint.get("type") == "PaintGlyph":
        name = paint.get("glyph", "")
        if name and name not in result:
            result.append(name)
    for value in paint.values():
        if isinstance(value, dict):
            _collectPaintGlyphNames(value, result)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _collectPaintGlyphNames(item, result)


class OTFBackend(WatchableBackend, ReadableBaseBackend):
    @classmethod
    def fromPath(cls, path: PathLike) -> ReadableFontBackend:
        return cls(path=path)

    def __init__(self, *, path: PathLike) -> None:
        super().__init__()
        self._initializeFromPath(path)

    def _initializeFromPath(self, path: PathLike) -> None:
        self.path = path
        self.font = self._loadFontFromPath(path)
        self._initialize()

    def _loadFontFromPath(self, path: PathLike) -> TTFont:
        return TTFont(path, lazy=True)

    def _initialize(self) -> None:
        self.axes = unpackAxes(self.font)
        fontAxes: list[FontAxis] = [
            axis for axis in self.axes.axes if isinstance(axis, FontAxis)
        ]
        self.fontSources = unpackFontSources(self.font, fontAxes)
        self.fontSourcesInstancer = FontSourcesInstancer(
            fontAxes=self.axes.axes, fontSources=self.fontSources
        )

        gvar = self.font.get("gvar")
        self.gvarVariations = gvar.variations if gvar is not None else None
        varc = self.font.get("VARC")
        self.varcTable = varc.table if varc is not None else None
        self.charStrings = (
            list(self.font["CFF2"].cff.values())[0].CharStrings
            if "CFF2" in self.font
            else None
        )
        self.characterMap = self.font.getBestCmap()
        glyphMap: dict[str, list[int]] = {}
        for glyphName in self.font.getGlyphOrder():
            glyphMap[glyphName] = []
        for code, glyphName in sorted(self.characterMap.items()):
            glyphMap[glyphName].append(code)
        self.glyphMap = glyphMap
        self.glyphSet = self.font.getGlyphSet()
        self.variationGlyphSets: dict[str, Any] = {}
        # COLR / CPAL
        self.colrVersion: int = 0
        self.colrV0Layers: dict[str, list[tuple[str, int]]] = {}
        self.colrPaintGraphs: dict[str, Any] = {}
        self.colrLayerList: list[Any] = []
        self.colrVarIndexMap: list[Any] = []
        self.colrVarStore: dict[str, Any] = {}
        self.colorPalettes: list[list[RGBAColor]] = []
        self.colrGlyphPaintEntries: dict[str, list[dict]] = {}

        colrTable = self.font.get("COLR")
        if colrTable is not None:
            self.colrVersion = colrTable.version
            if self.colrVersion == 0:
                for baseGlyph, layerRecords in colrTable.ColorLayers.items():
                    self.colrV0Layers[baseGlyph] = [
                        (layer.name, layer.colorID) for layer in layerRecords
                    ]
            elif self.colrVersion >= 1:
                colr = colrTable.table
                # unbuildColrV1 returns {baseGlyphName: paintDict} for all base glyphs
                self.colrPaintGraphs = colrUnbuilder.unbuildColrV1(
                    colr.LayerList, colr.BaseGlyphList
                )
                # Build reverse index: component glyph → paint entries referencing it
                self.colrGlyphPaintEntries: dict[str, list[dict]] = {}
                for paintGraph in self.colrPaintGraphs.values():
                    _indexPaintGlyphs(paintGraph, self.colrGlyphPaintEntries)
                if getattr(colr, "VarIndexMap", None):
                    self.colrVarIndexMap = list(colr.VarIndexMap.mapping)
                if getattr(colr, "VarStore", None):
                    self.colrVarStore = _serializeVarStore(colr.VarStore)

        cpalTable = self.font.get("CPAL")
        print("CPAL table:", cpalTable)
        print("CPAL version:", getattr(cpalTable, "version", None))
        print("CPAL palettes:", getattr(cpalTable, "palettes", None))
        print("CPAL numPaletteEntries:", getattr(cpalTable, "numPaletteEntries", None))
        if cpalTable is not None:
            for palette in cpalTable.palettes:
                self.colorPalettes.append(
                    [
                        RGBAColor(
                            red=color.red / 255,
                            green=color.green / 255,
                            blue=color.blue / 255,
                            alpha=color.alpha / 255,
                        )
                        for color in palette
                    ]
                )

    async def aclose(self) -> None:
        self.font.close()

    async def getGlyphMap(self) -> dict[str, list[int]]:
        return self.glyphMap

    async def getGlyph(self, glyphName: str) -> VariableGlyph | None:
        if glyphName not in self.glyphSet:
            return None

        defaultSourceIdentifier = self.fontSourcesInstancer.defaultSourceIdentifier
        assert defaultSourceIdentifier is not None
        defaultLayerName = defaultSourceIdentifier

        glyph = VariableGlyph(name=glyphName)
        staticGlyph = buildStaticGlyph(self.glyphSet, glyphName)
        layers = {defaultLayerName: Layer(glyph=staticGlyph)}
        defaultLocation = {axis.name: 0 for axis in self.axes.axes}
        sources = [
            GlyphSource(
                location={},
                locationBase=defaultSourceIdentifier,
                name="",
                layerName=defaultLayerName,
            )
        ]

        for sparseLoc in self._getGlyphVariationLocations(glyphName):
            fullLoc = defaultLocation | sparseLoc
            locStr = locationToString(unnormalizeLocation(sparseLoc, self.axes.axes))
            varGlyphSet = self.variationGlyphSets.get(locStr)
            if varGlyphSet is None:
                varGlyphSet = self.font.getGlyphSet(location=fullLoc, normalized=True)
                self.variationGlyphSets[locStr] = varGlyphSet
            varGlyph = buildStaticGlyph(varGlyphSet, glyphName)

            sourceLocation = unnormalizeLocation(fullLoc, self.axes.axes)
            locationBase = self.fontSourcesInstancer.getSourceIdentifierForLocation(
                sourceLocation
            )
            layerName = locationBase if locationBase is not None else locStr
            layers[layerName] = Layer(glyph=varGlyph)

            sources.append(
                GlyphSource(
                    location={} if locationBase is not None else sourceLocation,
                    locationBase=locationBase,
                    name="" if locationBase is not None else locStr,
                    layerName=layerName,
                )
            )
        if self.charStrings is not None:
            checkAndFixCFF2Compatibility(glyphName, layers)
        glyph.layers = layers
        glyph.sources = sources
        # Attach COLRv0 layer list to customData
        if glyphName in self.colrV0Layers:
            glyph.customData["fontra.colrv0.layers"] = self.colrV0Layers[glyphName]

        # Attach COLRv1 paint graph to customData (converted to Fontra format)
        if glyphName in self.colrPaintGraphs:
            fontraPaint = _convertPaintGraphToFontra(self.colrPaintGraphs[glyphName])
            glyph.customData["fontra.colrv1.paintGraph"] = fontraPaint

            referencedGlyphs = []
            _collectPaintGlyphNames(fontraPaint, referencedGlyphs)
            if referencedGlyphs:
                glyph.customData["fontra.colrv1.referencedGlyphs"] = referencedGlyphs
        elif (
            hasattr(self, "colrGlyphPaintEntries")
            and glyphName in self.colrGlyphPaintEntries
        ):
            entries = self.colrGlyphPaintEntries[glyphName]
            # Wrap entries in PaintColrLayers if multiple, or use directly if single
            if len(entries) == 1:
                rawPaint = entries[0]
            else:
                rawPaint = {"Format": 1, "Layers": entries}
            fontraPaint = _convertPaintGraphToFontra(rawPaint)
            glyph.customData["fontra.colrv1.paintGraph"] = fontraPaint

        return glyph

    def _getGlyphVariationLocations(self, glyphName: str) -> list[dict[str, float]]:
        # TODO/FIXME: This misses variations that only exist in HVAR/VVAR
        locations = set()

        if self.gvarVariations is not None and glyphName in self.gvarVariations:
            locations |= {
                tuple(sorted(coords))
                for variation in self.gvarVariations[glyphName]
                for coords in product(
                    *(
                        [(k, v) for v in sorted(set(tent)) if v]
                        for k, tent in variation.axes.items()
                    )
                )
            }

        if self.varcTable is not None:
            fvarAxes = self.font["fvar"].axes
            varStore = self.varcTable.MultiVarStore
            try:
                index = self.varcTable.Coverage.glyphs.index(glyphName)
            except ValueError:
                pass
            else:
                composite = self.varcTable.VarCompositeGlyphs.VarCompositeGlyph[index]
                for component in composite.components:
                    if component.axisValuesVarIndex != NO_VARIATION_INDEX:
                        locations.update(
                            locationToTuple(loc)
                            for loc in getLocationsFromMultiVarstore(
                                component.axisValuesVarIndex >> 16, varStore, fvarAxes
                            )
                        )
                    if component.transformVarIndex != NO_VARIATION_INDEX:
                        locations.update(
                            locationToTuple(loc)
                            for loc in getLocationsFromMultiVarstore(
                                component.transformVarIndex >> 16, varStore, fvarAxes
                            )
                        )

        if (
            self.charStrings is not None
            and glyphName in self.charStrings
            and getattr(self.charStrings, "varStore", None) is not None
        ):
            cs = self.charStrings[glyphName]
            subrs = getattr(cs.private, "Subrs", [])
            collector = VarIndexCollector(subrs, cs.globalSubrs, cs.private)
            collector.execute(cs)
            vsIndices = sorted(collector.vsIndices)
            fvarAxes = self.font["fvar"].axes
            varStore = self.charStrings.varStore.otVarStore
            locations |= {
                locationToTuple(loc)
                for varDataIndex in vsIndices
                for loc in getLocationsFromVarstore(varStore, fvarAxes, varDataIndex)
            }

        return [dict(loc) for loc in sorted(locations)]

    async def getFontInfo(self) -> FontInfo:
        return FontInfo()

    async def getAxes(self) -> Axes:
        return self.axes

    async def getSources(self) -> dict[str, FontSource]:
        return self.fontSources

    async def getUnitsPerEm(self) -> int:
        return self.font["head"].unitsPerEm

    async def getKerning(self) -> dict[str, Kerning]:
        # TODO: extract kerning from GPOS
        return {}

    async def getFeatures(self) -> OpenTypeFeatures:
        # TODO: do best effort of reading GSUB/GPOS with fontFeatures
        return OpenTypeFeatures()

    async def getCustomData(self) -> dict[str, Any]:
        data: dict[str, Any] = {}
        if self.colrV0Layers:
            data["com.github.googlei18n.ufo2ft.colorLayers"] = self.colrV0Layers
        if self.colorPalettes:
            data["com.github.googlei18n.ufo2ft.colorPalettes"] = [
                [(c.red, c.green, c.blue, c.alpha) for c in palette]
                for palette in self.colorPalettes
            ]
        if self.colrVarIndexMap:
            data["fontra.colrv1.varIndexMap"] = self.colrVarIndexMap
        if self.colrVarStore:
            data["fontra.colrv1.varStore"] = self.colrVarStore
        return data

    async def getColorPalettes(self) -> list[list[RGBAColor]]:
        return self.colorPalettes

    async def getShaperFontData(self) -> ShaperFontData | None:
        with self._getShaperFont() as font:
            for tableTag in font.keys():
                if tableTag not in shaperFontTables:
                    del font[tableTag]

            f = io.BytesIO()
            font.save(f)

        data = f.getvalue()

        return ShaperFontData(
            glyphOrderSorting=ShaperFontGlyphOrderSorting.FROMGLYPHMAP, data=data
        )

    def _getShaperFont(self):
        return self._loadFontFromPath(self.path)

    async def fileWatcherProcessChanges(
        self, changes: set[tuple[Change, str]]
    ) -> dict[str, Any] | None:
        self._initializeFromPath(self.path)
        return None  # Reload all

    def fileWatcherWasInstalled(self) -> None:
        self.fileWatcherSetPaths([self.path])


class TTXBackend(OTFBackend):
    def _loadFontFromPath(self, path: PathLike) -> TTFont:
        font = TTFont()
        font.importXML(path)
        return font

    def _getShaperFont(self):
        font = copy(self.font)  # shallow copy
        font.tables = dict(font.tables)  # shallow copy tables dict for table subsetting
        return font


def getLocationsFromVarstore(
    varStore, fvarAxes, varDataIndex: int | None = None
) -> Generator[dict[str, float], None, None]:
    regions = varStore.VarRegionList.Region
    varDatas = (
        [varStore.VarData[varDataIndex]]
        if varDataIndex is not None
        else varStore.VarData
    )
    for varData in varDatas:
        for regionIndex in varData.VarRegionIndex:
            location = {
                fvarAxes[i].axisTag: reg.PeakCoord
                for i, reg in enumerate(regions[regionIndex].VarRegionAxis)
                if reg.PeakCoord != 0
            }
            yield location


def getLocationsFromMultiVarstore(
    varDataIndex: int, varStore, fvarAxes
) -> Generator[dict[str, float], None, None]:
    regions = varStore.SparseVarRegionList.Region
    for regionIndex in varStore.MultiVarData[varDataIndex].VarRegionIndex:
        location = {
            fvarAxes[reg.AxisIndex].axisTag: reg.PeakCoord
            for reg in regions[regionIndex].SparseVarRegionAxis
            # if reg.PeakCoord != 0
        }
        yield location


def unpackAxes(font: TTFont) -> Axes:
    fvar = font.get("fvar")
    if fvar is None:
        return Axes()
    nameTable = font["name"]
    avar = font.get("avar")
    avarMapping = (
        {k: sorted(v.items()) for k, v in avar.segments.items()}
        if avar is not None
        else {}
    )
    axisList: list[FontAxis | DiscreteFontAxis] = []
    for axis in fvar.axes:
        normMin = -1 if axis.minValue < axis.defaultValue else 0
        normMax = 1 if axis.maxValue > axis.defaultValue else 0
        mapping = avarMapping.get(axis.axisTag, [])
        if mapping:
            mapping = [
                [
                    unnormalizeValue(
                        inValue, axis.minValue, axis.defaultValue, axis.maxValue
                    ),
                    unnormalizeValue(
                        outValue, axis.minValue, axis.defaultValue, axis.maxValue
                    ),
                ]
                for inValue, outValue in mapping
                if normMin <= outValue <= normMax
            ]

            if all([inValue == outValue for inValue, outValue in mapping]):
                mapping = []

        axisNameRecord = nameTable.getName(axis.axisNameID, 3, 1, 0x409)
        axisName = (
            axisNameRecord.toUnicode() if axisNameRecord is not None else axis.axisTag
        )
        axisList.append(
            FontAxis(
                minValue=axis.minValue,
                defaultValue=axis.defaultValue,
                maxValue=axis.maxValue,
                label=axisName,
                name=axis.axisTag,  # Fontra identifies axes by name
                tag=axis.axisTag,
                mapping=mapping,
                hidden=bool(axis.flags & 0x0001),  # HIDDEN_AXIS
            )
        )

    mappings = []

    if avar is not None and avar.majorVersion >= 2:
        fvarAxes = fvar.axes
        varStore = avar.table.VarStore
        varIdxMap = avar.table.VarIdxMap

        locations = set()
        for varIdx in varIdxMap.mapping:
            if varIdx == NO_VARIATION_INDEX:
                continue

            for loc in getLocationsFromVarstore(varStore, fvarAxes, varIdx >> 16):
                locations.add(locationToTuple(loc))

        for locTuple in sorted(locations):
            inputLocation = dict(locTuple)
            instancer = VarStoreInstancer(varStore, fvarAxes, inputLocation)

            outputLocation = {}
            for i, varIdx in enumerate(varIdxMap.mapping):
                if varIdx == NO_VARIATION_INDEX:
                    continue

                outputLocation[fvarAxes[i].axisTag] = fixedToFloat(
                    instancer[varIdx], 14
                )

            mappings.append(
                CrossAxisMapping(
                    inputLocation=unnormalizeLocation(inputLocation, axisList),
                    outputLocation=unnormalizeLocation(outputLocation, axisList),
                )
            )

    return Axes(axes=axisList, mappings=mappings)


MVAR_MAPPING = {
    "hasc": ("lineMetricsHorizontalLayout", "ascender"),
    "hdsc": ("lineMetricsHorizontalLayout", "descender"),
    "cpht": ("lineMetricsHorizontalLayout", "capHeight"),
    "xhgt": ("lineMetricsHorizontalLayout", "xHeight"),
}


def unpackFontSources(
    font: TTFont, fontraAxes: list[FontAxis]
) -> dict[str, FontSource]:
    nameTable = font["name"]
    fvarTable = font.get("fvar")
    fvarAxes = fvarTable.axes if fvarTable is not None else []
    fvarInstances = unpackFVARInstances(font)

    defaultSourceIdentifier = makeSourceIdentifier(0)
    defaultLocation = {axis.axisTag: axis.defaultValue for axis in fvarAxes}

    defaultSourceName = findNameForLocationFromInstances(
        mapLocationBackward(defaultLocation, fontraAxes), fvarInstances
    )
    if defaultSourceName is None:
        defaultSourceName = getEnglishNameWithFallback(nameTable, [17, 2], "Regular")

    defaultSource = FontSource(name=defaultSourceName)

    postTable = font.get("post")
    if postTable is not None:
        defaultSource.italicAngle = postTable.italicAngle

    locations = set()

    gdefTable = font.get("GDEF")
    if gdefTable is not None and getattr(gdefTable.table, "VarStore", None) is not None:
        locations |= {
            locationToTuple(loc)
            for loc in getLocationsFromVarstore(gdefTable.table.VarStore, fvarAxes)
        }

    lineMetricsH = defaultSource.lineMetricsHorizontalLayout
    lineMetricsH["baseline"] = LineMetric(value=0)

    os2Table = font.get("OS/2")
    if os2Table is not None:
        lineMetricsH = defaultSource.lineMetricsHorizontalLayout
        lineMetricsH["ascender"] = LineMetric(value=os2Table.sTypoAscender)
        lineMetricsH["descender"] = LineMetric(value=os2Table.sTypoDescender)
        lineMetricsH["capHeight"] = LineMetric(value=os2Table.sCapHeight)
        lineMetricsH["xHeight"] = LineMetric(value=os2Table.sxHeight)
    # else:
    #     ...fall back to hhea table?

    mvarTable = font.get("MVAR")
    if mvarTable is not None:
        locations |= {
            locationToTuple(loc)
            for loc in getLocationsFromVarstore(mvarTable.table.VarStore, fvarAxes)
        }

    sources = {defaultSourceIdentifier: defaultSource}

    for locationTuple in sorted(locations):
        location = dict(locationTuple)
        source = deepcopy(defaultSource)
        sourceIdentifier = makeSourceIdentifier(len(sources))

        source.location = unnormalizeLocation(location, fontraAxes)

        sourceName = findNameForLocationFromInstances(
            mapLocationBackward(source.location, fontraAxes), fvarInstances
        )
        if sourceName is None:
            sourceName = locationToString(source.location)

        source.name = sourceName

        if os2Table is not None and mvarTable is not None:
            mvarInstancer = VarStoreInstancer(
                mvarTable.table.VarStore, fvarAxes, location
            )
            for rec in mvarTable.table.ValueRecord:
                whichMetrics, metricKey = MVAR_MAPPING.get(rec.ValueTag, (None, None))
                if whichMetrics is not None:
                    getattr(source, whichMetrics)[metricKey].value += mvarInstancer[
                        rec.VarIdx
                    ]

        sources[sourceIdentifier] = source

    return sources


def unpackFVARInstances(font) -> list[tuple[dict[str, float], str]]:
    fvarTable = font.get("fvar")
    if fvarTable is None:
        return []

    nameTable = font["name"]

    instances = []

    for instance in fvarTable.instances:
        name = getEnglishNameWithFallback(nameTable, [instance.subfamilyNameID], "")
        if name:
            instances.append((instance.coordinates, name))

    return instances


def findNameForLocationFromInstances(
    location: dict[str, float], instances: list[tuple[dict[str, float], str]]
) -> str | None:
    axisNames = set(location)

    for instanceLoc, name in instances:
        if axisNames != set(instanceLoc):
            continue

        if all(
            abs(axisValue - instanceLoc[axisName]) < 0.1
            for axisName, axisValue in location.items()
        ):
            return name

    return None


def mapLocationBackward(
    location: dict[str, float], axes: list[FontAxis]
) -> dict[str, float]:
    return {
        axis.name: piecewiseLinearMap(
            location.get(axis.name, axis.defaultValue),
            dict([(b, a) for a, b in axis.mapping]),
        )
        for axis in axes
    }


# Monkeypatch this for deterministic testing
_USE_SOURCE_INDEX_INSTEAD_OF_UUID = False


def makeSourceIdentifier(sourceIndex: int) -> str:
    if _USE_SOURCE_INDEX_INSTEAD_OF_UUID:
        return f"font-source-{sourceIndex}"
    return str(uuid.uuid4())[:8]


def getEnglishNameWithFallback(
    nameTable: Any, nameIDs: list[int], fallback: str
) -> str:
    for nameID in nameIDs:
        nameRecord = nameTable.getName(nameID, 3, 1, 0x409)
        if nameRecord is not None:
            return nameRecord.toUnicode()

    return fallback


def buildStaticGlyph(glyphSet, glyphName: str) -> StaticGlyph:
    pen = PackedPathPointPen()
    ttGlyph = glyphSet[glyphName]
    ttGlyph.drawPoints(GuessSmoothPointPen(pen))
    path = pen.getPath()
    staticGlyph = StaticGlyph()
    staticGlyph.path = path
    staticGlyph.components = pen.components
    staticGlyph.xAdvance = ttGlyph.width
    # TODO: yAdvance, verticalOrigin
    return staticGlyph


def _serializeVarStore(varStore) -> dict:
    """Serialize a COLR VarStore to a JSON-safe dict for storage in customData."""
    regions = []
    for region in varStore.VarRegionList.Region:
        axes = [
            {
                "startCoord": ax.StartCoord,
                "peakCoord": ax.PeakCoord,
                "endCoord": ax.EndCoord,
            }
            for ax in region.VarRegionAxis
        ]
        regions.append(axes)

    varDataList = []
    for varData in varStore.VarData:
        varDataList.append(
            {
                "numShorts": varData.NumShorts,
                "varRegionIndex": list(varData.VarRegionIndex),
                "items": [list(item) for item in varData.Item],
            }
        )

    return {"regions": regions, "varData": varDataList}


def _indexPaintGlyphs(paint: dict, index: dict[str, list[dict]]) -> None:
    """Recursively walk an unbuilt paint dict and index all PaintGlyph nodes."""
    if not isinstance(paint, dict):
        return
    if paint.get("Format") == 10:  # PaintGlyph
        glyphName = paint.get("Glyph")
        if glyphName:
            if glyphName not in index:
                index[glyphName] = []
            index[glyphName].append(paint)
    for value in paint.values():
        if isinstance(value, dict):
            _indexPaintGlyphs(value, index)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _indexPaintGlyphs(item, index)


def locationToString(loc: dict[str, float]) -> str:
    parts = []
    for k, v in sorted(loc.items()):
        v = round(v, 5)  # enough to differentiate all 2.14 fixed values
        iv = int(v)
        if iv == v:
            v = iv
        parts.append(f"{k}={v}")
    return ",".join(parts)


class VarIndexCollector(SimpleT2Decompiler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.vsIndices = set()

    def op_blend(self, index):
        super().op_blend(index)
        self.vsIndices.add(self.vsIndex)


def checkAndFixCFF2Compatibility(glyphName: str, layers: dict[str, Layer]) -> None:
    #
    # https://github.com/fonttools/fonttools/issues/2838
    #
    # Via ttGlyphSet.py, we're using SegmentToPointPen to convert CFF/T2 segments
    # to points, which normally leads to closing curve-to points being removed.
    #
    # However, as the fonttools issue above shows, in some situations, it does
    # not close onto the starting point at *some* locations, due to rounding errors
    # in the source deltas.
    #
    # This functions detects those cases and compensates for it by appending the
    # starting point at the end of the contours that *do* close nicely.
    #
    # This is a somewhat ugly trade-off to keep interpolation compatibility.
    #
    layerList = list(layers.values())
    firstPath = layerList[0].glyph.packedPath
    firstPointTypes = firstPath.pointTypes
    unpackedContourses: list[list[dict] | None] = [None] * len(layerList)
    contourLengths = None
    unpackedContours: list[dict] | None

    for layerIndex, layer in enumerate(layerList):
        if layer.glyph.packedPath.pointTypes != firstPointTypes:
            if contourLengths is None:
                firstContours = firstPath.unpackedContours()
                unpackedContourses[0] = firstContours
                contourLengths = [len(c["points"]) for c in firstContours]
            unpackedContours = layer.glyph.packedPath.unpackedContours()
            unpackedContourses[layerIndex] = unpackedContours
            assert len(contourLengths) == len(unpackedContours)
            contourLengths = [
                max(cl, len(unpackedContours[i]["points"]))
                for i, cl in enumerate(contourLengths)
            ]

    if contourLengths is None:
        # All good, nothing to do
        return

    for layerIndex, layer in enumerate(layerList):
        if unpackedContourses[layerIndex] is None:
            unpackedContourses[layerIndex] = layer.glyph.packedPath.unpackedContours()
        unpackedContours = unpackedContourses[layerIndex]
        assert unpackedContours is not None

        for i, contourLength in enumerate(contourLengths):
            if len(unpackedContours[i]["points"]) + 1 == contourLength:
                firstPoint = unpackedContours[i]["points"][0]
                firstPoint["smooth"] = False
                unpackedContours[i]["points"].append(firstPoint)
        layer.glyph.path = PackedPath.fromUnpackedContours(unpackedContours)
