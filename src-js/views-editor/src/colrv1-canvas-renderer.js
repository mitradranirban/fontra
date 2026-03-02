// src-js/views-editor/src/colrv1-canvas-renderer.js
//
// Renders a COLRv1 paint graph onto a Canvas 2D context.
// Called from the "colrv1-paint-overlay" visualization layer.
//
// Coordinate system note:
//   Fontra canvas has Y-up (font coordinates), Canvas 2D has Y-down.
//   The scene transform already flips Y before calling draw(), so we
//   do NOT negate Y here — we draw in font coordinates directly.

export const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";
export const COLRV1_KEY = "colorv1";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Render the COLRv1 paint graph for a single positioned glyph.
 *
 * @param {CanvasRenderingContext2D} ctx   - The canvas context (already transformed by scene)
 * @param {object}  positionedGlyph        - Fontra positionedGlyph object
 * @param {object}  fontController         - For palette data + sibling glyph lookup
 * @param {object}  axisValues             - { axisTag: normalizedValue, ... } at current location
 * @param {number}  activePaletteIndex     - Which CPAL palette row to use
 */
export function renderCOLRv1(
  ctx,
  positionedGlyph,
  fontController,
  axisValues,
  activePaletteIndex = 0
) {
  const glyphController = positionedGlyph?.glyph;
  if (!glyphController) return;

  const paint = glyphController.instance?.customData?.[COLRV1_KEY];
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
// Variable value resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a value that is either:
 *   - a plain number (static)
 *   - { default: number, keyframes: [{axis, loc, value}, ...] }
 *
 * Keyframes on the same axis are linearly interpolated.
 * Multiple axes are applied additively (delta from default).
 */
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

  let result = base;
  for (const [axis, kfs] of byAxis) {
    const loc = axisValues?.[axis] ?? 0;
    // Sort by loc
    const sorted = [...kfs].sort((a, b) => a.loc - b.loc);

    // Find surrounding keyframes
    if (loc <= sorted[0].loc) {
      result += sorted[0].value - base;
    } else if (loc >= sorted[sorted.length - 1].loc) {
      result += sorted[sorted.length - 1].value - base;
    } else {
      for (let i = 0; i < sorted.length - 1; i++) {
        const lo = sorted[i],
          hi = sorted[i + 1];
        if (loc >= lo.loc && loc <= hi.loc) {
          const t = (loc - lo.loc) / (hi.loc - lo.loc);
          result += lo.value + t * (hi.value - lo.value) - base;
          break;
        }
      }
    }
  }
  return result;
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
    console.warn("COLRv1: max depth");
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
      const path2d = positionedGlyph?.glyph?.flattenedPath2d;
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

    case "PaintSolid":
    case "PaintVarSolid": {
      const alpha = resolveVal(paint.alpha, axisValues);
      if (alpha <= 0) break;
      ctx.fillStyle = _paletteColor(palette, paint.paletteIndex, alpha);
      ctx.fillRect(-100000, -100000, 200000, 200000);
      break;
    }

    case "PaintLinearGradient":
    case "PaintVarLinearGradient": {
      const grad = ctx.createLinearGradient(
        resolveVal(paint.x0, axisValues),
        resolveVal(paint.y0, axisValues),
        resolveVal(paint.x1, axisValues),
        resolveVal(paint.y1, axisValues)
      );
      _applyColorLine(grad, paint.colorLine, palette, axisValues);
      ctx.fillStyle = grad;
      ctx.fillRect(-100000, -100000, 200000, 200000);
      break;
    }

    case "PaintRadialGradient":
    case "PaintVarRadialGradient": {
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
        ctx.fillRect(-100000, -100000, 200000, 200000);
      } catch (e) {}
      break;
    }

    case "PaintSweepGradient":
    case "PaintVarSweepGradient": {
      try {
        const grad = ctx.createConicGradient(
          resolveVal(paint.startAngle, axisValues) * Math.PI * 2,
          resolveVal(paint.centerX, axisValues),
          resolveVal(paint.centerY, axisValues)
        );
        _applyColorLine(grad, paint.colorLine, palette, axisValues);
        ctx.fillStyle = grad;
        ctx.fillRect(-100000, -100000, 200000, 200000);
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
      ctx.globalCompositeOperation = paint.compositeMode ?? "source-over";
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

/**
 * Get a Path2D for a named glyph outline, cached.
 * Uses getCachedGlyph from fontController if available.
 */
function _getOutlinePath2D(glyphName, fontController, cache) {
  if (!glyphName) return null;
  if (cache.has(glyphName)) return cache.get(glyphName);

  // Try getCachedGlyph first (synchronous, already loaded)
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

/**
 * Convert a Fontra VarPackedPath or plain path object to Path2D.
 * Handles both {contours:[{points:[...], isClosed}]} and
 * VarPackedPath with .iterContours() / .pointTypes / .coordinates.
 */
function _varPackedPathToPath2D(path) {
  const p = new Path2D();
  if (!path) return p;

  // Plain contour format: { contours: [{points:[{x,y,type}], isClosed}] }
  if (Array.isArray(path.contours)) {
    for (const contour of path.contours) {
      _drawPlainContour(p, contour.points, contour.isClosed);
    }
    return p;
  }

  // VarPackedPath with iterContours
  if (typeof path.iterContours === "function") {
    for (const contour of path.iterContours()) {
      const pts = [];
      for (const pt of contour.iterPoints()) pts.push(pt);
      _drawPlainContour(p, pts, contour.isClosed);
    }
    return p;
  }

  // VarPackedPath with pointTypes / coordinates arrays
  if (path.pointTypes && path.coordinates) {
    _drawPackedPath(p, path);
    return p;
  }

  return p;
}

const ON_CURVE = 0x01;
const CUBIC_OFF = 0x02;
const QUAD_OFF = 0x00; // implicit: not on-curve and not cubic

function _drawPlainContour(p2d, points, isClosed) {
  if (!points?.length) return;
  p2d.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    if (
      pt.type === "line" ||
      pt.type === "move" ||
      (pt.smooth != null && pt.type == null)
    ) {
      p2d.lineTo(pt.x, pt.y);
    } else {
      // Bezier — simplified: just lineTo for now
      // Full cubic/quad handling can be added if needed
      p2d.lineTo(pt.x, pt.y);
    }
  }
  if (isClosed) p2d.closePath();
}

function _drawPackedPath(p2d, path) {
  const coords = path.coordinates;
  const types = path.pointTypes;
  let ci = 0;
  let contourStart = 0;

  for (let i = 0; i < types.length; i++) {
    const x = coords[ci++],
      y = coords[ci++];
    const isOnCurve = !!(types[i] & ON_CURVE);
    if (i === contourStart) {
      p2d.moveTo(x, y);
    } else if (isOnCurve) {
      p2d.lineTo(x, y);
    } else {
      p2d.lineTo(x, y); // simplified
    }
    // Check for contour end (VarPackedPath stores contourInfo separately)
  }
}

/**
 * Apply colorLine stops to a CanvasGradient.
 */
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

/**
 * Convert a palette entry [r, g, b, a] + alpha override to CSS rgba string.
 */
function _paletteColor(palette, index, alphaOverride = 1.0) {
  const entry = palette?.[index];
  if (!entry) return `rgba(0,0,0,${alphaOverride})`;
  const [r, g, b, a = 1.0] = entry;
  const finalAlpha = a * alphaOverride;
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(
    b * 255
  )},${finalAlpha.toFixed(4)})`;
}

/**
 * Fill the current clip region with a style.
 * Canvas 2D has no "fill clip region" primitive — we use a large rect.
 * The scene transform is already set so 1 unit = 1 font unit.
 * We use a generous 100 000 UPM rect as the "infinite" fill.
 */
const BIG = 100_000;
function _fillClipRect(ctx, style) {
  ctx.fillStyle = style;
  ctx.fillRect(-BIG, -BIG, BIG * 2, BIG * 2);
}
