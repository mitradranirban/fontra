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
from fontTools.subset import Options, Subsetter
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
    "Debg",
    "GDEF",
    "GSUB",
    "GPOS",
    "BASE",
    "post",
}

_VAR_PAINT_FORMATS = {
    3: (2, (("Alpha", "f2dot14"),)),
    5: (
        4,
        (
            ("x0", "int16"),
            ("y0", "int16"),
            ("x1", "int16"),
            ("y1", "int16"),
            ("x2", "int16"),
            ("y2", "int16"),
        ),
    ),
    7: (
        6,
        (
            ("x0", "int16"),
            ("y0", "int16"),
            ("r0", "int16"),
            ("x1", "int16"),
            ("y1", "int16"),
            ("r1", "int16"),
        ),
    ),
    9: (
        8,
        (
            ("centerX", "int16"),
            ("centerY", "int16"),
            ("startAngle", "angle"),
            ("endAngle", "angle"),
        ),
    ),
    13: (12, ()),
    15: (14, (("dx", "int16"), ("dy", "int16"))),
    17: (16, (("scaleX", "f2dot14"), ("scaleY", "f2dot14"))),
    19: (
        18,
        (
            ("scaleX", "f2dot14"),
            ("scaleY", "f2dot14"),
            ("centerX", "int16"),
            ("centerY", "int16"),
        ),
    ),
    21: (20, (("scale", "f2dot14"),)),
    23: (22, (("scale", "f2dot14"), ("centerX", "int16"), ("centerY", "int16"))),
    25: (24, (("angle", "angle"),)),
    27: (26, (("angle", "angle"), ("centerX", "int16"), ("centerY", "int16"))),
    29: (28, (("xSkewAngle", "angle"), ("ySkewAngle", "angle"))),
    31: (
        30,
        (
            ("xSkewAngle", "angle"),
            ("ySkewAngle", "angle"),
            ("centerX", "int16"),
            ("centerY", "int16"),
        ),
    ),
}


def _convertVarDelta(rawDelta: float, valueType: str) -> float:
    if valueType == "int16":
        return rawDelta
    elif valueType == "f2dot14":
        return fixedToFloat(rawDelta, 14)
    elif valueType == "fixed":
        return fixedToFloat(rawDelta, 16)
    elif valueType == "angle":
        return fixedToFloat(rawDelta, 14) * 180.0
    return rawDelta


def _varIndexAdd(base: int, offset: int) -> int:
    outer = base >> 16
    inner = base & 0xFFFF
    return (outer << 16) | (inner + offset)


def _resolveVarIndex(
    base: int | None, offset: int, varIndexMap: list[int] | None
) -> int | None:
    if base is None or base == 0xFFFFFFFF:
        return None

    if varIndexMap:
        mapIndex = base + offset
        if mapIndex < 0 or mapIndex >= len(varIndexMap):
            return None
        varIndex = varIndexMap[mapIndex]
        if varIndex is None or varIndex == NO_VARIATION_INDEX or varIndex == 0xFFFFFFFF:
            return None
        return varIndex

    return _varIndexAdd(base, offset)


def _applyVarDeltas(
    obj: dict,
    attrs: tuple[tuple[str, str], ...],
    instancer,
    varIndexMap: list[int] | None = None,
) -> dict:
    if not isinstance(obj, dict):
        return obj

    obj = deepcopy(obj)
    base = obj.get("VarIndexBase")

    if base is None or base == 0xFFFFFFFF:
        obj.pop("VarIndexBase", None)
        return obj

    for i, (attr, valueType) in enumerate(attrs):
        varIndex = _resolveVarIndex(base, i, varIndexMap)
        if varIndex is None:
            continue
        rawDelta = instancer[varIndex]
        if rawDelta:
            obj[attr] = obj.get(attr, 0) + _convertVarDelta(rawDelta, valueType)

    obj.pop("VarIndexBase", None)
    return obj


def _instantiateColorStop(
    stop: dict, instancer, varIndexMap: list[int] | None = None
) -> dict:
    if not isinstance(stop, dict):
        return stop
    return _applyVarDeltas(
        stop, (("StopOffset", "f2dot14"), ("Alpha", "f2dot14")), instancer, varIndexMap
    )


