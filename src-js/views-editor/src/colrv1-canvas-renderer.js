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
  console.log("getPaintGraph called with:", customData);

  if (!customData) {
    console.log("No customData");
    return null;
  }

  // Primary: .fontra format and converted TTF/OTF data
  const fontraFormat = customData[COLRV1_KEY];
  console.log(`Checking customData["${COLRV1_KEY}"]:`, fontraFormat);

  if (fontraFormat) {
    console.log("Found Fontra format paint");
    return fontraFormat;
  }

  // Fallback: legacy storage
  const paintGraph = customData["fontra.colrv1.paintGraph"];
  console.log('Checking customData["fontra.colrv1.paintGraph"]:', paintGraph);

  if (paintGraph) {
    console.log("Found legacy paintGraph");
    return paintGraph;
  }

  console.log("No paint found");
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
// Public entry point
// ---------------------------------------------------------------------------

export function renderCOLRv1(
  ctx,
  positionedGlyph,
  fontController,
  axisValues,
  activePaletteIndex = 0,
  controller = null,
  externalCache
) {
  // DEBUG: Log entry point
  console.log("=== renderCOLRv1 called ===");
  console.log("positionedGlyph:", positionedGlyph);

  const glyphController = positionedGlyph?.glyph;
  if (!glyphController) {
    console.warn("No glyphController found");
    return;
  }

  const instanceCd = glyphController.instance?.customData;
  const varGlyphCd =
    positionedGlyph?.varGlyph?.glyph?.customData ??
    positionedGlyph?.varGlyph?.customData;

  // DEBUG: Log customData sources
  console.log("instanceCd:", instanceCd);
  console.log("varGlyphCd:", varGlyphCd);
  console.log("COLRV1_KEY value:", COLRV1_KEY);

  // Get the paint graph
  const resolvedPaint = getPaintGraph(instanceCd) ?? getPaintGraph(varGlyphCd);

  // DEBUG: Log the resolved paint
  console.log("resolvedPaint:", resolvedPaint);

  if (!resolvedPaint) {
    console.warn("No resolvedPaint found");
    return;
  }

  const palettes = fontController.customData?.[PALETTES_KEY];

  // DEBUG: Log palette info
  console.log("palettes:", palettes);
  console.log("activePaletteIndex:", activePaletteIndex);

  if (!palettes?.length) {
    console.warn("No palettes found");
    return;
  }

  const paletteIndex = Math.max(0, Math.min(activePaletteIndex, palettes.length - 1));
  const palette = palettes[paletteIndex];

  // DEBUG: Log selected palette
  console.log("Selected palette index:", paletteIndex);
  console.log("Selected palette:", palette);
  console.log(
    "fontController methods:",
    Object.getOwnPropertyNames(Object.getPrototypeOf(fontController)).filter((m) =>
      m.toLowerCase().includes("glyph")
    )
  );

  // Create or reuse cache for glyph outlines
  const cache = externalCache instanceof Map ? externalCache : new Map();
  // Collect ALL clip glyph names from the paint graph
  const clipGlyphs = _collectClipGlyphs(resolvedPaint);
  const allGlyphsToFetch = clipGlyphs; // no referencedGlyphs to merge anymore

  console.log("glyphs to fetch:", [...allGlyphsToFetch]);

  let allReady = true;
  for (const name of allGlyphsToFetch) {
    const p = _getOutlinePath2D(
      name,
      fontController,
      controller,
      cache,
      positionedGlyph
    );
    if (!p) {
      console.log(`Waiting for ${name}...`);
      allReady = false;
    }
  }

  if (!allReady) {
    console.log("Not all clip glyphs ready, skipping render");
    return;
  }

  // Render the paint graph
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
    controller
  );
  ctx.restore();

  // DEBUG: Log completion
  console.log("=== renderCOLRv1 completed ===");
}
//  function to collect component paints
function _collectClipGlyphs(paint, result = new Set()) {
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

      // Check if the referenced glyph has its own COLRv1 data
      const refGlyph = fontController.getCachedGlyph?.(glyphName);
      const refPaint = getPaintGraph(refGlyph);

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

        if (path2d) {
          ctx.clip(path2d);
        }

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

      // Calculate perpendicular gradient direction
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
      ctx.save();
      _renderPaint(
        ctx,
        paint.backdropPaint,
        palette,
        axisValues,
        fontController,
        cache,
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
        cache,
        positionedGlyph,
        _depth + 1,
        controller
      );
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

function _paletteColor(palette, index, alphaOverride = 1.0) {
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

  // 1. Check frame cache
  if (cache.has(glyphName)) return cache.get(glyphName);

  // 2. Check module-level resolved cache (survives across frames)
  if (_resolvedPathCache.has(glyphName)) {
    const p = _resolvedPathCache.get(glyphName);
    cache.set(glyphName, p);
    return p;
  }

  // 3. Self-reference: clip glyph IS the glyph being rendered
  const currentGlyphName =
    positionedGlyph?.varGlyph?.name ?? positionedGlyph?.varGlyph?.glyph?.name;

  if (glyphName === currentGlyphName) {
    const gc = positionedGlyph?.glyph;
    const path = gc?.flattenedPath2d ?? _convertFontraPathToPath2D(gc?.instance?.path);
    if (path) {
      _resolvedPathCache.set(glyphName, path);
      cache.set(glyphName, path);
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

    // getGlyphInstance returns a StaticGlyphController with flattenedPath2d
    const instancePromise = fontController.getGlyphInstance?.(
      glyphName,
      {}, // location — empty = default
      {} // options
    );

    if (instancePromise instanceof Promise) {
      instancePromise
        .then((staticGc) => {
          console.log(
            `[getGlyphInstance] "${glyphName}":`,
            staticGc,
            "flattenedPath2d:",
            staticGc?.flattenedPath2d
          );
          _pendingGlyphs.delete(glyphName);

          const path =
            staticGc?.flattenedPath2d ??
            _convertFontraPathToPath2D(staticGc?.instance?.path);
          if (path) {
            _resolvedPathCache.set(glyphName, path);
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

// New helper function to convert Fontra path format to Path2D with curve support
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

      // Move to first point
      p.moveTo(points[0].x, points[0].y);

      let i = 1;
      while (i < points.length) {
        const pt = points[i];
        const type = pt.type;

        if (type === "line" || type === "move" || type == null) {
          // Line segment
          p.lineTo(pt.x, pt.y);
          i++;
        } else if (type === "cubic") {
          // Cubic bezier curve: needs 3 points (control1, control2, end)
          const c1 = pt;
          const c2 = points[i + 1];
          const end = points[i + 2];
          if (c2 && end) {
            p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
            i += 3;
          } else {
            // Invalid cubic, treat as line
            p.lineTo(pt.x, pt.y);
            i++;
          }
        } else if (type === "quad") {
          // Quadratic bezier curve: needs 2 points (control, end)
          const control = pt;
          const end = points[i + 1];
          if (end) {
            p.quadraticCurveTo(control.x, control.y, end.x, end.y);
            i += 2;
          } else {
            // Invalid quad, treat as line
            p.lineTo(pt.x, pt.y);
            i++;
          }
        } else {
          // Unknown type, treat as line
          p.lineTo(pt.x, pt.y);
          i++;
        }
      }

      if (isClosed) {
        p.closePath();
      }
    }
  }
  // Handle packed path format
  else if (pathData.pointTypes && pathData.coordinates && pathData.contourInfo) {
    _convertPackedPathToPath2D(p, pathData);
  }

  return p;
}

// Helper to convert packed path format with proper curves
function _convertPackedPathToPath2D(p, path) {
  const coords = path.coordinates;
  const types = path.pointTypes;
  const contourInfo = path.contourInfo;

  let pointIndex = 0;
  let coordIndex = 0;

  for (let contourIdx = 0; contourIdx < contourInfo.length; contourIdx++) {
    const info = contourInfo[contourIdx];
    const numPoints = info.length;
    const isClosed = info.isClosed;
    const startPointIndex = pointIndex;

    if (numPoints === 0) continue;

    // Get the first point
    let x = coords[coordIndex];
    let y = coords[coordIndex + 1];
    p.moveTo(x, y);
    coordIndex += 2;
    pointIndex++;

    let i = 1;
    while (i < numPoints) {
      const pointType = types[pointIndex];
      const isOnCurve = !!(pointType & 0x01);
      const isCubic = !!(pointType & 0x02); // Cubic flag

      x = coords[coordIndex];
      y = coords[coordIndex + 1];
      coordIndex += 2;

      if (isOnCurve) {
        // On-curve point - line segment
        p.lineTo(x, y);
        i++;
        pointIndex++;
      } else if (isCubic) {
        // Cubic bezier - need 2 more points (control2 and end)
        if (i + 2 <= numPoints) {
          const c1 = { x, y };

          // Control point 2
          const c2x = coords[coordIndex];
          const c2y = coords[coordIndex + 1];
          coordIndex += 2;

          // End point (on-curve)
          const endX = coords[coordIndex];
          const endY = coords[coordIndex + 1];
          coordIndex += 2;

          p.bezierCurveTo(c1.x, c1.y, c2x, c2y, endX, endY);
          i += 3;
          pointIndex += 3;
        } else {
          // Invalid cubic, treat as line
          p.lineTo(x, y);
          i++;
          pointIndex++;
        }
      } else {
        // Quadratic bezier - need 1 more point (end)
        if (i + 1 <= numPoints) {
          const control = { x, y };

          // End point (on-curve)
          const endX = coords[coordIndex];
          const endY = coords[coordIndex + 1];
          coordIndex += 2;

          p.quadraticCurveTo(control.x, control.y, endX, endY);
          i += 2;
          pointIndex += 2;
        } else {
          // Invalid quad, treat as line
          p.lineTo(x, y);
          i++;
          pointIndex++;
        }
      }
    }

    if (isClosed) {
      p.closePath();
    }
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
