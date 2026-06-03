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
// Variant family interpolation
//
// `^background`, `^bg2`, etc. live outside Fontra's variation model. To make
// them morph smoothly across the axis we build a parallel deltas cache per
// suffix, reusing varGlyph.model (every source must carry the variant for
// this to work).
// ---------------------------------------------------------------------------

const _variantDeltasCache = new WeakMap();
const _variantPaintDeltasCache = new WeakMap();

export function getInterpolatedVariantPaint(varGlyphController, suffix, sourceLocation) {
  const varGlyph = varGlyphController?.glyph;
  const model = varGlyphController?.model;
  if (!varGlyph || !model || !varGlyph.layers) return null;

  const sources = varGlyphController.sources ?? [];
  const masterPaints = [];
  for (const src of sources) {
    const cd = varGlyph.layers?.[src.layerName + suffix]?.glyph?.customData;
    const paint = getPaintGraph(cd);
    if (!paint) return null;
    masterPaints.push(paint);
  }

  let bySuffix = _variantPaintDeltasCache.get(varGlyphController);
  if (!bySuffix) {
    bySuffix = new Map();
    _variantPaintDeltasCache.set(varGlyphController, bySuffix);
  }
  let entry = bySuffix.get(suffix);
  const stale =
    !entry ||
    entry.paints.length !== masterPaints.length ||
    entry.paints.some((p, i) => p !== masterPaints[i]);
  if (stale) {
    let deltas;
    try {
      deltas = model.getDeltas(masterPaints);
    } catch (_) {
      return null;
    }
    entry = { paints: masterPaints, deltas };
    bySuffix.set(suffix, entry);
  }
  try {
    const result = model.interpolateFromDeltas(sourceLocation, entry.deltas);
    return result?.instance ?? result;
  } catch (_) {
    return null;
  }
}

export function getInterpolatedVariantPath(varGlyphController, suffix, sourceLocation) {
  const varGlyph = varGlyphController?.glyph;
  const model = varGlyphController?.model;
  if (!varGlyph || !model || !varGlyph.layers) return null;

  const sources = varGlyphController.sources ?? [];
  const masterPaths = [];
  for (const src of sources) {
    const path = varGlyph.layers?.[src.layerName + suffix]?.glyph?.path;
    if (!path) return null; // sparse — caller falls back to raw
    masterPaths.push(path);
  }

  let bySuffix = _variantDeltasCache.get(varGlyphController);
  if (!bySuffix) {
    bySuffix = new Map();
    _variantDeltasCache.set(varGlyphController, bySuffix);
  }
  let entry = bySuffix.get(suffix);
  // Invalidate when any master path reference changed (Fontra edits replace
  // path objects rather than mutating in place).
  const stale =
    !entry ||
    entry.paths.length !== masterPaths.length ||
    entry.paths.some((p, i) => p !== masterPaths[i]);
  if (stale) {
    let deltas;
    try {
      deltas = model.getDeltas(masterPaths);
    } catch (_) {
      return null;
    }
    entry = { paths: masterPaths, deltas };
    bySuffix.set(suffix, entry);
  }
  try {
    const result = model.interpolateFromDeltas(sourceLocation, entry.deltas);
    return result?.instance ?? result;
  } catch (_) {
    return null;
  }
}

export function clearVariantDeltasCache(varGlyphController) {
  if (varGlyphController) _variantDeltasCache.delete(varGlyphController);
}

// ---------------------------------------------------------------------------
// Tag location builder
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
// Paint graph resolver
// ---------------------------------------------------------------------------

export function getPaintGraph(customData) {
  if (!customData) return null;

  // Primary: .fontra format and converted TTF/OTF data
  const fontraFormat = customData[COLRV1_KEY];
  if (fontraFormat) return fontraFormat;

  // Fallback: legacy storage
  const paintGraph = customData["fontra.colrv1.paintGraph"];
  if (paintGraph) return paintGraph;

  return null;
}

