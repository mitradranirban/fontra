import asyncio
import io
import pathlib
import shutil
from contextlib import aclosing

import pytest
from fontTools.ttLib import TTFont

from fontra.backends import getFileSystemBackend, opentype
from fontra.core.classes import (
    Axes,
    CrossAxisMapping,
    FontAxis,
    FontSource,
    LineMetric,
    RGBAColor,
    VariableGlyph,
)
from fontra.core.fonthandler import FontHandler
from fontra.filesystem.projectmanager import FileSystemProjectManager

opentype._USE_SOURCE_INDEX_INSTEAD_OF_UUID = True

dataDir = pathlib.Path(__file__).resolve().parent / "data"


@pytest.fixture
def testFontMutatorSans():
    return getFileSystemBackend(dataDir / "mutatorsans" / "MutatorSans.ttf")


@pytest.fixture
def testFontAvar2():
    return getFileSystemBackend(dataDir / "avar2" / "DemoAvar2.ttf")


@pytest.fixture
def testFontAvar2NLI():
    return getFileSystemBackend(dataDir / "avar2" / "DemoAvar2-NLI.ttf")


expectedAxes = Axes(
    axes=[
        FontAxis(
            name="DIAG",
            label="Diagonal",
            tag="DIAG",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=False,
            customData={},
        ),
        FontAxis(
            name="HORI",
            label="Horizontal",
            tag="HORI",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=True,
            customData={},
        ),
        FontAxis(
            name="VERT",
            label="Vertical",
            tag="VERT",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=True,
            customData={},
        ),
    ],
    mappings=[
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={
                "DIAG": 25.0,
            },
            outputLocation={
                "HORI": 0.0,
                "VERT": 33.001708984375,
            },
        ),
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={
                "DIAG": 75.0,
            },
            outputLocation={
                "HORI": 100.0,
                "VERT": 67.00032552083334,
            },
        ),
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={
                "DIAG": 100.0,
            },
            outputLocation={
                "HORI": 100.0,
                "VERT": 100.0,
            },
        ),
    ],
    elidedFallBackname=None,
    customData={},
)


async def test_readAvar2(testFontAvar2):
    axes = await testFontAvar2.getAxes()
    assert expectedAxes == axes


expectedAxesNLI = Axes(
    axes=[
        FontAxis(
            name="BEND",
            label="Bend",
            tag="BEND",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=False,
            customData={},
        ),
        FontAxis(
            name="BND2",
            label="Bend-2",
            tag="BND2",
            minValue=0.0,
            defaultValue=0.0,
            maxValue=100.0,
            mapping=[],
            valueLabels=[],
            hidden=True,
            customData={},
        ),
    ],
    mappings=[
        CrossAxisMapping(
            description=None,
            groupDescription=None,
            inputLocation={"BEND": 100},
            outputLocation={"BND2": 100},
        )
    ],
    elidedFallBackname=None,
    customData={},
)


async def test_readAvar2NLI(testFontAvar2NLI):
    axes = await testFontAvar2NLI.getAxes()
    assert expectedAxesNLI == axes


async def test_externalChanges(tmpdir):
    tmpdir = pathlib.Path(tmpdir)
    sourcePath = dataDir / "mutatorsans" / "MutatorSans.subset.ttf"
    destPath = tmpdir / "testfont.ttf"
    shutil.copy(sourcePath, destPath)

    backend = getFileSystemBackend(destPath)
    handler = FontHandler(
        backend=backend,
        projectIdentifier="test",
        metaInfoProvider=FileSystemProjectManager(),
    )

    async with aclosing(handler):
        await handler.startTasks()

        glyph = await handler.getGlyph("A")
        assert glyph.layers["font-source-0"].glyph.xAdvance == 396

        ttFont = TTFont(destPath)
        assert ttFont["hmtx"]["A"] == (396, 20)
        ttFont["hmtx"]["A"] = (999, 20)
        ttFont.save(destPath)

        await asyncio.sleep(0.15)  # give the file watcher a moment to catch up

        modifiedGlyph = await handler.getGlyph("A")

        assert modifiedGlyph.layers["font-source-0"].glyph.xAdvance == 999


async def test_readTTX():
    path = dataDir / "mutatorsans" / "MutatorSans.subset.ttx"
    font = getFileSystemBackend(path)
    glyph = await font.getGlyph("A")
    assert isinstance(glyph, VariableGlyph)


