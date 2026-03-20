// src-js/views-editor/src/colrv1-canvas-renderer.js
// src-js/views-editor/src/colrv1-canvas-renderer.js
//
// Renders a COLRv1 paint graph onto a Canvas 2D context.
// Called from the "colrv1-paint-overlay" visualization layer.
//
// Coordinate system note:
// Fontra canvas has Y-up (font coordinates), Canvas 2D has Y-down.
// The scene transform already flips Y before calling draw(), so we
// do NOT negate Y here — we draw in font coordinates directly.

export const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";
export const COLRV1_KEY = "colorv1";

// ---------------------------------------------------------------------------
// Tag location builder
// Build a location dict keyed by BOTH axis.tag AND axis.name so resolveVal
// matches regardless of whether keyframes store "SHDW" or "shadow".
// ---------------------------------------------------------------------------

export function getTagLocation(fontController, sceneSettings) {
  const userLoc = sceneSettings?.fontLocationUser ?? {};
  const sourceLoc = fontController?.mapUserLocationToSourceLocation
    ? fontController.mapUserLocationToSourceLocation(userLoc)
    : userLoc;

  const tagLoc = { ...sourceLoc };
  for (const axis of fontController?.axes?.axes ?? []) {
    const val = sourceLoc[axis.name];
    if (val !== undefined) {
      tagLoc[axis.tag] = val;
      tagLoc[axis.name] = val;
    }
  }
  return tagLoc;
}

// ---------------------------------------------------------------------------
// Paint graph resolver — handles both .fontra and raw TTF paintEntries
// ---------------------------------------------------------------------------

export function getPaintGraph(customData) {
  if (!customData) return null;

  // .fontra source — already in Fontra format (has "type" key)
  const fontraFormat = customData[COLRV1_KEY];
  if (fontraFormat) return fontraFormat;

  // Check fontra.colrv1.paintGraph — may be Fontra format OR raw fontTools format
  const paintGraph = customData["fontra.colrv1.paintGraph"];
  if (paintGraph) {
    // Raw fontTools format has numeric "Format" key, Fontra format has "type"
    if (paintGraph.Format != null) return _convertPaintGraph(paintGraph);
    return paintGraph; // already Fontra format (.fontra source)
  }

  // TTF backend — explicit raw paintGraph (alternate storage key)
  const rawGraph = customData["fontra.colrv1.paintGraph.raw"];
  if (rawGraph?.Format != null) return _convertPaintGraph(rawGraph);

  // TTF backend — raw paintEntries array → wrap in PaintColrLayers
  const rawEntries = customData["fontra.colrv1.paintEntries"];
  if (rawEntries?.length) {
    return _convertPaintGraph({ Format: 1, Layers: rawEntries });
  }

  return null;
}

// ---------------------------------------------------------------------------
// Variable value resolution
// ---------------------------------------------------------------------------