export function getLayerPaintGraph(positionedGlyph, sceneSettings = null) {
  const varGlyph = positionedGlyph?.varGlyph?.glyph ?? positionedGlyph?.varGlyph;
  const sources = varGlyph?.sources ?? [];
  const editLayerName = sceneSettings?.editLayerName;
  if (editLayerName && varGlyph?.layers?.[editLayerName]) {
    return getPaintGraph(varGlyph?.layers?.[editLayerName]?.glyph?.customData);
  }
  const source =
    sources.find((s) => !s.inactive && !s.locationBase) ??
    sources.find((s) => !s.inactive) ??
    sources[0];
  const layerGlyph = varGlyph?.layers?.[source?.layerName]?.glyph;
  return getPaintGraph(layerGlyph?.customData);
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
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (loc >= lo.loc && loc <= hi.loc) {
      const t = (loc - lo.loc) / (hi.loc - lo.loc);
      return lo.value + t * (hi.value - lo.value);
    }
  }
  return base;
}
// ---------------------------------------------------------------------------
// COLRv0 from UFO layers (color.N naming convention)
// ---------------------------------------------------------------------------

export function renderCOLRv0FromLayers(
  ctx,
  positionedGlyph,
  fontController,
  activePaletteIndex = 0
) {
  const varGlyph = positionedGlyph?.varGlyph?.glyph ?? positionedGlyph?.varGlyph;
  if (!varGlyph) return;

  const palettes = fontController.customData?.[PALETTES_KEY];

  if (!palettes?.length) {
    console.warn("[COLRv0] BAIL: no palettes");
    return;
  }

  const paletteIndex = Math.max(0, Math.min(activePaletteIndex, palettes.length - 1));
  const palette = palettes[paletteIndex];
  if (!Array.isArray(palette)) return;
  const colorLayers = _collectColorLayers(varGlyph);

  if (!colorLayers.length) {
    console.warn("[COLRv0] BAIL: no color layers");
    return;
  }

  ctx.save();
  for (const { layerIndex, source } of colorLayers) {
    const path2d = _getLayerPath2D(source);
    const paletteEntry = palette[layerIndex];
    if (!Array.isArray(paletteEntry) || !path2d) continue;
    const [r, g, b, a = 1.0] = paletteEntry;
    ctx.fillStyle = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
      b * 255
    )}, ${a.toFixed(4)})`;
    ctx.fill(path2d);
  }
  ctx.restore();
}

function _collectColorLayers(varGlyph) {
  // Color layer mapping is stored in customData, not derivable from layer names alone
  // Shape: [[layerName, colorIndex], ...] e.g. [["color.0", 0], ["color.1", 1], ...]
  const colorLayerMapping = varGlyph.customData?.colorLayerMapping;
  if (!colorLayerMapping?.length) return [];

  const layers = varGlyph.layers;
  if (!layers) return [];

  const result = [];
  for (const [layerName, colorIndex] of colorLayerMapping) {
    // Fontra stores layers with a "default^" prefix: "default^color.0"
    const fontraLayerName = `default^${layerName}`;
    const layer = layers[fontraLayerName] ?? layers[layerName];
    if (!layer) continue;
    result.push({
      layerIndex: colorIndex,
      source: layer,
    });
  }

  // Sort ascending by colorIndex = bottom-to-top paint order
  return result.sort((a, b) => a.layerIndex - b.layerIndex);
}
function _getLayerPath2D(source) {
  const glyphData = source?.glyph ?? source;

  if (glyphData?.flattenedPath2d instanceof Path2D) return glyphData.flattenedPath2d;
  if (glyphData?.instance?.path2d instanceof Path2D) return glyphData.instance.path2d;

  const pathData = glyphData?.instance?.path ?? glyphData?.path;
  if (!pathData) return null;

  // Use dedicated converter for VarPackedPath (Fontra point type encoding)
  return _convertVarPackedPathToPath2D(pathData);
}

function _convertVarPackedPathToPath2D(path) {
  const p = new Path2D();
  const coords = path.coordinates;
  const types = path.pointTypes;
  const contourInfo = path.contourInfo;
  if (!coords || !types || !contourInfo) return p;

  let pointIndex = 0;
  let coordIndex = 0;

  for (let contourIdx = 0; contourIdx < contourInfo.length; contourIdx++) {
    const info = contourInfo[contourIdx];
    const isClosed = info.isClosed;
    const numPoints = info.length ?? info.endPoint + 1 - pointIndex;
    if (numPoints === 0) continue;

    // Collect contour points
    // Fontra VarPackedPath point types: 0=on-curve, 1=off-curve-smooth(quad), 2=off-curve-cubic
    const pts = [];
    for (let i = 0; i < numPoints; i++) {
      pts.push({
        x: coords[coordIndex],
        y: coords[coordIndex + 1],
        type: types[pointIndex],
      });
      coordIndex += 2;
      pointIndex++;
    }

    // Find first on-curve point to start from
    let startIdx = pts.findIndex((pt) => pt.type === 0);
    if (startIdx === -1) startIdx = 0;

    p.moveTo(pts[startIdx].x, pts[startIdx].y);

    const n = pts.length;
    let i = 1;
    while (i <= n) {
      const pt = pts[(startIdx + i) % n];

      if (pt.type === 0) {
        // on-curve: straight line
        if (i < n) p.lineTo(pt.x, pt.y);
        i++;
      } else if (pt.type === 2) {
        // cubic: two off-curve handles + on-curve end
        const c1 = pt;
        const c2 = pts[(startIdx + i + 1) % n];
        const end = pts[(startIdx + i + 2) % n];
        p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
        i += 3;
      } else {
        // quadratic (type=1): collect consecutive off-curves, implicit on-curves between
        const offCurves = [pt];
        let j = i + 1;
        while (j < i + n) {
          const next = pts[(startIdx + j) % n];
          if (next.type !== 0) {
            offCurves.push(next);
            j++;
          } else break;
        }
        for (let k = 0; k < offCurves.length; k++) {
          const qc = offCurves[k];
          const isLast = k === offCurves.length - 1;
          const qe = isLast
            ? pts[(startIdx + j) % n]
            : {
                x: (offCurves[k].x + offCurves[k + 1].x) / 2,
                y: (offCurves[k].y + offCurves[k + 1].y) / 2,
              };
          p.quadraticCurveTo(qc.x, qc.y, qe.x, qe.y);
        }
        i = j + 1;
      }
    }

    if (isClosed) p.closePath();
  }

  return p;
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
  externalCache,
  sceneSettings = null,
  options = {}
) {
  const glyphController = positionedGlyph?.glyph;
  if (!glyphController) {
    console.warn("No glyphController found");
    return;
  }

  const { paintOverride = null, selfRefPath = null } = options;

  let resolvedPaint = paintOverride;
  if (!resolvedPaint) {
    const instanceCd = glyphController.instance?.customData;
    const varGlyphCd =
      positionedGlyph?.varGlyph?.glyph?.customData ??
      positionedGlyph?.varGlyph?.customData;
    resolvedPaint =
      getPaintGraph(instanceCd) ??
      getLayerPaintGraph(positionedGlyph, sceneSettings) ??
      getPaintGraph(varGlyphCd);
  }
  if (!resolvedPaint) {
    console.warn("No resolvedPaint found");
    return;
  }

  const palettes = fontController.customData?.[PALETTES_KEY];
  if (!palettes?.length) {
    console.warn("No palettes found");
    return;
  }

  const paletteIndex = Math.max(0, Math.min(activePaletteIndex, palettes.length - 1));
  const palette = palettes[paletteIndex];

  // Create or reuse cache for glyph outlines
  const cache = externalCache instanceof Map ? externalCache : new Map();

  // Build render controller wrapper carrying sceneSettings + selfRefPath
  // override for self-references inside _renderPaint / _getOutlinePath2D.
  const needsWrapper =
    (sceneSettings && controller?.sceneSettings !== sceneSettings) || !!selfRefPath;
  const renderController = needsWrapper
    ? Object.assign(Object.create(controller ?? null), {
        sceneSettings: sceneSettings ?? controller?.sceneSettings,
        selfRefPath,
      })
    : controller;

  // Collect ALL clip glyph names from the paint graph and wait until ready
  const clipGlyphs = _collectClipGlyphs(resolvedPaint);
  const currentGlyphName =
    positionedGlyph?.varGlyph?.name ?? positionedGlyph?.varGlyph?.glyph?.name;
  let allReady = true;
  for (const name of clipGlyphs) {
    // Self-ref clip is satisfied by selfRefPath override; skip prefetch.
    if (selfRefPath && name === currentGlyphName) continue;
    const p = _getOutlinePath2D(
      name,
      fontController,
      renderController,
      cache,
      positionedGlyph
    );
    if (!p) allReady = false;
  }

  if (!allReady) return;

  ctx.save();
  _renderPaint(
    ctx,
    resolvedPaint,
    palette,
    axisValues,
    fontController,
    cache,
    positionedGlyph,
    0,
    renderController
  );
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Clip glyph collector
// ---------------------------------------------------------------------------

export function _collectClipGlyphs(paint, result = new Set()) {
  if (!paint) return result;
  switch (paint.type) {
    case "PaintGlyph":
    case "PaintVarGlyph":
      result.add(paint.glyph);
      _collectClipGlyphs(paint.paint, result);
      break;
    case "PaintColrLayers":
      for (const layer of paint.layers ?? []) _collectClipGlyphs(layer, result);
      break;
    case "PaintComposite":
      _collectClipGlyphs(paint.backdropPaint, result);
      _collectClipGlyphs(paint.sourcePaint, result);
      break;
    default:
      if (paint.paint) _collectClipGlyphs(paint.paint, result);
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
  cache,
  positionedGlyph,
  _depth = 0,
  controller
) {
  if (!paint) return;
  if (_depth > 32) {
    console.warn("COLRv1: max recursion depth exceeded");
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
          cache,
          positionedGlyph,
          _depth + 1,
          controller
        );
      }
      break;
    }

    case "PaintGlyph":
    case "PaintVarGlyph": {
      const glyphName = paint.glyph ?? "";
      const currentGlyphName =
        positionedGlyph?.varGlyph?.name ?? positionedGlyph?.varGlyph?.glyph?.name;

      // Check if the referenced glyph has its own COLRv1 data. If the paint
      // references the current glyph, use its outline as a clip path instead
      // of recursing into the same paint graph.
      const refGlyph = fontController.getCachedGlyph?.(glyphName);
      const refPaint = glyphName === currentGlyphName ? null : getPaintGraph(refGlyph);

      if (refPaint) {
        // Render the referenced color glyph directly
        _renderPaint(
          ctx,
          refPaint,
          palette,
          axisValues,
          fontController,
          cache,
          positionedGlyph,
          _depth + 1,
          controller
        );
      } else {
        // Use the glyph outline as a clip path
        const path2d = _getOutlinePath2D(
          glyphName,
          fontController,
          controller,
          cache,
          positionedGlyph
        );
        ctx.save();
        if (path2d) ctx.clip(path2d);
        _renderPaint(
          ctx,
          paint.paint,
          palette,
          axisValues,
          fontController,
          cache,
          positionedGlyph,
          _depth + 1,
          controller
        );
        ctx.restore();
      }
      break;
    }

    case "PaintColrGlyph": {
      const glyphName = paint.glyph ?? "";
      const refGlyph = fontController.getCachedGlyph?.(glyphName);
      const refPaint = getPaintGraph(refGlyph);
      if (refPaint) {
        _renderPaint(
          ctx,
          refPaint,
          palette,
          axisValues,
          fontController,
          cache,
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
        // Degenerate radii - skip rendering
      }
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
      } catch (e) {
        // Skip on error
      }
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
        cache,
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
        cache,
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
        cache,
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
        cache,
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
        cache,
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
        cache,
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
        cache,
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
        cache,
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
        cache,
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
        cache,
        positionedGlyph,
        _depth + 1,
        controller
      );
      ctx.restore();
      break;
    }

    case "PaintComposite": {
      // Get canvas dimensions from current transform
      const dpr = window.devicePixelRatio || 1;
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;

      // Render backdrop into offscreen buffer
      const backdropCanvas = new OffscreenCanvas(w, h);
      const backdropCtx = backdropCanvas.getContext("2d");
      backdropCtx.setTransform(ctx.getTransform());
      _renderPaint(
        backdropCtx,
        paint.backdropPaint,
        palette,
        axisValues,
        fontController,
        cache,
        positionedGlyph,
        _depth + 1,
        controller
      );

      // Render source into offscreen buffer
      const sourceCanvas = new OffscreenCanvas(w, h);
      const sourceCtx = sourceCanvas.getContext("2d");
      sourceCtx.setTransform(ctx.getTransform());
      _renderPaint(
        sourceCtx,
        paint.sourcePaint,
        palette,
        axisValues,
        fontController,
        cache,
        positionedGlyph,
        _depth + 1,
        controller
      );

      // Composite source onto backdrop
      backdropCtx.globalCompositeOperation = _compositeMode(paint.compositeMode);
      backdropCtx.setTransform(1, 0, 0, 1, 0, 0); // reset for drawImage
      backdropCtx.drawImage(sourceCanvas, 0, 0);

      // Paint the composited result onto the main canvas
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0); // reset for drawImage
      ctx.drawImage(backdropCanvas, 0, 0);
      ctx.restore();
      break;
    }
    default:
      // Unknown paint type - ignore
      break;
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

const BIG = 100000;

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
      // Skip invalid color stops
    }
  }
}

function _paletteColor(palette, index, alphaOverride = 1.0, ctx = null) {
  // Interpolation can produce fractional palette indices when all masters
  // happen to share the same index; round before CPAL lookup.
  if (typeof index === "number" && !Number.isInteger(index)) {
    index = Math.round(index);
  }
  // 0xFFFF = COLRv1 "use foreground color" — same as what the editor set on ctx
  if (index === 0xffff || index === 65535) {
    const fg = ctx?.fillStyle ?? "rgba(0,0,0,1)";
    // apply alphaOverride to whatever the theme color is
    return fg;
  }
  const entry = palette?.[index];
  if (!entry) return `rgba(0,0,0,${alphaOverride})`;

  const [r, g, b, a = 1.0] = entry;
  const finalAlpha = a * alphaOverride;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(
    b * 255
  )}, ${finalAlpha.toFixed(4)})`;
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