async def test_getShaperFontData_ttf():
    path = dataDir / "mutatorsans" / "MutatorSans.ttf"
    font = getFileSystemBackend(path)
    shaperFontData = await font.getShaperFontData()
    assert shaperFontData is not None
    f = io.BytesIO(shaperFontData.data)
    font = TTFont(f)
    assert sorted(font.keys()) == [
        "GDEF",
        "GPOS",
        "GSUB",
        "GlyphOrder",
        "fvar",
        "head",
        "name",
        "post",
    ]


async def test_getShaperFontData_ttx():
    path = dataDir / "mutatorsans" / "MutatorSans.subset.ttx"
    font = getFileSystemBackend(path)
    shaperFontData = await font.getShaperFontData()
    assert shaperFontData is not None
    f = io.BytesIO(shaperFontData.data)
    font = TTFont(f)
    assert sorted(font.keys()) == [
        "GDEF",
        "GPOS",
        "GSUB",
        "GlyphOrder",
        "fvar",
        "head",
        "name",
        "post",
    ]


async def test_getSources(testFontMutatorSans):
    sources = await testFontMutatorSans.getSources()
    assert len(sources) == 4

    expectedSourceValues = [
        FontSource(
            name="LightCondensed",
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=700),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=700),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
        FontSource(
            name="wdth=1000",
            location={"wdth": 1000.0},
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=700),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=700),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
        FontSource(
            name="wdth=1000,wght=900",
            location={"wdth": 1000.0, "wght": 900.0},
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=800),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=800),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
        FontSource(
            name="wght=900",
            location={"wght": 900.0},
            lineMetricsHorizontalLayout={
                "ascender": LineMetric(value=800),
                "baseline": LineMetric(value=0),
                "capHeight": LineMetric(value=800),
                "descender": LineMetric(value=-200),
                "xHeight": LineMetric(value=500),
            },
        ),
    ]
    assert list(sources.values()) == expectedSourceValues


fontSourceNamesTestData = [
    (
        dataDir / "sourcesans" / "SourceSans3VF-Upright.subset.otf",
        ["ExtraLight", "Semibold", "Black"],
    )
]


@pytest.mark.parametrize("fontPath, expectedNames", fontSourceNamesTestData)
async def test_font_sources_names(fontPath, expectedNames):
    font = getFileSystemBackend(fontPath)
    sources = await font.getSources()
    sourceNames = [s.name for s in sources.values()]
    assert sourceNames == expectedNames


colrCpalFontsTestData = [
    # COLRv0 + CPAL: TestColor_Regular.ttf
    (
        dataDir / "colorfonts/v0/TestColor_Regular.ttf",
        "A",  # base glyph with COLRv0 layers
    ),
    # v1 VARIABLE - fire.ttf has fvar + COLR v1 → expect VarIndexMap/VarStore
    (
        dataDir / "colorfonts/v1/fire.ttf",
        "glyph0001",  # base glyph with COLRv1 paint graph
    ),
]


@pytest.mark.parametrize("fontPath, baseGlyphName", colrCpalFontsTestData)
async def test_colr_parsing_and_color_palettes(fontPath, baseGlyphName):
    """OTFBackend parses COLR tables (v0/v1), builds paint graphs/indices, exposes CPAL palettes"""
    font = getFileSystemBackend(fontPath)

    # Verify COLR version detection and data structures
    customData = await font.getCustomData()
    if fontPath.name.startswith("TestColor"):  # v0
        assert "com.github.googlei18n.ufo2ft.colorLayers" in customData
        colrV0Layers = customData["com.github.googlei18n.ufo2ft.colorLayers"]
        assert baseGlyphName in colrV0Layers
        layers = colrV0Layers[baseGlyphName]
        assert isinstance(layers, list) and len(layers) > 0
        assert all(isinstance(layer, tuple) and len(layer) == 2 for layer in layers)
    else:  # v1
        assert "fontra.colrv1.varIndexMap" not in customData or isinstance(
            customData.get("fontra.colrv1.varIndexMap"), list
        )

    glyph = await font.getGlyph(baseGlyphName)
    assert glyph is not None
    assert isinstance(glyph.customData, dict)

    # COLRv0 layers on glyph
    v0Layers = glyph.customData.get("fontra.colrv0.layers")
    if v0Layers:
        assert isinstance(v0Layers, list)
        layerGlyph, colorID = v0Layers[0]
        assert isinstance(layerGlyph, str) and isinstance(colorID, int)

    # COLRv1 paint graph and glyph paint entries on glyph
    paintGraph = glyph.customData.get("fontra.colrv1.paintGraph")
    paintEntries = glyph.customData.get("fontra.colrv1.paintEntries")
    if paintGraph:
        assert isinstance(paintGraph, dict)
        assert paintGraph.get("Format") in (0, 1)  # Root paint record
    if paintEntries:
        assert isinstance(paintEntries, list)
        assert all(
            "Format" in entry for entry in paintEntries if isinstance(entry, dict)
        )

    # CPAL palettes (common to both)
    palettes = await font.getColorPalettes()
    assert isinstance(palettes, list) and len(palettes) > 0
    firstColor = palettes[0][0]
    assert isinstance(firstColor, RGBAColor)
    assert all(
        0.0 <= c <= 1.0
        for c in (firstColor.red, firstColor.green, firstColor.blue, firstColor.alpha)
    )

    # Round-trip verification in getCustomData()
    cpalData = customData["com.github.googlei18n.ufo2ft.colorPalettes"]
    assert isinstance(cpalData, list) and len(cpalData) == len(palettes)
    firstTuple = cpalData[0][0]
    assert firstTuple == (
        firstColor.red,
        firstColor.green,
        firstColor.blue,
        firstColor.alpha,
    )

    # VarStore serialization (if present in v1)
    varStore = customData.get("fontra.colrv1.varStore")
    if varStore:
        assert (
            isinstance(varStore, dict)
            and "regions" in varStore
            and "varData" in varStore
        )
        assert isinstance(varStore["regions"], list)
        if varStore["regions"]:
            region = varStore["regions"][0]
            assert isinstance(region, list) and len(region) > 0
            axis = region[0]
            assert set(axis) == {"startCoord", "peakCoord", "endCoord"}


