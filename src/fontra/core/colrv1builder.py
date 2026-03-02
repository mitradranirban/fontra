# src/fontra/core/colrv1builder.py
"""
Converts Fontra's internal COLRv1 paint graph (stored in glyph.customData["colorv1"])
into paintcompiler PythonBuilder calls, which handle all IVS/varstore complexity.

Variable field format (Fontra schema):
    {"default": 630, "keyframes": [{"axis": "SHDW", "loc": 0.0, "value": 430}, ...]}

paintcompiler variation dict format:
    {(("SHDW", 0.0),): 430, (("SHDW", 1.0),): 630}
"""

from __future__ import annotations

from typing import Any

from paintcompiler import ColorLine, PythonBuilder

# ---------------------------------------------------------------------------
# Variation spec resolver
# ---------------------------------------------------------------------------


def _resolve_varspec(val: Any) -> Any:
    if not isinstance(val, dict) or "keyframes" not in val:
        default = val.get("default") if isinstance(val, dict) else val
        return float(default or 0.0)

    keyframes = val["keyframes"]
    spec: dict[tuple, float] = {}
    for kf in keyframes:
        try:
            axis = kf["axis"]
            loc = float(kf["loc"])
            value = float(kf["value"])
            key = ((axis, loc),)
            spec[key] = value
        except (KeyError, ValueError, TypeError):
            continue

    if not spec:
        return float(val.get("default", 0.0))
    return spec


# ---------------------------------------------------------------------------
# ColorLine builder
# ---------------------------------------------------------------------------


def _build_colorline(colorline_data: dict) -> ColorLine:
    """
    Convert Fontra colorLine dict to a paintcompiler ColorLine object.

    Fontra schema:
        {"extend": "pad", "colorStops": [
            {"stopOffset": 0.0, "paletteIndex": 2, "alpha": 1.0}, ...
        ]}

    ColorLine accepts a list of (stopOffset, (paletteIndex, alpha)) tuples.
    paletteIndex is an int — PythonBuilder.get_palette_index handles ints directly.
    """
    extend = colorline_data.get("extend", "pad")
    stops = []
    for stop in colorline_data["colorStops"]:
        offset = _resolve_varspec(stop["stopOffset"])
        alpha = _resolve_varspec(stop["alpha"])
        index = stop["paletteIndex"]  # int, passed straight through
        stops.append((offset, (index, alpha)))

    return ColorLine(stops, extend=extend)


# ---------------------------------------------------------------------------
# Paint node dispatcher
# ---------------------------------------------------------------------------


def _paint(node: dict, b: PythonBuilder) -> dict:
    """Recursively convert a Fontra paint graph node to a PythonBuilder result dict."""
    t = node["type"]

    # --- Structural ---
    if t == "PaintColrLayers":
        layers = [_paint(layer, b) for layer in node["layers"]]
        return b.PaintColrLayers(layers)

    if t == "PaintGlyph":
        child = _paint(node["paint"], b)
        return b.PaintGlyph(node["glyph"], child)  # note: "glyph" not "glyphName"

    if t == "PaintColrGlyph":
        return b.PaintColrGlyph(node["glyph"])

    if t == "PaintComposite":
        src = _paint(node["source"], b)
        dst = _paint(node["backdrop"], b)
        return b.PaintComposite(node["compositeMode"], src, dst)

    # --- Fill ---
    if t == "PaintSolid":
        alpha = _resolve_varspec(node.get("alpha", 1.0))
        return b.PaintSolid(node["paletteIndex"], alpha)

    if t == "PaintLinearGradient":
        colorline = _build_colorline(node["colorLine"])
        pt0 = (_resolve_varspec(node["x0"]), _resolve_varspec(node["y0"]))
        pt1 = (_resolve_varspec(node["x1"]), _resolve_varspec(node["y1"]))
        pt2 = (_resolve_varspec(node["x2"]), _resolve_varspec(node["y2"]))
        return b.PaintLinearGradient(pt0, pt1, pt2, colorline)

    if t == "PaintRadialGradient":
        colorline = _build_colorline(node["colorLine"])
        pt0 = (_resolve_varspec(node["x0"]), _resolve_varspec(node["y0"]))
        rad0 = _resolve_varspec(node["r0"])
        pt1 = (_resolve_varspec(node["x1"]), _resolve_varspec(node["y1"]))
        rad1 = _resolve_varspec(node["r1"])
        return b.PaintRadialGradient(pt0, rad0, pt1, rad1, colorline)

    if t == "PaintSweepGradient":
        colorline = _build_colorline(node["colorLine"])
        pt = (_resolve_varspec(node["centerX"]), _resolve_varspec(node["centerY"]))
        return b.PaintSweepGradient(
            pt,
            _resolve_varspec(node["startAngle"]),
            _resolve_varspec(node["endAngle"]),
            colorline,
        )

    # --- Transform ---
    if t == "PaintTranslate":
        child = _paint(node["paint"], b)
        return b.PaintTranslate(
            _resolve_varspec(node["dx"]),
            _resolve_varspec(node["dy"]),
            child,
        )

    if t == "PaintScale":
        child = _paint(node["paint"], b)
        sx = _resolve_varspec(node.get("scaleX", node.get("scale")))
        sy = node.get("scaleY")
        center = None
        if "centerX" in node:
            center = (
                _resolve_varspec(node["centerX"]),
                _resolve_varspec(node["centerY"]),
            )
        if sy is not None:
            return b.PaintScale(sx, _resolve_varspec(sy), center=center, paint=child)
        return b.PaintScale(sx, center=center, paint=child)

    if t == "PaintRotate":
        child = _paint(node["paint"], b)
        angle = _resolve_varspec(node["angle"])
        center = None
        if "centerX" in node:
            center = (
                _resolve_varspec(node["centerX"]),
                _resolve_varspec(node["centerY"]),
            )
        return b.PaintRotate(angle, center, child)

    if t == "PaintSkew":
        child = _paint(node["paint"], b)
        center = None
        if "centerX" in node:
            center = (
                _resolve_varspec(node["centerX"]),
                _resolve_varspec(node["centerY"]),
            )
        return b.PaintSkew(
            _resolve_varspec(node["xSkewAngle"]),
            _resolve_varspec(node["ySkewAngle"]),
            child,
            center=center,
        )

    if t == "PaintTransform":
        child = _paint(node["paint"], b)
        matrix = [_resolve_varspec(v) for v in node["matrix"]]  # [xx,xy,yx,yy,dx,dy]
        return b.PaintTransform(matrix, child)

    raise ValueError(f"Unknown paint type: {t!r}")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_color_glyphs(fontra_glyphs: dict, builder: PythonBuilder) -> dict:
    """
    Iterate all Fontra glyphs, extract colorv1 paint graphs, convert them
    to PythonBuilder result dicts ready for builder.build_colr().

    Only the default layer (first source's layerName) is read — variation
    is encoded in the keyframes inside each variable field, not across layers.

    Returns:
        color_glyphs dict → pass directly to builder.build_colr(color_glyphs)
    """
    color_glyphs = {}
    for glyph_name, glyph in fontra_glyphs.items():
        if not glyph.sources:
            continue
        default_layer_name = glyph.sources[0].layerName
        layer = glyph.layers.get(default_layer_name)
        if layer is None:
            continue

        colorv1 = (layer.glyph.customData or {}).get("colorv1")
        if colorv1 is None:
            continue

        color_glyphs[glyph_name] = _paint(colorv1, builder)

    return color_glyphs