def _instantiateColorLine(
    colorLine: dict, instancer, varIndexMap: list[int] | None = None
) -> dict:
    if not isinstance(colorLine, dict):
        return colorLine
    colorLine = deepcopy(colorLine)
    colorLine["ColorStop"] = [
        _instantiateColorStop(stop, instancer, varIndexMap)
        for stop in colorLine.get("ColorStop", [])
    ]
    return colorLine


def _instantiateTransform(
    transform: dict, instancer, varIndexMap: list[int] | None = None
) -> dict:
    if not isinstance(transform, dict):
        return transform
    return _applyVarDeltas(
        transform,
        (
            ("xx", "fixed"),
            ("yx", "fixed"),
            ("xy", "fixed"),
            ("yy", "fixed"),
            ("dx", "fixed"),
            ("dy", "fixed"),
        ),
        instancer,
        varIndexMap,
    )


def _instantiatePaint(
    paint: dict, instancer, varIndexMap: list[int] | None = None
) -> dict:
    if not isinstance(paint, dict):
        return paint

    paint = deepcopy(paint)
    fmt = paint.get("Format")

    if fmt in _VAR_PAINT_FORMATS:
        staticFmt, attrs = _VAR_PAINT_FORMATS[fmt]
        paint = _applyVarDeltas(paint, attrs, instancer, varIndexMap)
        paint["Format"] = staticFmt

    if "Paint" in paint:
        paint["Paint"] = _instantiatePaint(paint["Paint"], instancer, varIndexMap)
    if "SourcePaint" in paint:
        paint["SourcePaint"] = _instantiatePaint(
            paint["SourcePaint"], instancer, varIndexMap
        )
    if "BackdropPaint" in paint:
        paint["BackdropPaint"] = _instantiatePaint(
            paint["BackdropPaint"], instancer, varIndexMap
        )
    if "Layers" in paint:
        paint["Layers"] = [
            _instantiatePaint(p, instancer, varIndexMap) for p in paint["Layers"]
        ]

    if "ColorLine" in paint:
        paint["ColorLine"] = _instantiateColorLine(
            paint["ColorLine"], instancer, varIndexMap
        )

    if "Transform" in paint:
        paint["Transform"] = _instantiateTransform(
            paint["Transform"], instancer, varIndexMap
        )

    paint.pop("VarIndexBase", None)
    return paint


def _collectVarIndicesFromPaint(
    paint: dict, result: set[int], varIndexMap: list[int] | None = None
) -> None:
    if not isinstance(paint, dict):
        return

    fmt = paint.get("Format")
    if fmt in _VAR_PAINT_FORMATS:
        _, attrs = _VAR_PAINT_FORMATS[fmt]
        base = paint.get("VarIndexBase")
        if base is not None and base != 0xFFFFFFFF:
            for i in range(len(attrs)):
                varIndex = _resolveVarIndex(base, i, varIndexMap)
                if varIndex is not None:
                    result.add(varIndex)

    transform = paint.get("Transform")
    if isinstance(transform, dict):
        base = transform.get("VarIndexBase")
        if base is not None and base != 0xFFFFFFFF:
            for i in range(6):
                varIndex = _resolveVarIndex(base, i, varIndexMap)
                if varIndex is not None:
                    result.add(varIndex)

    colorLine = paint.get("ColorLine")
    if isinstance(colorLine, dict):
        for stop in colorLine.get("ColorStop", []):
            if isinstance(stop, dict):
                base = stop.get("VarIndexBase")
                if base is not None and base != 0xFFFFFFFF:
                    for i in range(2):
                        varIndex = _resolveVarIndex(base, i, varIndexMap)
                        if varIndex is not None:
                            result.add(varIndex)

    for key in ("Paint", "SourcePaint", "BackdropPaint"):
        if key in paint:
            _collectVarIndicesFromPaint(paint[key], result, varIndexMap)

    for layer in paint.get("Layers", []):
        _collectVarIndicesFromPaint(layer, result, varIndexMap)