@pytest.mark.parametrize(
    "fontPath, baseGlyphName, isV1",
    [
        # v0
        (dataDir / "colorfonts/v0/TestColor_Regular.ttf", "A", False),
        # v1: confirmed "baseglyph" from ttx COLR.BaseGlyphList
        (dataDir / "colorfonts/v1/fire.ttf", "baseglyph", True),
    ],
)
async def test_colr_base_glyph_data(fontPath, baseGlyphName, isV1):
    """Test COLR data attachment to confirmed BASE glyphs."""
    font = getFileSystemBackend(fontPath)
    glyph = await font.getGlyph(baseGlyphName)
    assert glyph is not None

    customData = glyph.customData
    assert customData

    if not isV1:
        # COLRv0 layers
        layers = customData["fontra.colrv0.layers"]
        assert isinstance(layers, list) and len(layers) > 0
    else:
        # COLRv1: paintGraph with Format 1 (PaintColrLayers)
        paintGraph = customData["fontra.colrv1.paintGraph"]
        assert isinstance(paintGraph, dict)
        assert paintGraph["Format"] == 12  # PaintTransform ✓

        innerPaint = paintGraph["Paint"]
        assert isinstance(innerPaint, dict)
        assert innerPaint["Format"] == 1  # PaintColrLayers ✓

        # unbuilder uses "Layers" array, not NumLayers/FirstLayerIndex
        layers = innerPaint["Layers"]
        assert (
            isinstance(layers, list) and len(layers) == 24
        )  # Matches ttx LayerCount=24 ✓

        # First layer: nested PaintTransform → PaintGlyph('glyph0001') ✓
        firstLayer = layers[0]
        assert firstLayer["Format"] == 12
        glyphPaint = firstLayer["Paint"]["Paint"]  # Deeply nested
        assert glyphPaint["Format"] == 10  # PaintGlyph
        assert glyphPaint["Glyph"] == "glyph0001"

        # CPAL always present
        palettes = await font.getColorPalettes()
        assert len(palettes) > 0


@pytest.mark.parametrize("fontPath", [dataDir / "colorfonts/v1/fire.ttf"])
async def test_fire_variable_colrv1(fontPath):
    """Test fire.ttf fvar + COLRv1 variation data serialization."""
    font = getFileSystemBackend(fontPath)

    # fvar axes
    axes = await font.getAxes()
    assert len(axes.axes) > 0  # Variable font

    customData = await font.getCustomData()

    # COLRv1 variable structures
    assert "fontra.colrv1.varIndexMap" in customData
    varIdxMap = customData["fontra.colrv1.varIndexMap"]
    assert isinstance(varIdxMap, list)

    varStore = customData["fontra.colrv1.varStore"]
    assert isinstance(varStore, dict)
    regions = varStore["regions"]
    assert isinstance(regions, list) and len(regions) > 0
    regionAxes = regions[0][0]  # First region, first axis
    assert set(regionAxes) == {"startCoord", "peakCoord", "endCoord"}
