// src-js/views-editor/src/panel-color-layers.js

import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { Form } from "@fontra/web-components/ui-form.js";
import Panel from "./panel.js";

const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";
const CUSTOM_DATA_KEY = "colorLayerMapping";
const COLRV1_KEY = "colorv1";

// ---------------------------------------------------------------------------
// COLRv1 parameter schema
// ---------------------------------------------------------------------------
const PAINT_PARAM_SCHEMA = {
  PaintSolid: [
    { key: "paletteIndex", label: "color-layers.color-index", min: 0, integer: true },
    { key: "alpha", label: "color-layers.alpha", min: 0, max: 1 },
  ],
  PaintLinearGradient: [
    { key: "x0", label: "x0", pairWith: "y0" },
    { key: "y0", label: "y0", paired: true },
    { key: "x1", label: "x1", pairWith: "y1" },
    { key: "y1", label: "y1", paired: true },
    { key: "x2", label: "x2", pairWith: "y2" },
    { key: "y2", label: "y2", paired: true },
    {
      key: "colorStops",
      sourceKey: "colorLine",
      label: "color-layers.color-stops",
      type: "array",
      itemSchema: [
        {
          key: "paletteIndex",
          label: "color-layers.color-index",
          min: 0,
          integer: true,
        },
        { key: "alpha", label: "color-layers.alpha", min: 0, max: 1 },
        { key: "stopOffset", label: "color-layers.stop-offset", min: 0, max: 1 },
      ],
    },
  ],
  PaintRadialGradient: [
    { key: "x0", label: "color-layers.x0", pairWith: "y0" },
    { key: "y0", label: "color-layers.y0", paired: true },
    { key: "r0", label: "color-layers.r0", min: 0 },
    { key: "x1", label: "color-layers.x1", pairWith: "y1" },
    { key: "y1", label: "color-layers.y1", paired: true },
    { key: "r1", label: "color-layers.r1", min: 0 },
    {
      key: "colorStops",
      sourceKey: "colorLine",
      label: "color-layers.color-stops",
      type: "array",
      itemSchema: [
        {
          key: "paletteIndex",
          label: "color-layers.color-index",
          min: 0,
          integer: true,
        },
        { key: "alpha", label: "color-layers.alpha", min: 0, max: 1 },
        { key: "stopOffset", label: "color-layers.stop-offset", min: 0, max: 1 },
      ],
    },
  ],
  PaintSweepGradient: [
    { key: "centerX", label: "color-layers.centerX", pairWith: "centerY" },
    { key: "centerY", label: "color-layers.centerY", paired: true },
    { key: "startAngle", label: "color-layers.start-angle", min: -1, max: 1 },
    { key: "endAngle", label: "color-layers.end-angle", min: -1, max: 1 },
    {
      key: "colorStops",
      sourceKey: "colorLine",
      label: "color-layers.color-stops",
      type: "array",
      itemSchema: [
        {
          key: "paletteIndex",
          label: "color-layers.color-index",
          min: 0,
          integer: true,
        },
        { key: "alpha", label: "color-layers.alpha", min: 0, max: 1 },
        { key: "stopOffset", label: "color-layers.stop-offset", min: 0, max: 1 },
      ],
    },
  ],
  PaintTranslate: [
    { key: "dx", label: "dx", pairWith: "dy" },
    { key: "dy", label: "dy", paired: true },
  ],
  PaintScale: [
    { key: "scaleX", label: "scaleX", pairWith: "scaleY" },
    { key: "scaleY", label: "scaleY", paired: true },
  ],
  PaintScaleUniform: [{ key: "scale", label: "Scale" }],
  PaintScaleAroundCenter: [
    { key: "scaleX", label: "scaleX", pairWith: "scaleY" },
    { key: "scaleY", label: "scaleY", paired: true },
    { key: "centerX", label: "centerX", pairWith: "centerY" },
    { key: "centerY", label: "centerY", paired: true },
  ],
  PaintScaleUniformAroundCenter: [
    { key: "scale", label: "Scale" },
    { key: "centerX", label: "centerX", pairWith: "centerY" },
    { key: "centerY", label: "centerY", paired: true },
  ],
  PaintRotate: [{ key: "angle", label: "color-layers.angle-turns", min: -1, max: 1 }],
  PaintRotateAroundCenter: [
    { key: "angle", label: "color-layers.angle-turns", min: -1, max: 1 },
    { key: "centerX", label: "centerX", pairWith: "centerY" },
    { key: "centerY", label: "centerY", paired: true },
  ],
  PaintSkew: [
    {
      key: "xSkewAngle",
      label: "xSkewAngle",
      pairWith: "ySkewAngle",
      min: -0.5,
      max: 0.5,
    },
    { key: "ySkewAngle", label: "ySkewAngle", paired: true, min: -0.5, max: 0.5 },
  ],
  PaintSkewAroundCenter: [
    {
      key: "xSkewAngle",
      label: "xSkewAngle",
      pairWith: "ySkewAngle",
      min: -0.5,
      max: 0.5,
    },
    { key: "ySkewAngle", label: "ySkewAngle", paired: true, min: -0.5, max: 0.5 },
    { key: "centerX", label: "centerX", pairWith: "centerY" },
    { key: "centerY", label: "centerY", paired: true },
  ],
  PaintTransform: [
    { key: "xx", label: "xx", pairWith: "yx" },
    { key: "yx", label: "yx", paired: true },
    { key: "xy", label: "xy", pairWith: "yy" }, // ← was missing
    { key: "yy", label: "yy", paired: true },
    { key: "dx", label: "dx", pairWith: "dy" },
    { key: "dy", label: "dy", paired: true },
  ],
};

const normalizePaintType = (t) => t?.replace(/^PaintVar/, "Paint") ?? t;

// ---------------------------------------------------------------------------
// fontTools raw format → Fontra paint format converter
// ---------------------------------------------------------------------------

function convertColorLine(colorLine) {
  if (!colorLine) return null;
  return {
    extend: colorLine.Extend ?? "pad",
    colorStops: (colorLine.ColorStop ?? []).map((stop) => ({
      stopOffset: stop.StopOffset ?? 0,
      paletteIndex: stop.Color?.PaletteIndex ?? 0,
      alpha: stop.Color?.Alpha ?? 1,
    })),
  };
}