def _convertPaintGraphToFontra(paint: dict) -> dict:
    """
    Recursively convert a fontTools COLRv1 paint graph (PascalCase keys, Format integers)
    into Fontra native format (camelCase keys, type strings).

    This produces the same format that .fontra files use, stored in customData["colorv1"].
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

    # ── PaintSolid (fmt 2) and PaintVarSolid (fmt 3) ────────────────────
    if fmt == 2 or fmt == 3:
        return {
            "type": "PaintSolid" if fmt == 2 else "PaintVarSolid",
            "paletteIndex": paint.get("PaletteIndex", 0),
            "alpha": paint.get("Alpha", 1.0),
        }

    # ── PaintLinearGradient (fmt 4) and PaintVarLinearGradient (fmt 5) ──
    if fmt == 4 or fmt == 5:
        return {
            "type": "PaintLinearGradient" if fmt == 4 else "PaintVarLinearGradient",
            "colorLine": _convertColorLine(paint.get("ColorLine", {})),
            "x0": paint.get("x0", 0),
            "y0": paint.get("y0", 0),
            "x1": paint.get("x1", 0),
            "y1": paint.get("y1", 0),
            "x2": paint.get("x2", 0),
            "y2": paint.get("y2", 0),
        }

    # ── PaintRadialGradient (fmt 6) and PaintVarRadialGradient (fmt 7) ──
    if fmt == 6 or fmt == 7:
        return {
            "type": "PaintRadialGradient" if fmt == 6 else "PaintVarRadialGradient",
            "colorLine": _convertColorLine(paint.get("ColorLine", {})),
            "x0": paint.get("x0", 0),
            "y0": paint.get("y0", 0),
            "r0": paint.get("r0", 0),
            "x1": paint.get("x1", 0),
            "y1": paint.get("y1", 0),
            "r1": paint.get("r1", 0),
        }

    # ── PaintSweepGradient (fmt 8) and PaintVarSweepGradient (fmt 9) ────
    if fmt == 8 or fmt == 9:
        # Convert degrees to turns (0.0 to 1.0 range)
        return {
            "type": "PaintSweepGradient" if fmt == 8 else "PaintVarSweepGradient",
            "colorLine": _convertColorLine(paint.get("ColorLine", {})),
            "centerX": paint.get("centerX", 0),
            "centerY": paint.get("centerY", 0),
            "startAngle": paint.get("startAngle", 0) / 360.0,
            "endAngle": paint.get("endAngle", 0) / 360.0,
        }

    # ── PaintGlyph (fmt 10) ─────────────────────────────────────────────
    if fmt == 10:
        return {
            "type": "PaintGlyph",
            "glyph": paint.get("Glyph", ""),
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
        }

    # ── PaintColrGlyph (fmt 11) ─────────────────────────────────────────
    if fmt == 11:
        return {
            "type": "PaintColrGlyph",
            "glyph": paint.get("Glyph", ""),
        }

    # ── PaintTransform (fmt 12) and PaintVarTransform (fmt 13) ──────────
    if fmt == 12 or fmt == 13:
        t = paint.get("Transform", {})
        return {
            "type": "PaintTransform" if fmt == 12 else "PaintVarTransform",
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "transform": {
                "xx": t.get("xx", 1.0),
                "yx": t.get("yx", 0.0),
                "xy": t.get("xy", 0.0),
                "yy": t.get("yy", 1.0),
                "dx": t.get("dx", 0.0),
                "dy": t.get("dy", 0.0),
            },
        }

    # ── PaintTranslate (fmt 14) and PaintVarTranslate (fmt 15) ──────────
    if fmt == 14 or fmt == 15:
        return {
            "type": "PaintTranslate" if fmt == 14 else "PaintVarTranslate",
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "dx": paint.get("dx", 0.0),
            "dy": paint.get("dy", 0.0),
        }

    # ── PaintScale (fmt 16) and PaintVarScale (fmt 17) ──────────────────
    if fmt == 16 or fmt == 17:
        return {
            "type": "PaintScale" if fmt == 16 else "PaintVarScale",
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "scaleX": paint.get("scaleX", 1.0),
            "scaleY": paint.get("scaleY", 1.0),
        }

    # ── PaintScaleAroundCenter (fmt 18) and PaintVarScaleAroundCenter (fmt 19) ──
    if fmt == 18 or fmt == 19:
        return {
            "type": (
                "PaintScaleAroundCenter" if fmt == 18 else "PaintVarScaleAroundCenter"
            ),
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "scaleX": paint.get("scaleX", 1.0),
            "scaleY": paint.get("scaleY", 1.0),
            "centerX": paint.get("centerX", 0.0),
            "centerY": paint.get("centerY", 0.0),
        }

    # ── PaintScaleUniform (fmt 20) and PaintVarScaleUniform (fmt 21) ────
    if fmt == 20 or fmt == 21:
        return {
            "type": "PaintScaleUniform" if fmt == 20 else "PaintVarScaleUniform",
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "scale": paint.get("scale", 1.0),
        }

    # ── PaintScaleUniformAroundCenter (fmt 22) and PaintVarScaleUniformAroundCenter (fmt 23) ──
    if fmt == 22 or fmt == 23:
        return {
            "type": (
                "PaintScaleUniformAroundCenter"
                if fmt == 22
                else "PaintVarScaleUniformAroundCenter"
            ),
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "scale": paint.get("scale", 1.0),
            "centerX": paint.get("centerX", 0.0),
            "centerY": paint.get("centerY", 0.0),
        }

    # ── PaintRotate (fmt 24) and PaintVarRotate (fmt 25) ────────────────
    if fmt == 24 or fmt == 25:
        # Convert degrees to turns
        return {
            "type": "PaintRotate" if fmt == 24 else "PaintVarRotate",
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "angle": paint.get("angle", 0.0) / 360.0,
        }

    # ── PaintRotateAroundCenter (fmt 26) and PaintVarRotateAroundCenter (fmt 27) ──
    if fmt == 26 or fmt == 27:
        # Convert degrees to turns
        return {
            "type": (
                "PaintRotateAroundCenter" if fmt == 26 else "PaintVarRotateAroundCenter"
            ),
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "angle": paint.get("angle", 0.0) / 360.0,
            "centerX": paint.get("centerX", 0.0),
            "centerY": paint.get("centerY", 0.0),
        }

    # ── PaintSkew (fmt 28) and PaintVarSkew (fmt 29) ────────────────────
    if fmt == 28 or fmt == 29:
        # Convert degrees to turns
        return {
            "type": "PaintSkew" if fmt == 28 else "PaintVarSkew",
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "xSkewAngle": paint.get("xSkewAngle", 0.0) / 360.0,
            "ySkewAngle": paint.get("ySkewAngle", 0.0) / 360.0,
        }

    # ── PaintSkewAroundCenter (fmt 30) and PaintVarSkewAroundCenter (fmt 31) ──
    if fmt == 30 or fmt == 31:
        # Convert degrees to turns
        return {
            "type": (
                "PaintSkewAroundCenter" if fmt == 30 else "PaintVarSkewAroundCenter"
            ),
            "paint": _convertPaintGraphToFontra(paint.get("Paint", {})),
            "xSkewAngle": paint.get("xSkewAngle", 0.0) / 360.0,
            "ySkewAngle": paint.get("ySkewAngle", 0.0) / 360.0,
            "centerX": paint.get("centerX", 0.0),
            "centerY": paint.get("centerY", 0.0),
        }

    # ── PaintComposite (fmt 32) ─────────────────────────────────────────
    if fmt == 32:
        return {
            "type": "PaintComposite",
            "sourcePaint": _convertPaintGraphToFontra(paint.get("SourcePaint", {})),
            "compositeMode": paint.get("CompositeMode", "src_over"),
            "backdropPaint": _convertPaintGraphToFontra(paint.get("BackdropPaint", {})),
        }

    # ── Unknown format — pass through as-is for forward compatibility ────
    print(f"Warning: Unknown COLRv1 paint format {fmt}, keeping as-is")
    return paint


def _convertColorLine(colorLine: dict) -> dict:
    """Convert fontTools ColorLine to Fontra native format."""
    if not colorLine:
        return {"extend": "pad", "colorStops": []}

    color_stops = []
    for stop in colorLine.get("ColorStop", []):
        # PaletteIndex and Alpha are at root level in fontTools ColorStop
        color_stops.append(
            {
                "stopOffset": stop.get("StopOffset", 0.0),
                "paletteIndex": stop.get("PaletteIndex", 0),
                "alpha": stop.get("Alpha", 1.0),
            }
        )

    return {
        "extend": colorLine.get("Extend", "pad"),
        "colorStops": color_stops,
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

        # Initialize COLR / CPAL / GSUB State
        self.colrVersion = 0
        self.colrV0Layers: dict[str, list[tuple[str, int]]] = {}
        self.colrLayerGlyphs: set[str] = set()
        self.gsubGlyphs: set[str] = set()
        self.colrPaintGraphs: dict[str, Any] = {}
        self.colrLayerList: list[Any] = []
        self.colrVarIndexMap: list[Any] = []
        self.colrVarStore: dict[str, Any] = {}
        self.colrOtVarStore = None
        self.colorPalettes: list[list[RGBAColor]] = []
        self.colrGlyphPaintEntries: dict[str, list[dict]] = {}
        self.colrClipBoxes: dict[str, Any] = {}

        # 1. Handle GSUB (Track ligatures/alternates so they aren't hidden)
        if "GSUB" in self.font:
            options = Options()
            options.layout_features = ["*"]
            subsetter = Subsetter(options=options)

            base_glyphs = set(self.font.getGlyphOrder())
            subsetter.populate(glyphs=list(base_glyphs))
            subsetter._closure_glyphs(self.font)
            self.gsubGlyphs = set(subsetter.glyphs_retained) - base_glyphs
        colrTable = self.font.get("COLR")
        if colrTable is not None:
            self.colrVersion = colrTable.version

            # Version 0 Logic
            if self.colrVersion == 0:
                for baseGlyph, layerRecords in colrTable.ColorLayers.items():
                    layers_list = []
                    for layer in layerRecords:
                        # fontTools exposes these as .name and .colorID on ColorLayerRecord
                        name = layer.name if hasattr(layer, "name") else layer[0]
                        colorID = (
                            layer.colorID if hasattr(layer, "colorID") else layer[1]
                        )
                        layers_list.append((name, colorID))
                        self.colrLayerGlyphs.add(name)
                    self.colrV0Layers[baseGlyph] = layers_list

            # Version 1 Logic (Fixed Indentation/Syntax)
            elif self.colrVersion >= 1:
                colr = colrTable.table
                self.colrPaintGraphs = colrUnbuilder.unbuildColrV1(
                    colr.LayerList, colr.BaseGlyphList
                )

                if getattr(colr, "ClipList", None):
                    self.colrClipBoxes = colr.ClipList.clips

                for paintGraph in self.colrPaintGraphs.values():
                    _indexPaintGlyphs(paintGraph, self.colrGlyphPaintEntries)

                if getattr(colr, "VarIndexMap", None):
                    self.colrVarIndexMap = list(colr.VarIndexMap.mapping)

                if getattr(colr, "VarStore", None):
                    self.colrOtVarStore = colr.VarStore
                    self.colrVarStore = _serializeVarStore(colr.VarStore)

        # 3. Handle CPAL (Palettes)
        cpalTable = self.font.get("CPAL")
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
        filtered_map = {}
        for name, codes in self.glyphMap.items():
            # Keep if it has Unicode
            if codes:
                filtered_map[name] = codes
                continue

            # Keep if it is a GSUB substitution/ligature
            if name in self.gsubGlyphs:
                filtered_map[name] = codes
                continue

            # Keep if it is NOT a color layer component
            if name not in self.colrLayerGlyphs:
                filtered_map[name] = codes
                continue

            # If it's ONLY a color layer component and has no Unicode/GSUB,
            # we skip it so it doesn't clutter the main glyph list.

        return filtered_map

    async def getGlyph(self, glyphName: str) -> VariableGlyph | None:
        isColorOnly = (
            glyphName in self.colrPaintGraphs
            or glyphName in self.colrV0Layers
            or (
                hasattr(self, "colrGlyphPaintEntries")
                and glyphName in self.colrGlyphPaintEntries
            )
        )

        if glyphName not in self.glyphSet and not isColorOnly:
            return None

        defaultSourceIdentifier = self.fontSourcesInstancer.defaultSourceIdentifier
        assert defaultSourceIdentifier is not None
        defaultLayerName = defaultSourceIdentifier

        glyph = VariableGlyph(name=glyphName)

        # 1. Initialize Base Geometry
        if glyphName in self.glyphSet:
            staticGlyph = buildStaticGlyph(self.glyphSet, glyphName)
        else:
            staticGlyph = StaticGlyph()
            staticGlyph.path = PackedPath()
            staticGlyph.components = []
            staticGlyph.xAdvance = (
                self.font["hmtx"].metrics.get(glyphName, (0, 0))[0]
                if "hmtx" in self.font
                else 0
            )

        layers = {defaultLayerName: Layer(glyph=staticGlyph)}
        defaultLocation = {axis.name: 0 for axis in self.axes.axes}
        layerLocations = {defaultLayerName: defaultLocation.copy()}

        sources = [
            GlyphSource(
                location={},
                locationBase=defaultSourceIdentifier,
                name="",
                layerName=defaultLayerName,
            )
        ]

        # 2. Handle Variable Outlines (Masters)
        for sparseLoc in self._getGlyphVariationLocations(glyphName):
            fullLoc = defaultLocation | sparseLoc
            locStr = locationToString(unnormalizeLocation(sparseLoc, self.axes.axes))
            varGlyphSet = self.variationGlyphSets.get(locStr)
            if varGlyphSet is None:
                varGlyphSet = self.font.getGlyphSet(location=fullLoc, normalized=True)
                self.variationGlyphSets[locStr] = varGlyphSet

            if glyphName in varGlyphSet:
                varGlyph = buildStaticGlyph(varGlyphSet, glyphName)
            else:
                varGlyph = StaticGlyph()
                varGlyph.path = PackedPath()
                varGlyph.components = []
                varGlyph.xAdvance = staticGlyph.xAdvance

            sourceLocation = unnormalizeLocation(fullLoc, self.axes.axes)
            locationBase = self.fontSourcesInstancer.getSourceIdentifierForLocation(
                sourceLocation
            )
            layerName = locationBase if locationBase is not None else locStr

            layers[layerName] = Layer(glyph=varGlyph)
            layerLocations[layerName] = fullLoc.copy()
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

        # 3. Handle COLRv0 (Layer-based Color)
        if glyphName in self.colrV0Layers:
            color_mapping = []
            for i, (layerGlyphName, colorID) in enumerate(self.colrV0Layers[glyphName]):
                shortLayerName = f"color.{i}"
                ufoLayerName = f"{defaultLayerName}^color.{i}"

                if layerGlyphName in self.glyphSet:
                    layerGlyph = buildStaticGlyph(self.glyphSet, layerGlyphName)
                else:
                    layerGlyph = StaticGlyph()
                    layerGlyph.path = PackedPath()
                    layerGlyph.components = []
                    layerGlyph.xAdvance = staticGlyph.xAdvance

                layerGlyph.customData["fontra.colrv0.colorID"] = colorID
                layers[ufoLayerName] = Layer(glyph=layerGlyph)
                color_mapping.append([shortLayerName, colorID])
            glyph.customData["colorLayerMapping"] = color_mapping

        # 4. Handle COLRv1 (Graph-based Color)
        fvarAxes = self.font["fvar"].axes if "fvar" in self.font else None
        rawPaint = None

        if glyphName in self.colrPaintGraphs:
            rawPaint = self.colrPaintGraphs[glyphName]
        elif (
            hasattr(self, "colrGlyphPaintEntries")
            and glyphName in self.colrGlyphPaintEntries
        ):
            entries = self.colrGlyphPaintEntries[glyphName]
            rawPaint = (
                entries[0] if len(entries) == 1 else {"Format": 1, "Layers": entries}
            )

        if rawPaint:
            # Process Paint and ClipBox for every layer (including masters)
            for layerName, layer in layers.items():
                loc = layerLocations.get(layerName, defaultLocation)
                instancer = None
                if self.colrOtVarStore is not None and fvarAxes is not None:
                    instancer = VarStoreInstancer(self.colrOtVarStore, fvarAxes, loc)

                # A. Process Paint
                layerPaint = (
                    _instantiatePaint(rawPaint, instancer, self.colrVarIndexMap)
                    if instancer
                    else deepcopy(rawPaint)
                )
                fontraPaint = _convertPaintGraphToFontra(layerPaint)
                layer.glyph.customData["colorv1"] = fontraPaint

                referencedGlyphs = []
                _collectPaintGlyphNames(fontraPaint, referencedGlyphs)
                if referencedGlyphs:
                    layer.glyph.customData["fontra.colrv1.referencedGlyphs"] = (
                        referencedGlyphs
                    )

                # B. Process ClipBox
                if (
                    getattr(self, "colrClipBoxes", None)
                    and glyphName in self.colrClipBoxes
                ):
                    rawClipBox = self.colrClipBoxes[glyphName]
                    clipDict = {
                        "Format": rawClipBox.Format,
                        "xMin": rawClipBox.xMin,
                        "yMin": rawClipBox.yMin,
                        "xMax": rawClipBox.xMax,
                        "yMax": rawClipBox.yMax,
                    }
                    if rawClipBox.Format == 2:
                        clipDict["VarIndexBase"] = rawClipBox.VarIndexBase

                    layerClip = (
                        _applyVarDeltas(
                            clipDict,
                            (
                                ("xMin", "int16"),
                                ("yMin", "int16"),
                                ("xMax", "int16"),
                                ("yMax", "int16"),
                            ),
                            instancer,
                            self.colrVarIndexMap,
                        )
                        if instancer
                        else clipDict
                    )

                    layer.glyph.customData["fontra.colrv1.clipBox"] = {
                        "xMin": layerClip["xMin"],
                        "yMin": layerClip["yMin"],
                        "xMax": layerClip["xMax"],
                        "yMax": layerClip["yMax"],
                    }

        # 5. Finalize
        glyph.layers = layers
        glyph.sources = sources
        return glyph

    def _getGlyphVariationLocations(self, glyphName: str) -> list[dict[str, float]]:
        # TODO/FIXME: This misses variations that only exist in HVAR/VVAR
        locations = set()

        if (
            self.colrOtVarStore is not None
            and "fvar" in self.font
            and glyphName in self.colrPaintGraphs
        ):
            fvarAxes = self.font["fvar"].axes
            varIndices = set()
            _collectVarIndicesFromPaint(
                self.colrPaintGraphs[glyphName],
                varIndices,
                self.colrVarIndexMap or None,
            )
            if getattr(self, "colrClipBoxes", None) and glyphName in self.colrClipBoxes:
                clipBox = self.colrClipBoxes[glyphName]
                if clipBox.Format == 2:
                    base = clipBox.VarIndexBase
                    if base is not None and base != 0xFFFFFFFF:
                        for i in range(4):
                            varIdx = _resolveVarIndex(
                                base, i, self.colrVarIndexMap or None
                            )
                            if varIdx is not None:
                                varIndices.add(varIdx)
            locations |= {
                locationToTuple(loc)
                for varIdx in varIndices
                for loc in getLocationsFromVarstore(
                    self.colrOtVarStore, fvarAxes, varIdx >> 16
                )
            }

        if self.gvarVariations is not None and glyphName in self.gvarVariations:
            locations |= {
                tuple(sorted(coords))
                for variation in self.gvarVariations[glyphName]
                for coords in product(
                    *[
                        [(k, v) for v in sorted(set(tent)) if v]
                        for k, tent in variation.axes.items()
                    ]
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

                    # 1. Correctly guard and shift axisValuesVarIndex
                    if (
                        component.axisValuesVarIndex is not None
                        and component.axisValuesVarIndex != NO_VARIATION_INDEX
                    ):
                        locations.update(
                            locationToTuple(loc)
                            for loc in getLocationsFromMultiVarstore(
                                component.axisValuesVarIndex >> 16, varStore, fvarAxes
                            )
                        )

                    # 2. Correctly guard and shift transformVarIndex
                    if (
                        component.transformVarIndex is not None
                        and component.transformVarIndex != NO_VARIATION_INDEX
                    ):
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
                (
                    unnormalizeValue(
                        inValue, axis.minValue, axis.defaultValue, axis.maxValue
                    ),
                    unnormalizeValue(
                        outValue, axis.minValue, axis.defaultValue, axis.maxValue
                    ),
                )
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
            if varIdx is None or varIdx == NO_VARIATION_INDEX:
                continue

            for loc in getLocationsFromVarstore(varStore, fvarAxes, varIdx >> 16):
                locations.add(locationToTuple(loc))

        for locTuple in sorted(locations):
            inputLocation = dict(locTuple)
            instancer = VarStoreInstancer(varStore, fvarAxes, inputLocation)

            outputLocation = {}
            for i, varIdx in enumerate(varIdxMap.mapping):
                if varIdx is None or varIdx == NO_VARIATION_INDEX:
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

OS_2_MAPPING = [
    ("ascender", "sTypoAscender"),
    ("descender", "sTypoDescender"),
    ("capHeight", "sCapHeight"),
    ("xHeight", "sxHeight"),
]


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
        for fontraName, os2Name in OS_2_MAPPING:
            if hasattr(os2Table, os2Name):
                lineMetricsH[fontraName] = LineMetric(value=getattr(os2Table, os2Name))
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

    # https://github.com/fonttools/fonttools/issues/2838

    # Via ttGlyphSet.py, we're using SegmentToPointPen to convert CFF/T2 segments
    # to points, which normally leads to closing curve-to points being removed.

    # However, as the fonttools issue above shows, in some situations, it does
    # not close onto the starting point at *some* locations, due to rounding errors
    # in the source deltas.

    # This functions detects those cases and compensates for it by appending the
    # starting point at the end of the contours that *do* close nicely.

    # This is a somewhat ugly trade-off to keep interpolation compatibility.

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
