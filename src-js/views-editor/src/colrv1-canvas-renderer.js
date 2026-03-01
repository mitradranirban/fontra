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

  // Clamp palette index
  const pi = Math.max(0, Math.min(activePaletteIndex, palettes.length - 1));
  const palette = palettes[pi];

  // Build outline cache: glyphName → Path2D  (lazy, populated on demand)
  const outlineCache = new Map();

  ctx.save();
  _renderPaint(ctx, paint, palette, axisValues, fontController, outlineCache);
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

function _renderPaint(ctx, paint, palette, axisValues, fontController, outlineCache) {
  if (!paint || typeof paint !== "object") return;

  switch (paint.type) {
    // ── Layer stack ────────────────────────────────────────────────────────
    case "PaintColrLayers": {
      for (const layer of paint.layers ?? []) {
        _renderPaint(ctx, layer, palette, axisValues, fontController, outlineCache);
      }
      break;
    }

    // ── Clip to glyph outline ──────────────────────────────────────────────
    case "PaintGlyph": {
      const path2d = _getOutlinePath2D(paint.glyph, fontController, outlineCache);
      if (!path2d) {
        // No outline found — render fill without clipping (better than nothing)
        _renderPaint(
          ctx,
          paint.paint,
          palette,
          axisValues,
          fontController,
          outlineCache
        );
        break;
      }
      ctx.save();
      ctx.clip(path2d, "nonzero");
      _renderPaint(ctx, paint.paint, palette, axisValues, fontController, outlineCache);
      ctx.restore();
      break;
    }

    // ── Solid fill ─────────────────────────────────────────────────────────
    case "PaintSolid":
    case "PaintVarSolid": {
      const alpha = resolveVal(paint.alpha, axisValues);
      if (alpha <= 0) break;
      const color = _paletteColor(palette, paint.paletteIndex, alpha);
      ctx.fillStyle = color;
      ctx.fill(new Path2D(), "nonzero"); // fill current clip region
      // fill() with no path fills the clip region in most browsers;
      // use a full-canvas rect as fallback:
      _fillClipRect(ctx, color);
      break;
    }

    // ── Linear gradient ────────────────────────────────────────────────────
    case "PaintLinearGradient":
    case "PaintVarLinearGradient": {
      const x0 = resolveVal(paint.x0, axisValues);
      const y0 = resolveVal(paint.y0, axisValues);
      const x1 = resolveVal(paint.x1, axisValues);
      const y1 = resolveVal(paint.y1, axisValues);
      // x2/y2 define rotation — approximate via angle
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      _applyColorLine(grad, paint.colorLine, palette, axisValues);
      _fillClipRect(ctx, grad);
      break;
    }

    // ── Radial gradient ────────────────────────────────────────────────────
    case "PaintRadialGradient":
    case "PaintVarRadialGradient": {
      const x0 = resolveVal(paint.x0, axisValues);
      const y0 = resolveVal(paint.y0, axisValues);
      const r0 = Math.max(0, resolveVal(paint.r0, axisValues));
      const x1 = resolveVal(paint.x1, axisValues);
      const y1 = resolveVal(paint.y1, axisValues);
      const r1 = Math.max(0, resolveVal(paint.r1, axisValues));
      try {
        const grad = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
        _applyColorLine(grad, paint.colorLine, palette, axisValues);
        _fillClipRect(ctx, grad);
      } catch (e) {
        // createRadialGradient throws if r0 or r1 is negative (shouldn't happen)
      }
      break;
    }

    // ── Sweep gradient ─────────────────────────────────────────────────────
    case "PaintSweepGradient":
    case "PaintVarSweepGradient": {
      const cx = resolveVal(paint.centerX, axisValues);
      const cy = resolveVal(paint.centerY, axisValues);
      const start = resolveVal(paint.startAngle, axisValues) * Math.PI * 2;
      const end = resolveVal(paint.endAngle, axisValues) * Math.PI * 2;
      try {
        const grad = ctx.createConicGradient(start, cx, cy);
        _applyColorLine(grad, paint.colorLine, palette, axisValues);
        _fillClipRect(ctx, grad);
      } catch (e) {
        // createConicGradient may not be available in all browsers
      }
      break;
    }

    // ── Transform paints ───────────────────────────────────────────────────
    case "PaintTranslate":
    case "PaintVarTranslate": {
      const dx = resolveVal(paint.dx, axisValues);
      const dy = resolveVal(paint.dy, axisValues);
      ctx.save();
      ctx.translate(dx, dy);
      _renderPaint(ctx, paint.paint, palette, axisValues, fontController, outlineCache);
      ctx.restore();
      break;
    }

    case "PaintRotate":
    case "PaintVarRotate": {
      const angle = resolveVal(paint.angle, axisValues) * Math.PI * 2;
      const cx = resolveVal(paint.centerX, axisValues);
      const cy = resolveVal(paint.centerY, axisValues);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.translate(-cx, -cy);
      _renderPaint(ctx, paint.paint, palette, axisValues, fontController, outlineCache);
      ctx.restore();
      break;
    }

    case "PaintScale":
    case "PaintVarScale": {
      const sx = resolveVal(paint.scaleX ?? paint.scale, axisValues) ?? 1;
      const sy = resolveVal(paint.scaleY ?? paint.scale, axisValues) ?? 1;
      const cx = resolveVal(paint.centerX, axisValues);
      const cy = resolveVal(paint.centerY, axisValues);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sx, sy);
      ctx.translate(-cx, -cy);
      _renderPaint(ctx, paint.paint, palette, axisValues, fontController, outlineCache);
      ctx.restore();
      break;
    }

    case "PaintSkew":
    case "PaintVarSkew": {
      const xAngle = resolveVal(paint.xSkewAngle, axisValues) * Math.PI * 2;
      const yAngle = resolveVal(paint.ySkewAngle, axisValues) * Math.PI * 2;
      const cx = resolveVal(paint.centerX, axisValues);
      const cy = resolveVal(paint.centerY, axisValues);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.transform(1, Math.tan(yAngle), Math.tan(xAngle), 1, 0, 0);
      ctx.translate(-cx, -cy);
      _renderPaint(ctx, paint.paint, palette, axisValues, fontController, outlineCache);
      ctx.restore();
      break;
    }

    case "PaintTransform":
    case "PaintVarTransform": {
      const t = paint.transform ?? {};
      const xx = resolveVal(t.xx, axisValues) ?? 1;
      const yx = resolveVal(t.yx, axisValues) ?? 0;
      const xy = resolveVal(t.xy, axisValues) ?? 0;
      const yy = resolveVal(t.yy, axisValues) ?? 1;
      const dx = resolveVal(t.dx, axisValues) ?? 0;
      const dy = resolveVal(t.dy, axisValues) ?? 0;
      ctx.save();
      ctx.transform(xx, yx, xy, yy, dx, dy);
      _renderPaint(ctx, paint.paint, palette, axisValues, fontController, outlineCache);
      ctx.restore();
      break;
    }

    // ── Composite ──────────────────────────────────────────────────────────
    case "PaintComposite": {
      // Render backdrop first, then source on top with composite mode
      ctx.save();
      _renderPaint(
        ctx,
        paint.backdropPaint,
        palette,
        axisValues,
        fontController,
        outlineCache
      );
      ctx.globalCompositeOperation = paint.compositeMode ?? "source-over";
      _renderPaint(
        ctx,
        paint.sourcePaint,
        palette,
        axisValues,
        fontController,
        outlineCache
      );
      ctx.restore();
      break;
    }

    default:
      // Unknown paint type — skip silently
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