export function resolveVal(val, axisValues) {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  if (typeof val !== "object") return 0;

  const base = val.default ?? 0;
  if (!val.keyframes?.length) return base;

  // Group keyframes by axis
  const byAxis = new Map();
  for (const kf of val.keyframes) {
    if (!byAxis.has(kf.axis)) byAxis.set(kf.axis, []);
    byAxis.get(kf.axis).push(kf);
  }

  // Use first axis (single-axis model)
  const [axis, kfs] = [...byAxis.entries()][0];
  const loc = axisValues?.[axis] ?? 0;
  const sorted = [...kfs].sort((a, b) => a.loc - b.loc);

  if (loc <= sorted[0].loc) return sorted[0].value;
  if (loc >= sorted[sorted.length - 1].loc) return sorted[sorted.length - 1].value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i],
      hi = sorted[i + 1];
    if (loc >= lo.loc && loc <= hi.loc) {
      const t = (loc - lo.loc) / (hi.loc - lo.loc);
      return lo.value + t * (hi.value - lo.value);
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function renderCOLRv1(
  ctx,
  positionedGlyph,
  fontController,
  axisValues,
  activePaletteIndex = 0
) {
  const glyphController = positionedGlyph?.glyph;
  if (!glyphController) return;

  const instanceCd = glyphController.instance?.customData;
  const varGlyphCd =
    positionedGlyph?.varGlyph?.glyph?.customData ??
    positionedGlyph?.varGlyph?.customData;

  let paint = getPaintGraph(instanceCd) ?? getPaintGraph(varGlyphCd);
  if (!paint) return;

  const palettes = fontController.customData?.[PALETTES_KEY];
  if (!palettes?.length) return;

  const pi = Math.max(0, Math.min(activePaletteIndex, palettes.length - 1));
  const palette = palettes[pi];

  const outlineCache = new Map();

  ctx.save();
  _renderPaint(
    ctx,
    paint,
    palette,
    axisValues,
    fontController,
    outlineCache,
    positionedGlyph
  );
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Paint graph walker
// ---------------------------------------------------------------------------

function _renderPaint(
  ctx,
  paint,
  palette,
  axisValues,
  fontController,
  outlineCache,
  positionedGlyph,
  _depth = 0
) {
  if (!paint) return;
  if (_depth > 32) {
    console.warn("COLRv1: max recursion depth");
    return;
  }

  switch (paint.type) {
    case "PaintColrLayers": {
      for (const layer of paint.layers ?? []) {
        _renderPaint(
          ctx,
          layer,
          palette,
          axisValues,
          fontController,
          outlineCache,
          positionedGlyph,
          _depth + 1
        );
      }
      break;
    }

    case "PaintGlyph": {
      // Look up named glyph outline — NOT the current positionedGlyph
      const path2d =
        _getOutlinePath2D(paint.glyphName, fontController, outlineCache) ??
        positionedGlyph?.glyph?.flattenedPath2d;
      ctx.save();
      if (path2d) ctx.clip(path2d);
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintColrGlyph": {
      // Recursively render a glyph that has its own COLR entry
      const refGlyph = fontController.getCachedGlyph?.(paint.glyphName);
      const refCd = refGlyph?.customData ?? refGlyph?.instance?.customData;
      const refPaint = getPaintGraph(refCd);
      if (refPaint) {
        _renderPaint(
          ctx,
          refPaint,
          palette,
          axisValues,
          fontController,
          outlineCache,
          positionedGlyph,
          _depth + 1
        );
      }
      break;
    }

    case "PaintSolid":
    case "PaintVarSolid": {
      const alpha = resolveVal(paint.alpha, axisValues);
      if (alpha <= 0) break;
      ctx.fillStyle = _paletteColor(palette, paint.paletteIndex, alpha);
      _fillBig(ctx);
      break;
    }

    case "PaintLinearGradient":
    case "PaintVarLinearGradient": {
      const x0 = resolveVal(paint.x0, axisValues);
      const y0 = resolveVal(paint.y0, axisValues);
      const x1 = resolveVal(paint.x1, axisValues);
      const y1 = resolveVal(paint.y1, axisValues);
      const x2 = resolveVal(paint.x2, axisValues);
      const y2 = resolveVal(paint.y2, axisValues);

      // COLRv1 spec (OpenType §COLR.PaintLinearGradient):
      // The gradient axis is NOT simply P0→P1. P2 acts as a rotation anchor:
      // the effective end point is the projection of P1 onto the line through
      // P0 that is perpendicular to (P2 - P0).
      //
      // Derivation:
      //   perp = rotate(P2 - P0, -90°) = (-dy2, dx2)
      //   scale = dot(P1 - P0, perp) / dot(perp, perp)
      //   P1eff = P0 + scale * perp
      //
      // When P2 == P0 (degenerate), fall back to using P1 directly.
      const dx2 = x2 - x0;
      const dy2 = y2 - y0;
      const len2sq = dx2 * dx2 + dy2 * dy2;

      let ex1, ey1;
      if (len2sq < 1e-10) {
        // Degenerate: P2 coincides with P0 — fall back to P0→P1 axis
        ex1 = x1;
        ey1 = y1;
      } else {
        // Perpendicular to (P2-P0) is (-dy2, dx2)
        const dot = (x1 - x0) * -dy2 + (y1 - y0) * dx2;
        const scale = dot / len2sq;
        ex1 = x0 + scale * -dy2;
        ey1 = y0 + scale * dx2;
      }

      const grad = ctx.createLinearGradient(x0, y0, ex1, ey1);
      _applyColorLine(grad, paint.colorLine, palette, axisValues);
      ctx.fillStyle = grad;
      _fillBig(ctx);
      break;
    }

    case "PaintRadialGradient":
    case "PaintVarRadialGradient": {
      ctx.save();
      // COLRv1 radial gradients may carry an affine transform that skews or
      // rotates the cone (e.g. to produce elliptical gradients). Canvas 2D
      // createRadialGradient always produces a symmetric axis-aligned cone, so
      // we apply the transform to the context instead.
      if (paint.transform) {
        const t = paint.transform;
        ctx.transform(
          resolveVal(t.xx, axisValues) ?? 1,
          resolveVal(t.yx, axisValues) ?? 0,
          resolveVal(t.xy, axisValues) ?? 0,
          resolveVal(t.yy, axisValues) ?? 1,
          resolveVal(t.dx, axisValues) ?? 0,
          resolveVal(t.dy, axisValues) ?? 0
        );
      }
      try {
        const grad = ctx.createRadialGradient(
          resolveVal(paint.x0, axisValues),
          resolveVal(paint.y0, axisValues),
          Math.max(0, resolveVal(paint.r0, axisValues)),
          resolveVal(paint.x1, axisValues),
          resolveVal(paint.y1, axisValues),
          Math.max(0, resolveVal(paint.r1, axisValues))
        );
        _applyColorLine(grad, paint.colorLine, palette, axisValues);
        ctx.fillStyle = grad;
        _fillBig(ctx);
      } catch (e) {
        /* degenerate radii */
      }
      ctx.restore();
      break;
    }

    case "PaintSweepGradient":
    case "PaintVarSweepGradient": {
      try {
        const startAngle = resolveVal(paint.startAngle, axisValues) * Math.PI * 2;
        const endAngle = resolveVal(paint.endAngle, axisValues) * Math.PI * 2;

        // COLRv1 sweep angles are counter-clockwise (font Y-up). Canvas 2D
        // createConicGradient is clockwise (Y-down). The scene transform has
        // already flipped Y, so we negate the start angle to correct direction.
        const grad = ctx.createConicGradient(
          -startAngle,
          resolveVal(paint.centerX, axisValues),
          resolveVal(paint.centerY, axisValues)
        );

        // createConicGradient always spans a full 360°. COLRv1 sweep gradients
        // only fill the [startAngle, endAngle] arc, so remap color stop offsets
        // from that arc onto the [0, 1] range the conic gradient expects.
        const arcSpan = endAngle - startAngle;
        if (Math.abs(arcSpan) > 1e-10 && paint.colorLine?.colorStops?.length) {
          const scale = arcSpan / (Math.PI * 2);
          const remapped = {
            ...paint.colorLine,
            colorStops: paint.colorLine.colorStops.map((stop) => ({
              ...stop,
              stopOffset: resolveVal(stop.stopOffset, axisValues) * scale,
            })),
          };
          _applyColorLine(grad, remapped, palette, axisValues);
        } else {
          _applyColorLine(grad, paint.colorLine, palette, axisValues);
        }

        ctx.fillStyle = grad;
        _fillBig(ctx);
      } catch (e) {}
      break;
    }

    case "PaintTranslate":
    case "PaintVarTranslate": {
      ctx.save();
      ctx.translate(resolveVal(paint.dx, axisValues), resolveVal(paint.dy, axisValues));
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintRotate":
    case "PaintVarRotate": {
      ctx.save();
      ctx.rotate(resolveVal(paint.angle, axisValues) * Math.PI * 2);
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintRotateAroundCenter":
    case "PaintVarRotateAroundCenter": {
      const cx = resolveVal(paint.centerX, axisValues);
      const cy = resolveVal(paint.centerY, axisValues);
      const angle = resolveVal(paint.angle, axisValues) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.translate(-cx, -cy);
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintScale":
    case "PaintVarScale": {
      ctx.save();
      ctx.scale(
        resolveVal(paint.scaleX ?? paint.scale, axisValues) ?? 1,
        resolveVal(paint.scaleY ?? paint.scale, axisValues) ?? 1
      );
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintScaleAroundCenter":
    case "PaintVarScaleAroundCenter": {
      const cx = resolveVal(paint.centerX, axisValues);
      const cy = resolveVal(paint.centerY, axisValues);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(
        resolveVal(paint.scaleX, axisValues) ?? 1,
        resolveVal(paint.scaleY, axisValues) ?? 1
      );
      ctx.translate(-cx, -cy);
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintScaleUniform":
    case "PaintVarScaleUniform": {
      const s = resolveVal(paint.scale, axisValues) ?? 1;
      ctx.save();
      ctx.scale(s, s);
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintScaleUniformAroundCenter":
    case "PaintVarScaleUniformAroundCenter": {
      const cx = resolveVal(paint.centerX, axisValues);
      const cy = resolveVal(paint.centerY, axisValues);
      const s = resolveVal(paint.scale, axisValues) ?? 1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintSkew":
    case "PaintVarSkew": {
      ctx.save();
      ctx.transform(
        1,
        Math.tan(resolveVal(paint.ySkewAngle, axisValues) * Math.PI * 2),
        Math.tan(resolveVal(paint.xSkewAngle, axisValues) * Math.PI * 2),
        1,
        0,
        0
      );
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintSkewAroundCenter":
    case "PaintVarSkewAroundCenter": {
      const cx = resolveVal(paint.centerX, axisValues);
      const cy = resolveVal(paint.centerY, axisValues);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.transform(
        1,
        Math.tan(resolveVal(paint.ySkewAngle, axisValues) * Math.PI * 2),
        Math.tan(resolveVal(paint.xSkewAngle, axisValues) * Math.PI * 2),
        1,
        0,
        0
      );
      ctx.translate(-cx, -cy);
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintTransform":
    case "PaintVarTransform": {
      const t = paint.transform ?? {};
      ctx.save();
      ctx.transform(
        resolveVal(t.xx, axisValues) ?? 1,
        resolveVal(t.yx, axisValues) ?? 0,
        resolveVal(t.xy, axisValues) ?? 0,
        resolveVal(t.yy, axisValues) ?? 1,
        resolveVal(t.dx, axisValues) ?? 0,
        resolveVal(t.dy, axisValues) ?? 0
      );
      _renderPaint(
        ctx,
        paint.paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    case "PaintComposite": {
      ctx.save();
      _renderPaint(
        ctx,
        paint.backdropPaint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.globalCompositeOperation = _compositeMode(paint.compositeMode);
      _renderPaint(
        ctx,
        paint.sourcePaint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1
      );
      ctx.restore();
      break;
    }

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BIG = 100_000;
function _fillBig(ctx) {
  ctx.fillRect(-BIG, -BIG, BIG * 2, BIG * 2);
}

function _applyColorLine(gradient, colorLine, palette, axisValues) {
  if (!colorLine?.colorStops?.length) return;
  const stops = [...colorLine.colorStops].sort(
    (a, b) =>
      resolveVal(a.stopOffset, axisValues) - resolveVal(b.stopOffset, axisValues)
  );
  for (const stop of stops) {
    const t = Math.max(0, Math.min(1, resolveVal(stop.stopOffset, axisValues)));
    const alpha = resolveVal(stop.alpha ?? 1.0, axisValues);
    const color = _paletteColor(palette, stop.paletteIndex, alpha);
    try {
      gradient.addColorStop(t, color);
    } catch (e) {
      /* skip invalid t */
    }
  }
}

function _paletteColor(palette, index, alphaOverride = 1.0) {
  const entry = palette?.[index];
  if (!entry) return `rgba(0,0,0,${alphaOverride})`;
  const [r, g, b, a = 1.0] = entry;
  const finalAlpha = a * alphaOverride;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(
    b * 255
  )},${finalAlpha.toFixed(4)})`;
}

// Map COLRv1 composite mode names to Canvas 2D globalCompositeOperation values
function _compositeMode(mode) {
  const map = {
    src_over: "source-over",
    src: "copy",
    dest: "destination-over",
    dest_over: "destination-over",
    src_in: "source-in",
    dest_in: "destination-in",
    src_out: "source-out",
    dest_out: "destination-out",
    src_atop: "source-atop",
    dest_atop: "destination-atop",
    xor: "xor",
    plus: "lighter",
    screen: "screen",
    overlay: "overlay",
    darken: "darken",
    lighten: "lighten",
    color_dodge: "color-dodge",
    color_burn: "color-burn",
    hard_light: "hard-light",
    soft_light: "soft-light",
    difference: "difference",
    exclusion: "exclusion",
    multiply: "multiply",
    hsl_hue: "hue",
    hsl_saturation: "saturation",
    hsl_color: "color",
    hsl_luminosity: "luminosity",
  };
  return map[mode] ?? "source-over";
}

function _getOutlinePath2D(glyphName, fontController, cache) {
  if (!glyphName) return null;
  if (cache.has(glyphName)) return cache.get(glyphName);

  const glyph = fontController.getCachedGlyph?.(glyphName);
  const path = glyph?.path ?? glyph?.instance?.path;
  if (!path) {
    cache.set(glyphName, null);
    return null;
  }

  const path2d = _varPackedPathToPath2D(path);
  cache.set(glyphName, path2d);
  return path2d;
}

function _varPackedPathToPath2D(path) {
  const p = new Path2D();
  if (!path) return p;

  if (Array.isArray(path.contours)) {
    for (const contour of path.contours) {
      _drawPlainContour(p, contour.points, contour.isClosed);
    }
    return p;
  }
  if (typeof path.iterContours === "function") {
    for (const contour of path.iterContours()) {
      const pts = [];
      for (const pt of contour.iterPoints()) pts.push(pt);
      _drawPlainContour(p, pts, contour.isClosed);
    }
    return p;
  }
  if (path.pointTypes && path.coordinates) {
    _drawPackedPath(p, path);
    return p;
  }
  return p;
}

function _drawPlainContour(p2d, points, isClosed) {
  if (!points?.length) return;
  p2d.moveTo(points[0].x, points[0].y);
  let i = 1;
  while (i < points.length) {
    const pt = points[i];
    const type = pt.type;
    if (type === "line" || type === "move" || type == null) {
      p2d.lineTo(pt.x, pt.y);
      i++;
    } else if (type === "cubic") {
      const c1 = pt,
        c2 = points[i + 1],
        on = points[i + 2];
      if (c2 && on) {
        p2d.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, on.x, on.y);
        i += 3;
      } else {
        p2d.lineTo(pt.x, pt.y);
        i++;
      }
    } else if (type === "quad") {
      const c = pt,
        on = points[i + 1];
      if (on) {
        p2d.quadraticCurveTo(c.x, c.y, on.x, on.y);
        i += 2;
      } else {
        p2d.lineTo(pt.x, pt.y);
        i++;
      }
    } else {
      p2d.lineTo(pt.x, pt.y);
      i++;
    }
  }
  if (isClosed) p2d.closePath();
}

function _drawPackedPath(p2d, path) {
  const coords = path.coordinates;
  const types = path.pointTypes;
  let ci = 0;
  for (let i = 0; i < types.length; i++) {
    const x = coords[ci++],
      y = coords[ci++];
    const isOnCurve = !!(types[i] & 0x01);
    if (i === 0) p2d.moveTo(x, y);
    else if (isOnCurve) p2d.lineTo(x, y);
    else p2d.lineTo(x, y); // simplified — full cubic/quad needs contourInfo
  }
}

// ---------------------------------------------------------------------------
// fontTools raw format → Fontra paint format converter
// ---------------------------------------------------------------------------

function _convertColorLine(colorLine) {
  if (!colorLine) return null;
  return {
    extend: colorLine.Extend ?? "pad",
    colorStops: (colorLine.ColorStop ?? []).map((stop) => ({
      stopOffset: stop.StopOffset ?? 0,
      paletteIndex: stop.Color?.PaletteIndex ?? stop.PaletteIndex ?? 0,
      alpha: stop.Color?.Alpha ?? stop.Alpha ?? 1,
    })),
  };
}

function _convertPaintGraph(paint) {
  if (!paint || typeof paint !== "object") return paint;
  const fmt = paint.Format;

  if (fmt === 1)
    return {
      type: "PaintColrLayers",
      layers: (paint.Layers ?? []).map(_convertPaintGraph),
    };
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
  if (fmt === 4)
    return {
      type: "PaintLinearGradient",
      colorLine: _convertColorLine(paint.ColorLine),
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
      colorLine: _convertColorLine(paint.ColorLine),
      x0: paint.x0 ?? 0,
      y0: paint.y0 ?? 0,
      x1: paint.x1 ?? 0,
      y1: paint.y1 ?? 0,
      x2: paint.x2 ?? 0,
      y2: paint.y2 ?? 0,
    };
  if (fmt === 6)
    return {
      type: "PaintRadialGradient",
      colorLine: _convertColorLine(paint.ColorLine),
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
      colorLine: _convertColorLine(paint.ColorLine),
      x0: paint.x0 ?? 0,
      y0: paint.y0 ?? 0,
      r0: paint.r0 ?? 0,
      x1: paint.x1 ?? 0,
      y1: paint.y1 ?? 0,
      r1: paint.r1 ?? 0,
    };
  if (fmt === 8)
    return {
      type: "PaintSweepGradient",
      colorLine: _convertColorLine(paint.ColorLine),
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      startAngle: (paint.startAngle ?? 0) / 360,
      endAngle: (paint.endAngle ?? 0) / 360,
    };
  if (fmt === 9)
    return {
      type: "PaintVarSweepGradient",
      colorLine: _convertColorLine(paint.ColorLine),
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      startAngle: (paint.startAngle ?? 0) / 360,
      endAngle: (paint.endAngle ?? 0) / 360,
    };
  if (fmt === 10)
    return {
      type: "PaintGlyph",
      glyphName: paint.Glyph,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 11) return { type: "PaintColrGlyph", glyphName: paint.Glyph };
  if (fmt === 12)
    return {
      type: "PaintTransform",
      transform: paint.Transform,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 13)
    return {
      type: "PaintVarTransform",
      transform: paint.Transform,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 14)
    return {
      type: "PaintTranslate",
      dx: paint.dx ?? 0,
      dy: paint.dy ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 15)
    return {
      type: "PaintVarTranslate",
      dx: paint.dx ?? 0,
      dy: paint.dy ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 16)
    return {
      type: "PaintScale",
      scaleX: paint.scaleX ?? 1,
      scaleY: paint.scaleY ?? 1,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 17)
    return {
      type: "PaintVarScale",
      scaleX: paint.scaleX ?? 1,
      scaleY: paint.scaleY ?? 1,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 18)
    return {
      type: "PaintScaleAroundCenter",
      scaleX: paint.scaleX ?? 1,
      scaleY: paint.scaleY ?? 1,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 19)
    return {
      type: "PaintVarScaleAroundCenter",
      scaleX: paint.scaleX ?? 1,
      scaleY: paint.scaleY ?? 1,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 20)
    return {
      type: "PaintScaleUniform",
      scale: paint.scale ?? 1,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 21)
    return {
      type: "PaintVarScaleUniform",
      scale: paint.scale ?? 1,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 22)
    return {
      type: "PaintScaleUniformAroundCenter",
      scale: paint.scale ?? 1,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 23)
    return {
      type: "PaintVarScaleUniformAroundCenter",
      scale: paint.scale ?? 1,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 24)
    return {
      type: "PaintRotate",
      angle: (paint.angle ?? 0) / 360,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 25)
    return {
      type: "PaintVarRotate",
      angle: (paint.angle ?? 0) / 360,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 26)
    return {
      type: "PaintRotateAroundCenter",
      angle: (paint.angle ?? 0) / 360,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 27)
    return {
      type: "PaintVarRotateAroundCenter",
      angle: (paint.angle ?? 0) / 360,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 28)
    return {
      type: "PaintSkew",
      xSkewAngle: (paint.xSkewAngle ?? 0) / 360,
      ySkewAngle: (paint.ySkewAngle ?? 0) / 360,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 29)
    return {
      type: "PaintVarSkew",
      xSkewAngle: (paint.xSkewAngle ?? 0) / 360,
      ySkewAngle: (paint.ySkewAngle ?? 0) / 360,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 30)
    return {
      type: "PaintSkewAroundCenter",
      xSkewAngle: (paint.xSkewAngle ?? 0) / 360,
      ySkewAngle: (paint.ySkewAngle ?? 0) / 360,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 31)
    return {
      type: "PaintVarSkewAroundCenter",
      xSkewAngle: (paint.xSkewAngle ?? 0) / 360,
      ySkewAngle: (paint.ySkewAngle ?? 0) / 360,
      centerX: paint.centerX ?? 0,
      centerY: paint.centerY ?? 0,
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 32)
    return {
      type: "PaintComposite",
      sourcePaint: _convertPaintGraph(paint.SourcePaint),
      compositeMode: paint.CompositeMode ?? "src_over",
      backdropPaint: _convertPaintGraph(paint.BackdropPaint),
    };

  console.warn(`_convertPaintGraph: unknown Format ${fmt}`, paint);
  return paint;
}