// ---------------------------------------------------------------------------
// Glyph outline path resolver
// ---------------------------------------------------------------------------

// Module-level — outside the function
const _resolvedPathCache = new Map();
const _pendingGlyphs = new Set();

function _getOutlinePath2D(
  glyphName,
  fontController,
  controller,
  cache,
  positionedGlyph
) {
  if (!cache || typeof cache.has !== "function") return null;
  const currentGlyphName =
    positionedGlyph?.varGlyph?.name ?? positionedGlyph?.varGlyph?.glyph?.name;
  const editLayerName =
    glyphName === currentGlyphName ? controller?.sceneSettings?.editLayerName : null;
  const cacheKey = editLayerName ? `${glyphName}\u0000${editLayerName}` : glyphName;

  // Per-call selfRefPath override bypasses all caching — different stacked
  // sibling-layer renders pass different override paths under the same key.
  if (glyphName === currentGlyphName && controller?.selfRefPath) {
    return controller.selfRefPath;
  }

  // 1. Check frame cache
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // 2. Check module-level resolved cache (survives across frames)
  if (_resolvedPathCache.has(cacheKey)) {
    const p = _resolvedPathCache.get(cacheKey);
    cache.set(cacheKey, p);
    return p;
  }

  // 3. Self-reference: clip glyph IS the glyph being rendered.
  // selfRefPath override (set when stacking sibling layers out of edit mode)
  // takes priority; otherwise gc.flattenedPath2d already reflects the active
  // edit layer (the StaticGlyphController is rebuilt per layerName).
  if (glyphName === currentGlyphName) {
    const gc = positionedGlyph?.glyph;
    const path =
      gc?.flattenedPath2d ?? _convertFontraPathToPath2D(gc?.instance?.path);
    if (path) {
      _resolvedPathCache.set(cacheKey, path);
      cache.set(cacheKey, path);
      return path;
    }
  }

  // 4. Try synchronous scene controller
  const gc = controller?.glyphControllers?.get(glyphName);
  let path = gc?.flattenedPath2d || gc?.instance?.path2d;

  if (!path) {
    const sceneGc = controller?.sceneModel?.getGlyphController?.(glyphName);
    if (sceneGc && !(sceneGc instanceof Promise)) {
      path = sceneGc?.flattenedPath2d || sceneGc?.instance?.path2d;
    }
  }

  if (!_pendingGlyphs.has(glyphName)) {
    _pendingGlyphs.add(glyphName);

    const instancePromise = fontController.getGlyphInstance?.(
      glyphName,
      {}, // location — empty = default
      {} // options
    );

    if (instancePromise instanceof Promise) {
      instancePromise
        .then((staticGc) => {
          _pendingGlyphs.delete(glyphName);
          const path =
            staticGc?.flattenedPath2d ??
            _convertFontraPathToPath2D(staticGc?.instance?.path);
          if (path) {
            _resolvedPathCache.set(cacheKey, path);
            controller?.requestUpdate?.();
          } else {
            console.warn(`No path from getGlyphInstance for ${glyphName}`, staticGc);
          }
        })
        .catch((e) => {
          _pendingGlyphs.delete(glyphName);
          console.warn("getGlyphInstance error for", glyphName, e);
        });
    } else {
      _pendingGlyphs.delete(glyphName);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Path conversion helpers
// ---------------------------------------------------------------------------

export function convertFontraPathToPath2D(pathData) {
  return _convertFontraPathToPath2D(pathData);
}

function _convertFontraPathToPath2D(pathData) {
  if (!pathData) return new Path2D();
  if (pathData instanceof Path2D) return pathData;

  const p = new Path2D();

  // Handle unpacked contours format (from Fontra)
  if (Array.isArray(pathData.contours)) {
    for (const contour of pathData.contours) {
      if (!contour.points?.length) continue;

      const points = contour.points;
      const isClosed = contour.isClosed;

      p.moveTo(points[0].x, points[0].y);

      let i = 1;
      while (i < points.length) {
        const pt = points[i];
        const type = pt.type;

        if (type === "line" || type === "move" || type == null) {
          p.lineTo(pt.x, pt.y);
          i++;
        } else if (type === "cubic") {
          const c1 = pt;
          const c2 = points[i + 1];
          const end = points[i + 2];
          if (c2 && end) {
            p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
            i += 3;
          } else {
            p.lineTo(pt.x, pt.y);
            i++;
          }
        } else if (type === "quad") {
          const control = pt;
          const end = points[i + 1];
          if (end) {
            p.quadraticCurveTo(control.x, control.y, end.x, end.y);
            i += 2;
          } else {
            p.lineTo(pt.x, pt.y);
            i++;
          }
        } else {
          p.lineTo(pt.x, pt.y);
          i++;
        }
      }

      if (isClosed) p.closePath();
    }
  }
  // Handle packed path format
  else if (pathData.pointTypes && pathData.coordinates && pathData.contourInfo) {
    _convertPackedPathToPath2D(p, pathData);
  }

  return p;
}

function _convertPackedPathToPath2D(p, path) {
  const coords = path.coordinates;
  const types = path.pointTypes;
  const contourInfo = path.contourInfo;

  let pointIndex = 0;
  let coordIndex = 0;
  let startPoint = 0;

  for (let contourIdx = 0; contourIdx < contourInfo.length; contourIdx++) {
    const info = contourInfo[contourIdx];
    // VarPackedPath contour entries store {endPoint, isClosed}; derive count.
    const numPoints =
      typeof info.length === "number" ? info.length : info.endPoint - startPoint + 1;
    const isClosed = info.isClosed;
    startPoint = (info.endPoint ?? startPoint + numPoints - 1) + 1;

    if (numPoints === 0) continue;

    let x = coords[coordIndex];
    let y = coords[coordIndex + 1];
    p.moveTo(x, y);
    coordIndex += 2;
    pointIndex++;

    let i = 1;
    while (i < numPoints) {
      // VarPackedPath encoding: ON_CURVE=0x00, OFF_CURVE_QUAD=0x01,
      // OFF_CURVE_CUBIC=0x02 (mask 0x07; high bits are flags like SMOOTH).
      const pointType = types[pointIndex] & 0x07;
      const isOnCurve = pointType === 0x00;
      const isCubic = pointType === 0x02;

      x = coords[coordIndex];
      y = coords[coordIndex + 1];
      coordIndex += 2;

      if (isOnCurve) {
        p.lineTo(x, y);
        i++;
        pointIndex++;
      } else if (isCubic) {
        if (i + 2 <= numPoints) {
          const c1 = { x, y };
          const c2x = coords[coordIndex];
          const c2y = coords[coordIndex + 1];
          coordIndex += 2;
          const endX = coords[coordIndex];
          const endY = coords[coordIndex + 1];
          coordIndex += 2;
          p.bezierCurveTo(c1.x, c1.y, c2x, c2y, endX, endY);
          i += 3;
          pointIndex += 3;
        } else {
          p.lineTo(x, y);
          i++;
          pointIndex++;
        }
      } else {
        if (i + 1 <= numPoints) {
          const control = { x, y };
          const endX = coords[coordIndex];
          const endY = coords[coordIndex + 1];
          coordIndex += 2;
          p.quadraticCurveTo(control.x, control.y, endX, endY);
          i += 2;
          pointIndex += 2;
        } else {
          p.lineTo(x, y);
          i++;
          pointIndex++;
        }
      }
    }

    if (isClosed) p.closePath();
  }
}

function _isEmptyPath(path) {
  if (!path) return true;
  if (path instanceof Path2D) return false;
  return !(
    path.contours?.length > 0 ||
    path.coordinates?.length > 0 ||
    path.commands?.length > 0
  );
}
