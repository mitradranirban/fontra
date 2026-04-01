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

  // TTF/OTF backend via opentype.py — stored as "fontra.colrv1.paintGraph"
  // May be raw fontTools format (has numeric "Format" key) or already Fontra format
  const paintGraph = customData["fontra.colrv1.paintGraph"];
  if (paintGraph) {
    if (paintGraph.Format != null) return _convertPaintGraph(paintGraph);
    return paintGraph;
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
  activePaletteIndex = 0,
  controller = null,
  cache
) {
  const glyphController = positionedGlyph?.glyph;
  if (!glyphController) return;

  const instanceCd = glyphController.instance?.customData;
  const varGlyphCd =
    positionedGlyph?.varGlyph?.glyph?.customData ??
    positionedGlyph?.varGlyph?.customData;

  const resolvedPaint = getPaintGraph(instanceCd) ?? getPaintGraph(varGlyphCd);
  if (!resolvedPaint) return;

  const palettes = fontController.customData?.[PALETTES_KEY];
  if (!palettes?.length) return;

  const pi = Math.max(0, Math.min(activePaletteIndex, palettes.length - 1));
  const palette = palettes[pi];

  const outlineCache = new Map();
  const pathCache = cache instanceof Map ? cache : new Map();
  const referencedGlyphs =
    instanceCd?.["fontra.colrv1.referencedGlyphs"] ??
    varGlyphCd?.["fontra.colrv1.referencedGlyphs"] ??
    [];
  for (const name of referencedGlyphs) {
    // 1. Correct the argument order to match your helper's definition
    // 2. Remove 'outlineCache' from the call (use pathCache instead)
    const p = _getOutlinePath2D(name, fontController, controller, pathCache);

    // 3. If the path isn't ready yet, we can't draw this layer.
    // Return to avoid errors in _renderPaint
    if (!p) {
      console.log(`Waiting for ${name}...`);
      continue;
    }
  }
  ctx.save();
  _renderPaint(
    ctx,
    resolvedPaint,
    palette,
    axisValues,
    fontController,
    outlineCache,
    positionedGlyph,
    0,
    controller
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
  _depth = 0,
  controller
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
          _depth + 1,
          controller
        );
      }
      break;
    }

    case "PaintGlyph": {
      const glyphName = paint.glyphName ?? paint.Glyph ?? paint.glyph ?? "";
      const path2d =
        _getOutlinePath2D(glyphName, fontController, outlineCache, controller) ??
        positionedGlyph?.glyph?.flattenedPath2d;
      ctx.save();
      if (path2d) ctx.clip(path2d);
      _renderPaint(
        ctx,
        paint.paint ?? paint.Paint,
        palette,
        axisValues,
        fontController,
        outlineCache,
        positionedGlyph,
        _depth + 1,
        controller
      );
      ctx.restore();
      break;
    }

    case "PaintColrGlyph": {
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
          _depth + 1,
          controller
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

      const dx2 = x2 - x0;
      const dy2 = y2 - y0;
      const len2sq = dx2 * dx2 + dy2 * dy2;

      let ex1, ey1;
      if (len2sq < 1e-10) {
        ex1 = x1;
        ey1 = y1;
      } else {
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
        const grad = ctx.createConicGradient(
          -startAngle,
          resolveVal(paint.centerX, axisValues),
          resolveVal(paint.centerY, axisValues)
        );
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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
        _depth + 1,
        controller
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

function _getOutlinePath2D(glyphName, fontController, controller, cache) {
  // 1. Immediate Return if Cached
  if (cache.has(glyphName)) return cache.get(glyphName);

  // 2. Check active UI controllers (Live edits)
  const gc =
    controller?.glyphControllers?.get(glyphName) ||
    controller?.sceneModel?.getGlyphController?.(glyphName);

  let path = gc?.flattenedPath2d || gc?.instance?.path2d;

  // 3. Synchronous check of the Font Data
  if (!path && fontController) {
    const glyph = fontController.getGlyph?.(glyphName);
    path = glyph?.path2d || glyph?.layers?.[0]?.path2d;

    // 4. THE TRIGGER: If data is missing, ask the fontController to load it
    // We don't 'await' here because we must return to the Canvas loop immediately.
    if (!glyph && fontController.getCachedGlyph) {
      // This call is async and will populate the internal cache once finished
      fontController.getCachedGlyph(glyphName).then(() => {
        controller.requestUpdate();
      });
    }
  }

  if (path) {
    cache.set(glyphName, path);
    return path;
  }

  // Still waiting... will try again next frame
  return null;
}
function _isEmptyPath(path) {
  if (!path) return true;
  return !(
    (path.contours && path.contours.length > 0) ||
    (path.pointTypes && path.coordinates && path.coordinates.length > 0) ||
    (path.commands && path.commands.length > 0)
  );
}

function getPath2D(pathData) {
  if (!pathData) return new Path2D();
  if (pathData instanceof Path2D) return pathData; // Already converted

  const p = new Path2D();
  // If it's Fontra's standard contours format
  if (Array.isArray(pathData.contours)) {
    pathData.contours.forEach((c) => {
      if (!c.points?.length) return;
      p.moveTo(c.points[0].x, c.points[0].y);
      // ... (keep curve logic if your font has curves)
    });
  }
  // If it's the efficient "Packed" format
  else if (pathData.pointTypes && pathData.coordinates) {
    const coords = pathData.coordinates;
    for (let i = 0; i < coords.length; i += 2) {
      if (i === 0) p.moveTo(coords[i], coords[i + 1]);
      else p.lineTo(coords[i], coords[i + 1]);
    }
  }
  return p;
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
      glyphName: paint.Glyph ?? paint.glyph ?? paint.glyphName ?? "",
      paint: _convertPaintGraph(paint.Paint),
    };
  if (fmt === 11)
    return {
      type: "PaintColrGlyph",
      glyphName: paint.Glyph ?? paint.glyph ?? paint.glyphName ?? "",
    };
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