function convertPaintGraph(paint) {
  if (!paint || typeof paint !== "object") return paint;
  const fmt = paint.Format;

  // PaintColrLayers (fmt 1)
  if (fmt === 1)
    return {
      type: "PaintColrLayers",
      layers: (paint.Layers ?? []).map(convertPaintGraph),
    };

  // PaintSolid / PaintVarSolid (fmt 2–3)
  if (fmt === 2)
    return {
      type: "PaintSolid",
      paletteIndex: paint.PaletteIndex ?? 0,
      alpha: paint.Alpha ?? 1,
    };
  if (fmt === 3)
    return {
      type: "PaintVarSolid",
      paletteIndex: paint.PaletteIndex ?? 0,
      alpha: paint.Alpha ?? 1,
    };

  // PaintLinearGradient / PaintVarLinearGradient (fmt 4–5)
  if (fmt === 4)
    return {
      type: "PaintLinearGradient",
      colorLine: convertColorLine(paint.ColorLine),
      x0: paint.x0 ?? 0,
      y0: paint.y0 ?? 0,
      x1: paint.x1 ?? 0,
      y1: paint.y1 ?? 0,
      x2: paint.x2 ?? 0,
      y2: paint.y2 ?? 0,
    };
  if (fmt === 5)
    return {
      type: "PaintVarLinearGradient",
      colorLine: convertColorLine(paint.ColorLine),
      x0: paint.x0 ?? 0,
      y0: paint.y0 ?? 0,
      x1: paint.x1 ?? 0,
      y1: paint.y1 ?? 0,
      x2: paint.x2 ?? 0,
      y2: paint.y2 ?? 0,
    };

  // PaintRadialGradient / PaintVarRadialGradient (fmt 6–7)
  if (fmt === 6)
    return {
      type: "PaintRadialGradient",
      colorLine: convertColorLine(paint.ColorLine),
      x0: paint.x0 ?? 0,
      y0: paint.y0 ?? 0,
      r0: paint.r0 ?? 0,
      x1: paint.x1 ?? 0,
      y1: paint.y1 ?? 0,
      r1: paint.r1 ?? 0,
    };
  if (fmt === 7)
    return {
      type: "PaintVarRadialGradient",
      colorLine: convertColorLine(paint.ColorLine),
      x0: paint.x0 ?? 0,
      y0: paint.y0 ?? 0,
      r0: paint.r0 ?? 0,
      x1: paint.x1 ?? 0,
      y1: paint.y1 ?? 0,
      r1: paint.r1 ?? 0,
    };

  // PaintSweepGradient / PaintVarSweepGradient (fmt 8–9)
  // fontTools gives angles in degrees; OpenType spec / canvas uses turns (0.0–1.0)
  if (fmt === 8)
    return {
      type: "PaintSweepGradient",
      colorLine: convertColorLine(paint.ColorLine),
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      startAngle: (paint.startAngle ?? 0) / 360,
      endAngle: (paint.endAngle ?? 0) / 360,
    };
  if (fmt === 9)
    return {
      type: "PaintVarSweepGradient",
      colorLine: convertColorLine(paint.ColorLine),
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      startAngle: (paint.startAngle ?? 0) / 360,
      endAngle: (paint.endAngle ?? 0) / 360,
    };

  // PaintGlyph (fmt 10)
  if (fmt === 10)
    return {
      type: "PaintGlyph",
      glyphName: paint.Glyph,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintColrGlyph (fmt 11)
  if (fmt === 11)
    return {
      type: "PaintColrGlyph",
      glyphName: paint.Glyph,
    };

  // PaintTransform / PaintVarTransform (fmt 12–13)
  if (fmt === 12)
    return {
      type: "PaintTransform",
      transform: paint.Transform,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 13)
    return {
      type: "PaintVarTransform",
      transform: paint.Transform,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintTranslate / PaintVarTranslate (fmt 14–15)
  if (fmt === 14)
    return {
      type: "PaintTranslate",
      dx: paint.dx ?? 0,
      dy: paint.dy ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 15)
    return {
      type: "PaintVarTranslate",
      dx: paint.dx ?? 0,
      dy: paint.dy ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintScale / PaintVarScale (fmt 16–17)
  if (fmt === 16)
    return {
      type: "PaintScale",
      scaleX: paint.scaleX ?? 1,
      scaleY: paint.scaleY ?? 1,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 17)
    return {
      type: "PaintVarScale",
      scaleX: paint.scaleX ?? 1,
      scaleY: paint.scaleY ?? 1,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintScaleAroundCenter / PaintVarScaleAroundCenter (fmt 18–19)
  if (fmt === 18)
    return {
      type: "PaintScaleAroundCenter",
      scaleX: paint.scaleX ?? 1,
      scaleY: paint.scaleY ?? 1,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 19)
    return {
      type: "PaintVarScaleAroundCenter",
      scaleX: paint.scaleX ?? 1,
      scaleY: paint.scaleY ?? 1,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintScaleUniform / PaintVarScaleUniform (fmt 20–21)
  if (fmt === 20)
    return {
      type: "PaintScaleUniform",
      scale: paint.scale ?? 1,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 21)
    return {
      type: "PaintVarScaleUniform",
      scale: paint.scale ?? 1,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintScaleUniformAroundCenter / PaintVarScaleUniformAroundCenter (fmt 22–23)
  if (fmt === 22)
    return {
      type: "PaintScaleUniformAroundCenter",
      scale: paint.scale ?? 1,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 23)
    return {
      type: "PaintVarScaleUniformAroundCenter",
      scale: paint.scale ?? 1,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintRotate / PaintVarRotate (fmt 24–25)
  // fontTools gives angle in degrees; convert to turns
  if (fmt === 24)
    return {
      type: "PaintRotate",
      angle: (paint.angle ?? 0) / 360,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 25)
    return {
      type: "PaintVarRotate",
      angle: (paint.angle ?? 0) / 360,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintRotateAroundCenter / PaintVarRotateAroundCenter (fmt 26–27)
  if (fmt === 26)
    return {
      type: "PaintRotateAroundCenter",
      angle: (paint.angle ?? 0) / 360,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 27)
    return {
      type: "PaintVarRotateAroundCenter",
      angle: (paint.angle ?? 0) / 360,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintSkew / PaintVarSkew (fmt 28–29)
  // fontTools gives skew angles in degrees; convert to turns
  if (fmt === 28)
    return {
      type: "PaintSkew",
      xSkewAngle: (paint.xSkewAngle ?? 0) / 360,
      ySkewAngle: (paint.ySkewAngle ?? 0) / 360,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 29)
    return {
      type: "PaintVarSkew",
      xSkewAngle: (paint.xSkewAngle ?? 0) / 360,
      ySkewAngle: (paint.ySkewAngle ?? 0) / 360,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintSkewAroundCenter / PaintVarSkewAroundCenter (fmt 30–31)
  if (fmt === 30)
    return {
      type: "PaintSkewAroundCenter",
      xSkewAngle: (paint.xSkewAngle ?? 0) / 360,
      ySkewAngle: (paint.ySkewAngle ?? 0) / 360,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };
  if (fmt === 31)
    return {
      type: "PaintVarSkewAroundCenter",
      xSkewAngle: (paint.xSkewAngle ?? 0) / 360,
      ySkewAngle: (paint.ySkewAngle ?? 0) / 360,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: convertPaintGraph(paint.Paint),
    };

  // PaintComposite (fmt 32)
  if (fmt === 32)
    return {
      type: "PaintComposite",
      sourcePaint: convertPaintGraph(paint.SourcePaint),
      compositeMode: paint.CompositeMode ?? "src_over",
      backdropPaint: convertPaintGraph(paint.BackdropPaint),
    };

  // Unknown format — pass through as-is for forward compatibility
  console.warn(`convertPaintGraph: unknown paint Format ${fmt}`, paint);
  return paint;
}

// ---------------------------------------------------------------------------
// Module-level pure helpers
// ---------------------------------------------------------------------------

function makePlusButton(onclick, title) {
  return html.div(
    {
      style: "cursor:pointer;font-size:1.2em;line-height:1;padding:0 0.3em;",
      onclick,
      title,
    },
    ["+"]
  );
}

function makeMinusButton(onclick, title) {
  return html.div(
    {
      style: "cursor:pointer;font-size:1.2em;line-height:1;padding:0 0.3em;",
      onclick,
      title,
    },
    ["−"]
  );
}

// panel instance passed explicitly — no `this` dependency at module level
function makeVaryToggle(rawVal, layerIdx, paramKey, panel) {
  const variable = isVariable(rawVal);
  return html.button(
    {
      class: `kf-toggle ${variable ? "kf-active" : ""}`,
      title: variable
        ? translate("color-panel.remove-variable")
        : translate("color-panel.make-variable"),
      onclick: async () => {
        if (variable) {
          await panel._setV1PaintParam(
            panel._currentGlyphName,
            panel._currentPaint,
            layerIdx,
            paramKey,
            rawVal.default
          );
        } else {
          const axes = panel.fontController.globalAxes ?? [];
          const axisTag = axes[0]?.tag ?? "wght";
          await panel._setV1PaintParam(
            panel._currentGlyphName,
            panel._currentPaint,
            layerIdx,
            paramKey,
            {
              default: rawVal,
              keyframes: [
                { axis: axisTag, loc: 0.0, value: rawVal },
                { axis: axisTag, loc: 1.0, value: rawVal },
              ],
            }
          );
        }
      },
    },
    [
      variable
        ? translate("color-panel.remove-variable-short")
        : translate("color-panel.make-variable-short"),
    ]
  );
}

// ---------------------------------------------------------------------------
// Masterless variation helpers
// ---------------------------------------------------------------------------

export function isVariable(val) {
  return typeof val === "object" && val !== null && "keyframes" in val;
}

export function resolveAtLocation(val, axisValues) {
  if (!isVariable(val)) return val;
  const tag = val.keyframes[0]?.axis;
  const loc = axisValues?.[tag] ?? 0;
  const kfs = val.keyframes.filter((k) => k.axis === tag).sort((a, b) => a.loc - b.loc);
  for (let i = 0; i < kfs.length - 1; i++) {
    if (loc >= kfs[i].loc && loc <= kfs[i + 1].loc) {
      const t = (loc - kfs[i].loc) / (kfs[i + 1].loc - kfs[i].loc);
      return kfs[i].value + t * (kfs[i + 1].value - kfs[i].value);
    }
  }
  return loc <= (kfs[0]?.loc ?? 0) ? kfs[0]?.value ?? 0 : kfs.at(-1)?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Canvas preview renderer
// ---------------------------------------------------------------------------

function paletteIndexToCSS(index, alpha, palette) {
  const entry = palette?.[index];
  if (!entry) return `rgba(0,0,0,${alpha})`;
  const [r, g, b, a] = entry;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${
    (a ?? 1) * alpha
  })`;
}

function applyGlyphClip(ctx, glyphName, outlines) {
  const path = outlines?.[glyphName];
  if (!path) return;
  ctx.beginPath();
  const p2d = path instanceof Path2D ? path : path.path2D;
  if (p2d) ctx.clip(p2d, "nonzero");
}

function applyColorLine(grad, colorLine, axisValues, palette, startAngle, endAngle) {
  if (!colorLine?.colorStops) return;
  const rangeAngle = endAngle != null ? endAngle - startAngle : 1;
  for (const stop of colorLine.colorStops) {
    const offset = resolveAtLocation(stop.stopOffset, axisValues);
    const alpha = resolveAtLocation(stop.alpha, axisValues) ?? 1.0;
    const normOffset =
      endAngle != null ? (offset * rangeAngle) / (Math.PI * 2) : offset;
    grad.addColorStop(
      Math.max(0, Math.min(1, normOffset)),
      paletteIndexToCSS(stop.paletteIndex, alpha, palette)
    );
  }
}

function renderPaint(ctx, paint, axisValues, palette, outlines) {
  if (!paint) return;
  const t = paint.type?.replace("PaintVar", "Paint");

  if (t === "PaintColrLayers") {
    for (const layer of paint.layers ?? [])
      renderPaint(ctx, layer, axisValues, palette, outlines);
  } else if (t === "PaintColrGlyph") {
    const ref = outlines?.[paint.glyph];
    if (ref?.colorv1) renderPaint(ctx, ref.colorv1, axisValues, palette, outlines);
  } else if (t === "PaintGlyph") {
    ctx.save();
    applyGlyphClip(ctx, paint.glyph, outlines);
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintComposite") {
    renderPaint(ctx, paint.backdropPaint, axisValues, palette, outlines);
    ctx.globalCompositeOperation = paint.compositeMode ?? "src-over";
    renderPaint(ctx, paint.sourcePaint, axisValues, palette, outlines);
    ctx.globalCompositeOperation = "src-over";
  } else if (t === "PaintSolid") {
    const alpha = resolveAtLocation(paint.alpha, axisValues);
    ctx.fillStyle = paletteIndexToCSS(paint.paletteIndex, alpha, palette);
    ctx.fill();
  } else if (t === "PaintLinearGradient") {
    const grad = ctx.createLinearGradient(
      resolveAtLocation(paint.x0, axisValues),
      -resolveAtLocation(paint.y0, axisValues),
      resolveAtLocation(paint.x1, axisValues),
      -resolveAtLocation(paint.y1, axisValues)
    );
    applyColorLine(grad, paint.colorLine, axisValues, palette);
    ctx.fillStyle = grad;
    ctx.fill();
  } else if (t === "PaintRadialGradient") {
    const grad = ctx.createRadialGradient(
      resolveAtLocation(paint.x0, axisValues),
      -resolveAtLocation(paint.y0, axisValues),
      resolveAtLocation(paint.r0, axisValues),
      resolveAtLocation(paint.x1, axisValues),
      -resolveAtLocation(paint.y1, axisValues),
      resolveAtLocation(paint.r1, axisValues)
    );
    applyColorLine(grad, paint.colorLine, axisValues, palette);
    ctx.fillStyle = grad;
    ctx.fill();
  } else if (t === "PaintSweepGradient") {
    const sa = resolveAtLocation(paint.startAngle, axisValues) * Math.PI * 2;
    const ea = resolveAtLocation(paint.endAngle, axisValues) * Math.PI * 2;
    const grad = ctx.createConicGradient(
      sa - Math.PI / 2,
      resolveAtLocation(paint.centerX, axisValues),
      -resolveAtLocation(paint.centerY, axisValues)
    );
    applyColorLine(grad, paint.colorLine, axisValues, palette, sa, ea);
    ctx.fillStyle = grad;
    ctx.fill();
  } else if (t === "PaintTranslate") {
    ctx.save();
    ctx.translate(
      resolveAtLocation(paint.dx, axisValues),
      -resolveAtLocation(paint.dy, axisValues)
    );
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintScale") {
    ctx.save();
    ctx.scale(
      resolveAtLocation(paint.scaleX, axisValues),
      resolveAtLocation(paint.scaleY, axisValues)
    );
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintScaleUniform") {
    const s = resolveAtLocation(paint.scale, axisValues);
    ctx.save();
    ctx.scale(s, s);
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintScaleAroundCenter") {
    const cx = resolveAtLocation(paint.centerX, axisValues);
    const cy = -resolveAtLocation(paint.centerY, axisValues);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(
      resolveAtLocation(paint.scaleX, axisValues),
      resolveAtLocation(paint.scaleY, axisValues)
    );
    ctx.translate(-cx, -cy);
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintScaleUniformAroundCenter") {
    const s = resolveAtLocation(paint.scale, axisValues);
    const cx = resolveAtLocation(paint.centerX, axisValues);
    const cy = -resolveAtLocation(paint.centerY, axisValues);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintRotate") {
    ctx.save();
    ctx.rotate(resolveAtLocation(paint.angle, axisValues) * Math.PI * 2);
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintRotateAroundCenter") {
    const cx = resolveAtLocation(paint.centerX, axisValues);
    const cy = -resolveAtLocation(paint.centerY, axisValues);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(resolveAtLocation(paint.angle, axisValues) * Math.PI * 2);
    ctx.translate(-cx, -cy);
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintSkew") {
    const xSkew = resolveAtLocation(paint.xSkewAngle, axisValues) * Math.PI * 2;
    const ySkew = resolveAtLocation(paint.ySkewAngle, axisValues) * Math.PI * 2;
    ctx.save();
    ctx.transform(1, Math.tan(ySkew), Math.tan(xSkew), 1, 0, 0);
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintSkewAroundCenter") {
    const xSkew = resolveAtLocation(paint.xSkewAngle, axisValues) * Math.PI * 2;
    const ySkew = resolveAtLocation(paint.ySkewAngle, axisValues) * Math.PI * 2;
    const cx = resolveAtLocation(paint.centerX, axisValues);
    const cy = -resolveAtLocation(paint.centerY, axisValues);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.transform(1, Math.tan(ySkew), Math.tan(xSkew), 1, 0, 0);
    ctx.translate(-cx, -cy);
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  } else if (t === "PaintTransform") {
    ctx.save();
    ctx.transform(
      resolveAtLocation(paint.xx, axisValues),
      resolveAtLocation(paint.yx, axisValues),
      resolveAtLocation(paint.xy, axisValues),
      resolveAtLocation(paint.yy, axisValues),
      resolveAtLocation(paint.dx, axisValues),
      -resolveAtLocation(paint.dy, axisValues)
    );
    renderPaint(ctx, paint.paint, axisValues, palette, outlines);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export default class ColorLayersPanel extends Panel {
  identifier = "color-layers";
  iconPath = "/images/color.svg";

  constructor(editorController) {
    super(editorController);
    this.sceneController = this.editorController.sceneController;
    this.sceneController.sceneSettingsController.addKeyListener(
      ["selectedGlyphName"],
      () => this.update()
    );
    this.sceneController.sceneSettingsController.addKeyListener(["location"], () =>
      this._onLocationChange()
    );
    this.sceneController.addCurrentGlyphChangeListener(() => this.update());
  }

  _onLocationChange() {
    const pg = this.sceneController.sceneModel.getSelectedPositionedGlyph();
    const layerGlyph = pg?.glyph?.instance;
    if (!layerGlyph?.customData?.[COLRV1_KEY]) return;
    this.update();
  }

  getContentElement() {
    this.colorLayersForm = new Form();
    this.colorLayersForm.onFieldChange = async (fieldItem, value) => {
      let parsed;
      try {
        parsed = JSON.parse(fieldItem.key);
      } catch {
        return;
      }
      const [tag, ...rest] = parsed;

      if (tag === "colorIndex") {
        const [idx] = rest;
        await this._setColorIndex(this._currentGlyphName, idx, value);
        return;
      }
      if (tag === "v1PaintType") {
        const [layerIdx] = rest;
        await this._setV1LayerField(
          this._currentGlyphName,
          this._currentPaint,
          layerIdx,
          "type",
          value
        );
        return;
      }
      if (tag === "v1GlyphRef") {
        const [layerIdx] = rest;
        await this._setV1LayerField(
          this._currentGlyphName,
          this._currentPaint,
          layerIdx,
          "glyph",
          value
        );
        return;
      }
      if (tag === "v1Param") {
        const [layerIdx, paramKey] = rest;
        await this._setV1PaintParam(
          this._currentGlyphName,
          this._currentPaint,
          layerIdx,
          paramKey,
          value
        );
        return;
      }
      if (tag === "v1ArrayParam") {
        const [layerIdx, arrayKey, itemIdx, itemKey] = rest;
        await this._setV1ArrayParam(
          this._currentGlyphName,
          this._currentPaint,
          layerIdx,
          arrayKey,
          itemIdx,
          itemKey,
          value
        );
        return;
      }
      if (tag === "v1KFLoc") {
        const [layerIdx, paramKey, ki] = rest;
        const layer = (this._currentPaint.layers ?? [])[layerIdx];
        const currentVal = (layer?.paint ?? layer)?.[paramKey];
        if (!isVariable(currentVal)) return;
        const newKfs = currentVal.keyframes.map((kf, j) =>
          j === ki ? { ...kf, loc: value } : kf
        );
        await this._setV1FieldKeyframes(
          this._currentGlyphName,
          this._currentPaint,
          layerIdx,
          paramKey,
          newKfs
        );
        return;
      }
      if (tag === "v1KFVal") {
        const [layerIdx, paramKey, ki] = rest;
        const layer = (this._currentPaint.layers ?? [])[layerIdx];
        const currentVal = (layer?.paint ?? layer)?.[paramKey];
        if (!isVariable(currentVal)) return;
        const newKfs = currentVal.keyframes.map((kf, j) =>
          j === ki ? { ...kf, value } : kf
        );
        await this._setV1FieldKeyframes(
          this._currentGlyphName,
          this._currentPaint,
          layerIdx,
          paramKey,
          newKfs
        );
        return;
      }
      if (tag === "v1FillPaintType") {
        const [layerIdx] = rest;
        const layers = this._currentPaint.layers ?? [];
        const layer = layers[layerIdx];
        if (!layer) return;
        const defaults = {
          PaintSolid: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
          PaintLinearGradient: {
            type: "PaintLinearGradient",
            x0: 0,
            y0: 0,
            x1: 500,
            y1: 0,
            x2: 500,
            y2: 500,
            colorLine: {
              colorStops: [
                { paletteIndex: 0, alpha: 1.0, stopOffset: 0 },
                { paletteIndex: 1, alpha: 1.0, stopOffset: 1 },
              ],
            },
          },
          PaintRadialGradient: {
            type: "PaintRadialGradient",
            x0: 250,
            y0: 250,
            r0: 0,
            x1: 250,
            y1: 250,
            r1: 250,
            colorLine: {
              colorStops: [
                { paletteIndex: 0, alpha: 1.0, stopOffset: 0 },
                { paletteIndex: 1, alpha: 1.0, stopOffset: 1 },
              ],
            },
          },
          PaintSweepGradient: {
            type: "PaintSweepGradient",
            centerX: 250,
            centerY: 250,
            startAngle: 0,
            endAngle: 1,
            colorLine: {
              colorStops: [
                { paletteIndex: 0, alpha: 1.0, stopOffset: 0 },
                { paletteIndex: 1, alpha: 1.0, stopOffset: 1 },
              ],
            },
          },
        };
        const newFillPaint = defaults[value] ?? { type: value };
        const newLayers = layers.map((l, i) =>
          i === layerIdx ? { ...l, paint: newFillPaint } : l
        );
        await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        return;
      }
    };

    return html.div({ class: "panel" }, [
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [this.colorLayersForm]
      ),
    ]);
  }

  async toggle(on, focus) {
    if (on) this.update();
  }

  async update() {
    let customData;
    try {
      customData = this.fontController.customData ?? {};
    } catch {
      return;
    }

    const palettes = customData[PALETTES_KEY];
    if (!palettes?.length || !palettes[0]?.length) {
      this.colorLayersForm.setFieldDescriptions([
        { type: "text", value: translate("color-layers.no-palette") },
      ]);
      return;
    }
    const palette = palettes[0];
    const glyphName = this.sceneController.sceneSettings.selectedGlyphName;
    if (!glyphName) {
      this.colorLayersForm.setFieldDescriptions([
        { type: "text", value: translate("color-layers.no-glyph-selected") },
      ]);
      return;
    }

    this._currentGlyphName = glyphName;
    const pg = this.sceneController.sceneModel.getSelectedPositionedGlyph();

    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const varGlyph = varGlyphController?.glyph;
    const instanceGlyph = pg?.glyph?.instance;
    const defaultSource =
      varGlyph?.sources?.find((s) => !s.inactive) ?? varGlyph?.sources?.[0];
    const ttfLayerGlyph = varGlyph?.layers?.[defaultSource?.layerName]?.glyph;
    const layerGlyph =
      instanceGlyph?.customData?.[COLRV1_KEY] != null ? instanceGlyph : ttfLayerGlyph;

    // TTF paint lives on varGlyph.customData — synthesize a layerGlyph-like object
    const ttfPaintRaw = varGlyph?.customData?.["fontra.colrv1.paintGraph"];
    let ttfPaintGraph = ttfPaintRaw != null ? convertPaintGraph(ttfPaintRaw) : null;

    // ensure root is always PaintColrLayers so _renderV1UI finds .layers
    if (ttfPaintGraph != null && ttfPaintGraph.type !== "PaintColrLayers") {
      ttfPaintGraph = { type: "PaintColrLayers", layers: [ttfPaintGraph] };
    }
    const effectiveLayerGlyph =
      layerGlyph?.customData?.[COLRV1_KEY] != null
        ? layerGlyph
        : ttfPaintGraph != null
        ? { customData: { [COLRV1_KEY]: ttfPaintGraph } }
        : null;

    const hasV1 = !!effectiveLayerGlyph?.customData?.[COLRV1_KEY];
    const hasV0 = !!varGlyph?.customData?.[CUSTOM_DATA_KEY]?.length;

    if (hasV1) this._renderV1UI(effectiveLayerGlyph, glyphName, palette);
    else if (hasV0) this._renderV0UI(varGlyph, glyphName, palette);
    else this._renderEmptyUI(glyphName, palette);
  }
  _renderEmptyUI(glyphName, palette) {
    this.colorLayersForm.setFieldDescriptions([
      { type: "text", value: translate("color-layers.no-layers-yet") },
      {
        type: "header",
        label: translate("color-layers.title"),
        auxiliaryElement: html.div({ style: "display:flex;gap:4px;" }, [
          html.button(
            {
              title: translate("color-layers.start-v0"),
              onclick: () => this._addLayer(glyphName, palette.length, []),
            },
            ["v0"]
          ),
          html.button(
            {
              title: translate("color-layers.start-v1"),
              onclick: () => this._initV1(glyphName),
            },
            ["v1"]
          ),
        ]),
      },
    ]);
  }

  _renderV1UI(glyph, glyphName, palette) {
    const paint = glyph.customData[COLRV1_KEY] ?? {
      type: "PaintColrLayers",
      layers: [],
    };
    this._currentPaint = paint;
    const layers = paint.layers ?? [];
    const formContents = [];

    formContents.push({
      type: "header",
      label: translate("color-layers.colrv1-header"),
      auxiliaryElement: html.div(
        { style: "display:flex;gap:6px;align-items:center;" },
        [
          makePlusButton(
            () => this._addV1Layer(glyphName, paint, palette.length),
            translate("color-layers.add-layer")
          ),
        ]
      ),
    });

    if (layers.length === 0) {
      formContents.push({
        type: "text",
        value: translate("color-layers.no-layers-yet"),
      });
    } else {
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const layerLabel =
          layer.type === "PaintGlyph" || layer.type === "PaintVarGlyph"
            ? `${i}: PaintGlyph "${layer.glyph ?? "?"}"`
            : `${i}: ${layer.type ?? "Paint"}`;

        formContents.push({
          type: "header",
          label: layerLabel,
          auxiliaryElement: makeMinusButton(
            () => this._removeV1Layer(glyphName, paint, i),
            translate("color-layers.remove-layer")
          ),
        });

        formContents.push({
          type: "edit-text",
          key: JSON.stringify(["v1PaintType", i]),
          label: translate("color-layers.paint-type"),
          value: layer.type ?? "",
        });

        if (layer.type === "PaintGlyph" || layer.type === "PaintVarGlyph") {
          formContents.push({
            type: "edit-text",
            key: JSON.stringify(["v1GlyphRef", i]),
            label: translate("color-layers.glyph"),
            value: layer.glyph ?? "",
          });

          // ── Fill paint type selector ──────────────────────────────────
          const fillPaintTypes = [
            "PaintSolid",
            "PaintLinearGradient",
            "PaintRadialGradient",
            "PaintSweepGradient",
          ];
          const currentFillType = normalizePaintType(layer.paint?.type) ?? "PaintSolid";

          formContents.push({
            type: "header",
            label: translate("color-layers.fill-paint-type"),
          });

          for (const pt of fillPaintTypes) {
            const isSelected = currentFillType === pt;
            formContents.push({
              type: "header",
              label: isSelected ? `▶ ${pt}` : `　${pt}`,
              auxiliaryElement: isSelected
                ? null
                : html.button(
                    {
                      style: "font-size:0.75em;opacity:0.7;",
                      onclick: async () => {
                        const defaults = {
                          PaintSolid: {
                            type: "PaintSolid",
                            paletteIndex: 0,
                            alpha: 1.0,
                          },
                          PaintLinearGradient: {
                            type: "PaintLinearGradient",
                            x0: 0,
                            y0: 0,
                            x1: 500,
                            y1: 0,
                            x2: 500,
                            y2: 500,
                            colorLine: {
                              colorStops: [
                                { paletteIndex: 0, alpha: 1.0, stopOffset: 0 },
                                { paletteIndex: 1, alpha: 1.0, stopOffset: 1 },
                              ],
                            },
                          },
                          PaintRadialGradient: {
                            type: "PaintRadialGradient",
                            x0: 250,
                            y0: 250,
                            r0: 0,
                            x1: 250,
                            y1: 250,
                            r1: 250,
                            colorLine: {
                              colorStops: [
                                { paletteIndex: 0, alpha: 1.0, stopOffset: 0 },
                                { paletteIndex: 1, alpha: 1.0, stopOffset: 1 },
                              ],
                            },
                          },
                          PaintSweepGradient: {
                            type: "PaintSweepGradient",
                            centerX: 250,
                            centerY: 250,
                            startAngle: 0,
                            endAngle: 1,
                            colorLine: {
                              colorStops: [
                                { paletteIndex: 0, alpha: 1.0, stopOffset: 0 },
                                { paletteIndex: 1, alpha: 1.0, stopOffset: 1 },
                              ],
                            },
                          },
                        };
                        const newFillPaint = defaults[pt] ?? { type: pt };
                        const newLayers = (this._currentPaint.layers ?? []).map(
                          (l, idx) => (idx === i ? { ...l, paint: newFillPaint } : l)
                        );
                        await this._writeV1Paint({
                          ...this._currentPaint,
                          layers: newLayers,
                        });
                      },
                    },
                    ["use"]
                  ),
            });
          }
          // ─────────────────────────────────────────────────────────────
        }

        const fillPaint = layer.paint ?? layer;
        const normalType = normalizePaintType(fillPaint?.type ?? layer.type);
        this._pushParamFields(
          formContents,
          PAINT_PARAM_SCHEMA[normalType] ?? [],
          fillPaint,
          i,
          palette
        );
      }
    }

    this.colorLayersForm.setFieldDescriptions(formContents);
  }

  _pushParamFields(formContents, schema, fillPaint, layerIdx, palette) {
    const targetObj = fillPaint;
    let j = 0;
    while (j < schema.length) {
      const fd = schema[j];

      if (fd.type === "array") {
        this._pushArrayParamFields(formContents, fd, targetObj, layerIdx, palette);
        j++;
        continue;
      }

      if (fd.paired) {
        j++;
        continue;
      }

      const isIndex = fd.key === "paletteIndex";
      const defaultVal =
        fd.key === "alpha"
          ? 1.0
          : ["scaleX", "scaleY", "scale", "xx", "yy"].includes(fd.key)
          ? 1.0
          : 0;
      const rawVal = targetObj?.[fd.key] ?? defaultVal;
      const displayVal = isVariable(rawVal) ? rawVal.default : rawVal;

      if (fd.pairWith) {
        const partnerFd = schema[j + 1];
        const keyA = fd.key,
          keyB = partnerFd?.key ?? fd.pairWith;
        const rawA = targetObj?.[keyA] ?? 0;
        const rawB = targetObj?.[keyB] ?? 0;
        formContents.push({
          type: "edit-number-x-y",
          label: `${translate(fd.label)} / ${translate(partnerFd?.label ?? keyB)}`,
          fieldX: {
            key: JSON.stringify(["v1Param", layerIdx, keyA]),
            value: isVariable(rawA) ? rawA.default : rawA,
          },
          fieldY: {
            key: JSON.stringify(["v1Param", layerIdx, keyB]),
            value: isVariable(rawB) ? rawB.default : rawB,
          },
        });
        j += 2;
      } else {
        if (isVariable(rawVal)) {
          // Render existing Keyframes
          for (let ki = 0; ki < rawVal.keyframes.length; ki++) {
            const kf = rawVal.keyframes[ki];
            formContents.push({
              type: "edit-number-x-y",
              label: `  KF${ki} (${kf.axis})`,
              fieldX: {
                key: JSON.stringify(["v1KFLoc", layerIdx, fd.key, ki]),
                value: kf.loc,
                minValue: 0,
                maxValue: 1,
              },
              fieldY: {
                key: JSON.stringify(["v1KFVal", layerIdx, fd.key, ki]),
                value: kf.value,
                minValue: fd.min,
                maxValue: fd.max,
              },
              auxiliaryElement: html.button(
                {
                  title: translate("color-panel.remove-keyframe"),
                  onclick: async () => {
                    const newKfs = rawVal.keyframes.filter((_, i) => i !== ki);
                    await this._setV1FieldKeyframes(
                      this._currentGlyphName,
                      this._currentPaint,
                      layerIdx,
                      fd.key,
                      newKfs
                    );
                  },
                },
                [translate("color-panel.remove-keyframe-short")]
              ),
            });
          }

          // Add New Keyframe Button (at the end of the KF list)
          formContents.push({
            type: "button",
            label: "",
            title: translate("color-layers.add-kf-at-current-location"),
            text: translate("color-layers.add-kf"),
            onclick: () =>
              this._addKeyframeAtCurrent(
                this._currentGlyphName,
                this._currentPaint,
                layerIdx,
                fd.key
              ),
          });
        } else {
          // Static field logic
          formContents.push({
            type: "edit-number",
            key: JSON.stringify(["v1Param", layerIdx, fd.key]),
            label: translate(fd.label),
            value: displayVal,
            integer: fd.integer ?? false,
            minValue: fd.min ?? (isIndex ? 0 : undefined),
            maxValue: isIndex ? palette.length - 1 : fd.max ?? undefined,
            auxiliaryElement: html.div({ style: "display:flex; gap:4px;" }, [
              makeVaryToggle(rawVal, layerIdx, fd.key, this),
              html.button(
                {
                  title: translate("color-layers.convert-to-variable"),
                  style: "padding: 0 4px;",
                  onclick: () =>
                    this._addKeyframeAtCurrent(
                      this._currentGlyphName,
                      this._currentPaint,
                      layerIdx,
                      fd.key
                    ),
                },
                [translate("color-layers.add-kf-short")]
              ),
            ]),
          });
        }
        j++;
      }

      // Safety: prevents infinite loop
      if (j === 0) {
        j = schema.length;
        break;
      }
    }
  }

  _pushArrayParamFields(formContents, fieldDef, targetObj, layerIdx, palette) {
    const source = fieldDef.sourceKey ? targetObj?.[fieldDef.sourceKey] : targetObj;
    const arrayData = source?.[fieldDef.key] ?? [];
    formContents.push({
      type: "header",
      label: translate(fieldDef.label),
      auxiliaryElement: makePlusButton(
        () => this._addArrayItem(layerIdx, fieldDef.key, arrayData),
        translate("color-layers.add-stop")
      ),
    });
    if (arrayData.length === 0) {
      formContents.push({
        type: "text",
        value: translate("color-layers.no-stops-yet"),
      });
      return;
    }
    for (let i = 0; i < arrayData.length; i++) {
      const item = arrayData[i];
      formContents.push({
        type: "header",
        label: `${translate("color-layers.stop")} ${i}`,
        auxiliaryElement: makeMinusButton(
          () => this._removeArrayItem(layerIdx, fieldDef.key, i),
          translate("color-layers.remove-stop")
        ),
      });
      for (const itemField of fieldDef.itemSchema ?? []) {
        const isIndex = itemField.key === "paletteIndex";
        formContents.push({
          type: "edit-number",
          key: JSON.stringify([
            "v1ArrayParam",
            layerIdx,
            fieldDef.key,
            i,
            itemField.key,
          ]),
          label: translate(itemField.label),
          value: item?.[itemField.key] ?? (itemField.key === "alpha" ? 1.0 : 0),
          integer: itemField.integer ?? false,
          minValue: itemField.min ?? (isIndex ? 0 : undefined),
          maxValue: isIndex ? palette.length - 1 : itemField.max ?? undefined,
        });
      }
    }
  }

  _renderPreview(layerGlyph, axisValues) {
    const paint = layerGlyph.customData[COLRV1_KEY];
    const palette = this.fontController.customData[PALETTES_KEY]?.[0] ?? [];
    renderPaint(this.previewCtx, paint, axisValues, palette, this.glyphOutlines);
  }

  _renderV0UI(glyph, glyphName, palette) {
    const mapping = glyph?.customData?.[CUSTOM_DATA_KEY] ?? [];
    const formContents = [];
    formContents.push({
      type: "header",
      label: translate("color-layers.title"),
      auxiliaryElement: makePlusButton(
        () => this._addLayer(glyphName, palette.length, mapping),
        translate("color-layers.add-layer")
      ),
    });
    if (mapping.length === 0) {
      formContents.push({
        type: "text",
        value: translate("color-layers.no-layers-yet"),
      });
    } else {
      for (let i = 0; i < mapping.length; i++) {
        const [layerName, colorIndex] = mapping[i];
        formContents.push({
          type: "header",
          label: layerName,
          auxiliaryElement: makeMinusButton(
            () => this._removeLayer(glyphName, i, mapping),
            translate("color-layers.remove-layer")
          ),
        });
        formContents.push({
          type: "edit-number",
          key: JSON.stringify(["colorIndex", i]),
          label: translate("color-layers.color-index"),
          value: colorIndex,
          integer: true,
          minValue: 0,
          maxValue: palette.length - 1,
        });
      }
    }
    formContents.push({
      type: "header",
      label: "",
      auxiliaryElement: html.button(
        {
          title: translate("color-layers.convert-to-v1"),
          onclick: () => this._convertV0toV1(glyphName, mapping, palette),
          style: "font-size:0.75em;opacity:0.6;",
        },
        ["→ COLRv1"]
      ),
    });
    this.colorLayersForm.setFieldDescriptions(formContents);
  }

  // ── COLRv1 mutations ──────────────────────────────────────────────────────

  async _initV1(glyphName) {
    await this._writeV1Paint({ type: "PaintColrLayers", layers: [] });
  }

  async _addV1Layer(glyphName, paint, paletteSize) {
    const layers = paint.layers ?? [];
    await this._writeV1Paint({
      ...paint,
      layers: [
        ...layers,
        {
          type: "PaintGlyph",
          glyph: glyphName,
          paint: {
            type: "PaintSolid",
            paletteIndex: Math.min(layers.length, paletteSize - 1),
            alpha: 1.0,
          },
        },
      ],
    });
  }

  async _removeV1Layer(glyphName, paint, index) {
    const layers = [...(paint.layers ?? [])];
    layers.splice(index, 1);
    await this._writeV1Paint({ ...paint, layers });
  }

  async _setV1LayerField(glyphName, paint, layerIndex, field, value) {
    const layers = (paint.layers ?? []).map((l, i) =>
      i === layerIndex ? { ...l, [field]: value } : l
    );
    await this._writeV1Paint({ ...paint, layers });
  }

  async _setV1PaintParam(glyphName, paint, layerIndex, key, value) {
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;
      return layer.paint != null
        ? { ...layer, paint: { ...layer.paint, [key]: value } }
        : { ...layer, [key]: value };
    });
    await this._writeV1Paint({ ...paint, layers });
  }

  async _setV1FieldKeyframes(glyphName, paint, layerIndex, field, newKeyframes) {
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;
      const target = layer.paint != null ? layer.paint : layer;
      const oldVal = target[field];
      const newVal = {
        default: isVariable(oldVal) ? oldVal.default : oldVal,
        keyframes: newKeyframes,
      };
      return layer.paint != null
        ? { ...layer, paint: { ...layer.paint, [field]: newVal } }
        : { ...layer, [field]: newVal };
    });
    await this._writeV1Paint({ ...paint, layers });
  }

  async _setV1ArrayParam(
    glyphName,
    paint,
    layerIndex,
    arrayKey,
    itemIdx,
    itemKey,
    value
  ) {
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;
      const fillPaint = layer.paint ?? layer;
      if (fillPaint.colorLine && arrayKey === "colorStops") {
        const newStops = (fillPaint.colorLine.colorStops ?? []).map((item, idx) =>
          idx === itemIdx ? { ...item, [itemKey]: value } : item
        );
        const newFill = {
          ...fillPaint,
          colorLine: { ...fillPaint.colorLine, colorStops: newStops },
        };
        return layer.paint != null
          ? { ...layer, paint: newFill }
          : { ...layer, ...newFill };
      }
      const newArray = (fillPaint[arrayKey] ?? []).map((item, idx) =>
        idx === itemIdx ? { ...item, [itemKey]: value } : item
      );
      return layer.paint != null
        ? { ...layer, paint: { ...layer.paint, [arrayKey]: newArray } }
        : { ...layer, [arrayKey]: newArray };
    });
    await this._writeV1Paint({ ...paint, layers });
  }

  async _addArrayItem(layerIdx, arrayKey, currentArray) {
    const newItem =
      arrayKey === "colorStops" ? { paletteIndex: 0, alpha: 1.0, stopOffset: 0 } : {};
    await this._setV1ArrayField(
      this._currentGlyphName,
      this._currentPaint,
      layerIdx,
      arrayKey,
      [...currentArray, newItem]
    );
  }

  async _removeArrayItem(layerIdx, arrayKey, itemIdx) {
    const layers = (this._currentPaint.layers ?? []).map((layer, i) => {
      if (i !== layerIdx) return layer;
      const fillPaint = layer.paint ?? layer;
      if (fillPaint.colorLine && arrayKey === "colorStops") {
        const newStops = (fillPaint.colorLine.colorStops ?? []).filter(
          (_, idx) => idx !== itemIdx
        );
        const newFill = {
          ...fillPaint,
          colorLine: { ...fillPaint.colorLine, colorStops: newStops },
        };
        return layer.paint != null
          ? { ...layer, paint: newFill }
          : { ...layer, ...newFill };
      }
      const newArray = (fillPaint[arrayKey] ?? []).filter((_, idx) => idx !== itemIdx);
      return layer.paint != null
        ? { ...layer, paint: { ...layer.paint, [arrayKey]: newArray } }
        : { ...layer, [arrayKey]: newArray };
    });
    await this._writeV1Paint({ ...this._currentPaint, layers });
  }

  async _setV1ArrayField(glyphName, paint, layerIndex, arrayKey, newArray) {
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;
      const fillPaint = layer.paint ?? layer;

      // Handle nested colorLine
      if (fillPaint.colorLine && arrayKey === "colorStops") {
        const newFill = {
          ...fillPaint,
          colorLine: { ...fillPaint.colorLine, colorStops: newArray },
        };
        return layer.paint != null
          ? { ...layer, paint: newFill }
          : { ...layer, ...newFill };
      }

      // Default fallback for flat arrays
      return layer.paint != null
        ? { ...layer, paint: { ...layer.paint, [arrayKey]: newArray } }
        : { ...layer, [arrayKey]: newArray };
    });

    await this._writeV1Paint({ ...paint, layers });
  }

  async _writeV1Paint(newPaint) {
    await this.sceneController.editGlyphAndRecordChanges((varGlyph) => {
      const defaultSource =
        varGlyph.sources?.find((s) => !s.inactive && !s.locationBase) ??
        varGlyph.sources?.[0];
      const layerGlyph = varGlyph.layers?.[defaultSource?.layerName]?.glyph;
      if (layerGlyph) {
        if (!layerGlyph.customData) layerGlyph.customData = {};
        layerGlyph.customData[COLRV1_KEY] = newPaint;
      }
      return translate("color-layers.edit-colrv1-paint");
    });
  }

  // ── COLRv0 mutations ──────────────────────────────────────────────────────

  _nextLayerName(mapping) {
    const existing = new Set(mapping.map(([n]) => n));
    let i = 0;
    while (existing.has(`color.${i}`)) i++;
    return `color.${i}`;
  }

  async _writeMapping(glyphName, newMapping) {
    await this.sceneController.editGlyphAndRecordChanges((glyph) => {
      if (newMapping.length > 0) glyph.customData[CUSTOM_DATA_KEY] = newMapping;
      else delete glyph.customData[CUSTOM_DATA_KEY];
      return translate("color-layers.edit-description");
    });
  }

  async _addLayer(glyphName, paletteSize, mapping) {
    const layerName = this._nextLayerName(mapping);
    const colorIndex = mapping.length < paletteSize ? mapping.length : 0;
    const newMapping = [...mapping, [layerName, colorIndex]];
    await this.sceneController.editGlyphAndRecordChanges((glyph) => {
      if (!glyph.layers[layerName])
        glyph.layers[layerName] = { glyph: { path: { contours: [] }, components: [] } };
      glyph.customData[CUSTOM_DATA_KEY] = newMapping;
      return translate("color-layers.add-layer");
    });
  }

  async _removeLayer(glyphName, index, mapping) {
    const newMapping = [...mapping];
    newMapping.splice(index, 1);
    await this._writeMapping(glyphName, newMapping);
  }

  async _setColorIndex(glyphName, index, value) {
    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const currentMapping = varGlyphController?.glyph?.customData?.[CUSTOM_DATA_KEY];
    if (!currentMapping?.length || index >= currentMapping.length) return;
    const mapping = currentMapping.map((entry) => [...entry]);
    mapping[index] = [mapping[index][0], value];
    await this._writeMapping(glyphName, mapping);
  }

  // ── COLRv0 → COLRv1 converter ─────────────────────────────────────────────

  async _convertV0toV1(glyphName, mapping, palette) {
    const layers = mapping.map(([layerName, colorIndex]) => ({
      type: "PaintGlyph",
      glyph: layerName,
      paint: { type: "PaintSolid", paletteIndex: colorIndex, alpha: 1.0 },
    }));
    await this.sceneController.editGlyphAndRecordChanges((varGlyph) => {
      const defaultSource =
        varGlyph.sources?.find((s) => !s.inactive && !s.locationBase) ??
        varGlyph.sources?.[0];
      const layerGlyph = varGlyph.layers?.[defaultSource?.layerName]?.glyph;
      if (layerGlyph) {
        if (!layerGlyph.customData) layerGlyph.customData = {};
        layerGlyph.customData[COLRV1_KEY] = { type: "PaintColrLayers", layers };
      }
      delete varGlyph.customData[CUSTOM_DATA_KEY];
      return translate("color-layers.convert-v0-to-v1");
    });
  }
  _getCurrentDesignSpaceTarget() {
    const location = this.sceneController.sceneSettings.location || {};
    const axes = this.fontController.globalAxes ?? [];

    // Check for any axis that is NOT at its default value
    for (const axis of axes) {
      const currentVal = location[axis.tag];
      const defaultVal = axis.defaultValue ?? 0;

      if (currentVal !== undefined && currentVal !== defaultVal) {
        return { tag: axis.tag, loc: currentVal };
      }
    }

    // Fallback: If all sliders are at default, use the first available axis
    if (axes.length > 0) {
      const firstTag = axes[0].tag;
      return {
        tag: firstTag,
        loc: location[firstTag] ?? axes[0].defaultValue ?? 0,
      };
    }

    return { tag: "wght", loc: 0 };
  }

  async _addKeyframeAtCurrent(glyphName, paint, layerIdx, field) {
    const layer = (paint.layers ?? [])[layerIdx];
    const target = layer.paint ?? layer;
    const val = target[field];

    const { tag, loc } = this._getCurrentDesignSpaceTarget();

    // Determine the value to pin (interpolated if already variable, scalar if not)
    const currentValue = isVariable(val) ? resolveAtLocation(val, { [tag]: loc }) : val;

    let newKfs = [];
    if (isVariable(val)) {
      newKfs = [...val.keyframes, { axis: tag, loc, value: currentValue }];
    } else {
      newKfs = [{ axis: tag, loc, value: val }];
    }

    // Keep keyframes sorted by location for the resolver
    newKfs.sort((a, b) => a.loc - b.loc);

    await this._setV1FieldKeyframes(glyphName, paint, layerIdx, field, newKfs);
  }
}

customElements.define("panel-color-layers", ColorLayersPanel);
