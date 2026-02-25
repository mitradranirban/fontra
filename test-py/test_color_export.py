import pytest
import pathlib
import tempfile
import ufoLib2

from fontra.core.classes import (
    Font, VariableGlyph, Layer, GlyphSource, RGBAColor, StaticGlyph,
)
from fontra.backends.designspace import UFOBackend


@pytest.mark.asyncio
async def test_color_font_ufo_export():
    # 1. Setup Fontra objects
    font = Font(unitsPerEm=1000)
    red = RGBAColor(red=1.0, green=0.0, blue=0.0, alpha=1.0)
    font.colorPalettes = [[red]]

    glyph = VariableGlyph(name="A")
    static_glyph = StaticGlyph(xAdvance=600)
    layer = Layer(glyph=static_glyph, colorIndex=0)
    glyph.layers = {"foreground": layer}

    # The source must reference the layer name that matches the UFO's default
    # fontraLayerName. UFOBackend.fromPath() creates a single DSSource whose
    # fontraLayerName is the source identifier (e.g. "default"). We name the
    # source to match, and set locationBase so putGlyph resolves it correctly.
    glyph.sources = [
        GlyphSource(name="default", layerName="foreground", locationBase="default")
    ]

    # 2. Setup Export Environment
    with tempfile.TemporaryDirectory() as tmpdir:
        ufo_path = pathlib.Path(tmpdir) / "TestFont-Regular.ufo"
        ufoLib2.Font().save(ufo_path)

        # 3. Initialize backend and attach font for putCustomData.
        backend = UFOBackend.fromPath(ufo_path)
        backend.font = font

        # 4. Write color palette data into the UFO lib.
        await backend.putCustomData(font.customData)

        # 5. Verify CPAL (Palettes)
        ufo = ufoLib2.Font.open(ufo_path)
        palettes_key = "com.github.googlei18n.ufo2ft.colorPalettes"
        assert palettes_key in ufo.lib, (
            f"Missing {palettes_key}. Lib keys: {list(ufo.lib.keys())}"
        )
        assert ufo.lib[palettes_key][0][0] == [1.0, 0.0, 0.0, 1.0]

        # 6. Discover the actual source identifier that fromPath() assigned,
        #    then patch the source's locationBase to match it exactly.
        assert backend.defaultDSSource is not None, "Backend has no default source"
        source_id = backend.defaultDSSource.identifier
        glyph.sources[0] = GlyphSource(
            name=source_id, layerName="foreground", locationBase=source_id
        )

        # 7. Write the glyph — putGlyph will now resolve "foreground" to the
        #    default UFO layer and flush contents.plist correctly.
        await backend.putGlyph("A", glyph, [])

        # 8. Re-open UFO after putGlyph writes and verify colorLayerMapping.
        ufo = ufoLib2.Font.open(ufo_path)
        mapping_key = "com.github.googlei18n.ufo2ft.colorLayerMapping"
        glyph_a = ufo["A"]
        assert mapping_key in glyph_a.lib, (
            f"Missing {mapping_key} in 'A'. Lib: {list(glyph_a.lib.keys())}"
        )
        assert glyph_a.lib[mapping_key] == [["foreground", 0]]
