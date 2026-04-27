// edit-tools-paint.js
// On-screen color-stop / gradient-handle editor for COLRv1 paint layers.
// Mirrors the structure of edit-tools-shape.js (ShapeTool / BaseTool pattern).

import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import {
  glyphSelector,
  registerVisualizationLayerDefinition,
} from "./visualization-layer-definitions.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLRV1_KEY = "colorv1";
const HANDLE_RADIUS = 8; // screen pixels
const HIT_RADIUS = 12; // screen pixels – larger for easier picking

// Paint types that are transform wrappers (the layer IS the paint, not layer.paint)
const TRANSFORM_WRAPPER_TYPES = new Set([
  "PaintTransform",
  "PaintTranslate",
  "PaintRotate",
  "PaintRotateAroundCenter",
  "PaintScale",
  "PaintScaleAroundCenter",
  "PaintScaleUniform",
  "PaintScaleUniformAroundCenter",
  "PaintSkew",
  "PaintSkewAroundCenter",
]);

// ─── Top-level tool wrapper ────────────────────────────────────────────────────

export class PaintTool {
  identifier = "paint-tool";
  subTools = [UnifiedPaintTool];
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

/** Return the COLRv1 paint object from the current glyph instance, or null. */
function getV1Paint(sceneController) {
  const pg = sceneController.sceneModel.getSelectedPositionedGlyph();
  return pg?.glyph?.instance?.customData?.[COLRV1_KEY] ?? null;
}

/**
 * Write back a mutated paint object through the undo-aware mutation API.
 * Mirrors _writeV1Paint in panel-color-layers.js.
 */
async function writeV1Paint(sceneController, newPaint) {
  await sceneController.editGlyphAndRecordChanges((varGlyph) => {
    const defaultSource =
      varGlyph.sources?.find((s) => !s.inactive && !s.locationBase) ??
      varGlyph.sources?.[0];
    const layerGlyph = varGlyph.layers?.[defaultSource?.layerName]?.glyph;
    if (layerGlyph) {
      if (!layerGlyph.customData) layerGlyph.customData = {};
      layerGlyph.customData[COLRV1_KEY] = newPaint;
    }
    return "Move paint handle";
  });
}

/** Compute bounds from raw path coordinates when controlBounds is absent. */
function boundsFromPath(path) {
  const coords = path?.coordinates;
  if (!coords?.length) return null;
  let xMin = Infinity,
    yMin = Infinity,
    xMax = -Infinity,
    yMax = -Infinity;
  for (let i = 0; i < coords.length; i += 2) {
    const x = coords[i],
      y = coords[i + 1];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}

/**
 * Apply the PaintTransform 2×2+translation matrix to a child-space point.
 *   x' = dx + xx*x + xy*y
 *   y' = dy + yx*x + yy*y
 */
function applyMatrix({ xx = 1, yx = 0, xy = 0, yy = 1, dx = 0, dy = 0 }, x, y) {
  return { x: dx + xx * x + xy * y, y: dy + yx * x + yy * y };
}

/**
 * Collect all draggable on-screen handles for a given paint graph.
 * glyphBoundsCache: Map<glyphName, bounds|null> — populated async by the tool.
 * Returns an array of { layerIdx, role, x, y, [refX, refY, box] }.
 */
function collectHandles(paint, glyphBoundsCache) {
  const handles = [];
  if (!paint?.layers) return handles;

  paint.layers.forEach((layer, i) => {
    const isWrapper = TRANSFORM_WRAPPER_TYPES.has(
      layer.type?.replace(/^PaintVar/, "Paint")
    );
    const p = isWrapper ? layer : layer.paint ?? layer;
    if (!p?.type) return;

    const t = p.type.replace(/^PaintVar/, "Paint");

    // ── Gradient paint types ──────────────────────────────────────────────────
    if (t === "PaintLinearGradient") {
      handles.push({ layerIdx: i, role: "p0", x: p.x0 ?? 0, y: p.y0 ?? 0 });
      handles.push({ layerIdx: i, role: "p1", x: p.x1 ?? 0, y: p.y1 ?? 0 });
      handles.push({ layerIdx: i, role: "p2", x: p.x2 ?? 0, y: p.y2 ?? 0 });
    } else if (t === "PaintRadialGradient") {
      handles.push({ layerIdx: i, role: "center0", x: p.x0 ?? 0, y: p.y0 ?? 0 });
      handles.push({ layerIdx: i, role: "center1", x: p.x1 ?? 0, y: p.y1 ?? 0 });
    } else if (t === "PaintSweepGradient") {
      const cx = p.centerX ?? 0,
        cy = p.centerY ?? 0;
      handles.push({ layerIdx: i, role: "sweepCenter", x: cx, y: cy });
      const R = 100;
      const startRad = (p.startAngle ?? 0) * 180 * (Math.PI / 180);
      const endRad = (p.endAngle ?? 0.5) * 180 * (Math.PI / 180);
      handles.push({
        layerIdx: i,
        role: "sweepStart",
        x: cx + R * Math.cos(startRad),
        y: cy + R * Math.sin(startRad),
      });
      handles.push({
        layerIdx: i,
        role: "sweepEnd",
        x: cx + R * Math.cos(endRad),
        y: cy + R * Math.sin(endRad),
      });
    } else if (t === "PaintSolid") {
      handles.push({ layerIdx: i, role: "solid", x: 0, y: 0 });

      // ── Transform paint types ─────────────────────────────────────────────────
    } else if (t === "PaintTranslate") {
      handles.push({ layerIdx: i, role: "translate", x: p.dx ?? 0, y: p.dy ?? 0 });
    } else if (t === "PaintTransform") {
      const mat = p.transform ?? { xx: 1, yx: 0, xy: 0, yy: 1, dx: 0, dy: 0 };
      const { dx = 0, dy = 0 } = mat;

      // Child glyph name is on p.paint (PaintTransform wraps a PaintGlyph)
      const childName = p.paint?.glyph ?? p.paint?.paint?.glyph ?? null;
      const bounds = glyphBoundsCache?.get(childName) ?? null;

      if (bounds) {
        // Place axis handles at transformed bbox corners — same approach as component tool.
        // X-axis handle: top-right corner of child bbox
        // Y-axis handle: top-left corner of child bbox (same top, different x)
        const trX = bounds.xMax,
          trY = bounds.yMax;
        const blX = bounds.xMin,
          blY = bounds.yMin;

        const origin = applyMatrix(mat, 0, 0);
        const xHandle = applyMatrix(mat, trX, trY);
        const yHandle = applyMatrix(mat, blX, blY);

        handles.push({ layerIdx: i, role: "xfm-origin", x: origin.x, y: origin.y });
        handles.push({
          layerIdx: i,
          role: "xfm-scaleX",
          x: xHandle.x,
          y: xHandle.y,
          refX: trX,
          refY: trY,
        });
        handles.push({
          layerIdx: i,
          role: "xfm-scaleY",
          x: yHandle.x,
          y: yHandle.y,
          refX: blX,
          refY: blY,
        });
      } else {
        // Bounds not yet loaded — use fallback unit arms; redraws when cache fills.
        const FALLBACK = 200;
        handles.push({ layerIdx: i, role: "xfm-origin", x: dx, y: dy });
        handles.push({
          layerIdx: i,
          role: "xfm-scaleX",
          x: dx + mat.xx * FALLBACK,
          y: dy + mat.yx * FALLBACK,
          refX: FALLBACK,
          refY: 0,
        });
        handles.push({
          layerIdx: i,
          role: "xfm-scaleY",
          x: dx + mat.xy * FALLBACK,
          y: dy + mat.yy * FALLBACK,
          refX: 0,
          refY: FALLBACK,
        });
      }
    } else if (t === "PaintRotate" || t === "PaintRotateAroundCenter") {
      const cx = p.centerX ?? 0,
        cy = p.centerY ?? 0;
      const angleRad = (p.angle ?? 0) * Math.PI * 2; // COLR turns → radians
      handles.push({ layerIdx: i, role: "rot-center", x: cx, y: cy });
      handles.push({
        layerIdx: i,
        role: "rot-handle",
        x: cx + 80 * Math.cos(angleRad),
        y: cy + 80 * Math.sin(angleRad),
      });
    } else if (
      t === "PaintScale" ||
      t === "PaintScaleAroundCenter" ||
      t === "PaintScaleUniform" ||
      t === "PaintScaleUniformAroundCenter"
    ) {
      const cx = p.centerX ?? 0,
        cy = p.centerY ?? 0;
      handles.push({ layerIdx: i, role: "scale-center", x: cx, y: cy });
      handles.push({
        layerIdx: i,
        role: "scale-x",
        x: cx + (p.scaleX ?? p.scale ?? 1) * 60,
        y: cy,
      });
      handles.push({
        layerIdx: i,
        role: "scale-y",
        x: cx,
        y: cy + (p.scaleY ?? p.scale ?? 1) * 60,
      });
    } else if (t === "PaintSkew" || t === "PaintSkewAroundCenter") {
      const cx = p.centerX ?? 0,
        cy = p.centerY ?? 0;
      handles.push({ layerIdx: i, role: "skew-center", x: cx, y: cy });
      handles.push({
        layerIdx: i,
        role: "skew-x",
        x: cx + 60,
        y: cy + Math.tan((p.xSkewAngle ?? 0) * Math.PI) * 60,
      });
    }
  });

  return handles;
}

// ─── Role dispatch maps ────────────────────────────────────────────────────────

/**
 * Roles where commit writes directly to xKey/yKey on fillPaint (or a nested
 * sub-object when `nested` is set).
 */
const DIRECT_ROLE_MAP = {
  "p0": { xKey: "x0", yKey: "y0" },
  "p1": { xKey: "x1", yKey: "y1" },
  "p2": { xKey: "x2", yKey: "y2" },
  "center0": { xKey: "x0", yKey: "y0" },
  "center1": { xKey: "x1", yKey: "y1" },
  "sweepCenter": { xKey: "centerX", yKey: "centerY" },
  "r0": { xKey: "x0", yKey: "y0" },
  "r1": { xKey: "x1", yKey: "y1" },
  "translate": { xKey: "dx", yKey: "dy" },
  "rot-center": { xKey: "centerX", yKey: "centerY" },
  "scale-center": { xKey: "centerX", yKey: "centerY" },
  "skew-center": { xKey: "centerX", yKey: "centerY" },
  "xfm-origin": { nested: "transform", xKey: "dx", yKey: "dy" },
};

/** Roles where commit computes an angle from the pointer vector to a center. */
const ANGLE_ROLE_MAP = {
  "sweepStart": { angleKey: "startAngle" },
  "sweepEnd": { angleKey: "endAngle" },
  "rot-handle": { angleKey: "angle" },
};

/** Roles that need fully custom commit logic (not covered by the two maps above). */
const CUSTOM_ROLES = new Set([
  "scale-x",
  "scale-y",
  "skew-x",
  "xfm-scaleX",
  "xfm-scaleY",
]);

// ─── Unified paint tool ────────────────────────────────────────────────────────

export class UnifiedPaintTool extends BaseTool {
  iconPath = "/images/paintbrush.svg";
  identifier = "paint-tool-unified";

  /** Map<glyphName, bounds|null> — populated async, invalidated on glyphChanged. */
  _glyphBoundsCache = new Map();
  /** Set<glyphName> — guards against concurrent duplicate fetches. */
  _glyphBoundsFetching = new Set();

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  activate() {
    super.activate?.();
    this._glyphBoundsCache.clear();
    this._glyphBoundsFetching.clear();

    // Invalidate and refetch bounds every time the glyph changes so handles
    // always reflect the current child glyph shape.
    this._onGlyphChanged = () => {
      this._glyphBoundsCache.clear();
      this._glyphBoundsFetching.clear();
      this._prefetchAllChildBounds();
    };
    this.sceneController.addEventListener("glyphChanged", this._onGlyphChanged);

    // Prefetch on activation for glyphs already in the scene.
    this._prefetchAllChildBounds();
  }

  deactivate() {
    super.deactivate();
    this.sceneController.removeEventListener("glyphChanged", this._onGlyphChanged);
    delete this.sceneModel.paintToolHandles;
    delete this.sceneModel.paintToolHighlight;
    this.canvasController.requestUpdate();
  }

  // ── Cursor ──────────────────────────────────────────────────────────────────

  setCursor(hit = null) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.canvasController.canvas.style.cursor = "default";
      return;
    }
    if (hit?.role === "solid") {
      this.canvasController.canvas.style.cursor = "cell";
    } else if (hit?.role === "translate" || hit?.role === "xfm-origin") {
      this.canvasController.canvas.style.cursor = "move";
    } else if (hit?.role === "rot-handle") {
      this.canvasController.canvas.style.cursor = "alias";
    } else if (
      hit?.role?.startsWith("xfm-scale") ||
      hit?.role === "scale-x" ||
      hit?.role === "scale-y"
    ) {
      this.canvasController.canvas.style.cursor = "nwse-resize";
    } else if (hit?.role === "skew-x") {
      this.canvasController.canvas.style.cursor = "col-resize";
    } else if (hit) {
      this.canvasController.canvas.style.cursor = "crosshair";
    } else {
      this.canvasController.canvas.style.cursor = "default";
    }
  }

  // ── Hover ───────────────────────────────────────────────────────────────────

  handleHover(event) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.editor.tools["pointer-tool"].handleHover(event);
      return;
    }
    this._updateHighlight(event);
  }

  // ── Drag / Click ─────────────────────────────────────────────────────────────

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }

    const hit = this._hitTest(initialEvent);
    if (!hit) return;

    if (hit.role === "solid") {
      await this._cyclePaletteIndex(hit.layerIdx, initialEvent.shiftKey ? -1 : 1);
      for await (const _ev of eventStream) {
        break;
      }
      return;
    }

    await this.dragHandle(hit, eventStream, initialEvent);
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  _getHandles() {
    const paint = getV1Paint(this.sceneController);
    return paint ? collectHandles(paint, this._glyphBoundsCache) : [];
  }

  _glyphPoint(event) {
    return this.sceneController.selectedGlyphPoint(event);
  }

  glyphPoint(event) {
    return this.sceneController.selectedGlyphPoint(event);
  }

  _hitTest(event) {
    const pt = this._glyphPoint(event);
    if (pt.x === undefined) return null;

    const handles = this._getHandles();
    const scale = this.canvasController.magnification ?? 1;
    const threshold = HIT_RADIUS / scale;

    let best = null,
      bestDist = Infinity;
    for (const h of handles) {
      const dist = Math.hypot(h.x - pt.x, h.y - pt.y);
      if (dist < threshold && dist < bestDist) {
        best = h;
        bestDist = dist;
      }
    }
    return best;
  }

  _updateHighlight(event) {
    const hit = this._hitTest(event);
    this.sceneModel.paintToolHighlight = hit;
    this.sceneModel.paintToolHandles = this._getHandles();
    this.setCursor(hit);
    this.canvasController.requestUpdate();
  }

  // ── Async bounds prefetch ────────────────────────────────────────────────────

  /**
   * Walk all paint layers in the current glyph and prefetch bounds for every
   * child glyph referenced by a PaintTransform.
   */
  _prefetchAllChildBounds() {
    const paint = getV1Paint(this.sceneController);
    if (!paint?.layers) return;

    for (const layer of paint.layers) {
      const t = layer.type?.replace(/^PaintVar/, "Paint");
      if (t === "PaintTransform") {
        const childName = layer.paint?.glyph ?? layer.paint?.paint?.glyph ?? null;
        if (childName) this._prefetchChildGlyphBounds(childName);
      }
    }
  }

  /**
   * Async-fetch controlBounds for a named glyph and store in the cache.
   * On completion triggers a handle redraw so handles snap to real positions.
   * Protected against concurrent duplicate fetches via _glyphBoundsFetching.
   */
  async _prefetchChildGlyphBounds(glyphName) {
    if (!glyphName) return;
    if (this._glyphBoundsCache.has(glyphName)) return; // already cached
    if (this._glyphBoundsFetching.has(glyphName)) return; // in flight

    this._glyphBoundsFetching.add(glyphName);
    try {
      const varGlyph = await this.sceneController.fontController.getGlyph(glyphName);
      const defaultSource =
        varGlyph?.sources?.find((s) => !s.inactive && !s.locationBase) ??
        varGlyph?.sources?.[0];
      const layerGlyph = varGlyph?.layers?.[defaultSource?.layerName]?.glyph;
      const path = layerGlyph?.path;
      const bounds = path?.controlBounds ?? boundsFromPath(path);

      // Store result — null means "glyph exists but has no path" — prevents
      // repeated fetches for glyphs that will never have bounds.
      this._glyphBoundsCache.set(glyphName, bounds ?? null);

      // Redraw with real bounds
      this.sceneModel.paintToolHandles = this._getHandles();
      this.canvasController.requestUpdate();
    } catch (_e) {
      this._glyphBoundsCache.set(glyphName, null);
    } finally {
      this._glyphBoundsFetching.delete(glyphName);
    }
  }

  // ── Drag handle ──────────────────────────────────────────────────────────────

  async dragHandle(hit, eventStream, initialEvent) {
    const initialPt = this.glyphPoint(initialEvent);
    if (!(await shouldInitiateDrag(eventStream, initialEvent))) return;

    const paint = getV1Paint(this.sceneController);
    if (!paint) return;

    const layer = paint.layers[hit.layerIdx];
    const isWrapper = TRANSFORM_WRAPPER_TYPES.has(
      layer.type?.replace(/^PaintVar/, "Paint")
    );
    const fillPaint = isWrapper ? layer : layer.paint ?? layer;

    // ── Branch A: angle handles ──────────────────────────────────────────────
    if (ANGLE_ROLE_MAP[hit.role]) {
      for await (const event of eventStream) {
        const pt = this.glyphPoint(event);
        if (pt.x === undefined) continue;
        this.sceneModel.paintToolDragPreview = {
          layerIdx: hit.layerIdx,
          role: hit.role,
          x: hit.x + (pt.x - initialPt.x),
          y: hit.y + (pt.y - initialPt.y),
        };
        this.canvasController.requestUpdate();
      }
      const preview = this.sceneModel.paintToolDragPreview;
      if (preview) {
        await this.commitHandleDrag(hit, preview.x, preview.y, paint);
        delete this.sceneModel.paintToolDragPreview;
      }
      this.canvasController.requestUpdate();
      return;
    }

    // ── Branch B: custom commit roles ────────────────────────────────────────
    if (CUSTOM_ROLES.has(hit.role)) {
      for await (const event of eventStream) {
        const pt = this.glyphPoint(event);
        if (pt.x === undefined) continue;
        this.sceneModel.paintToolDragPreview = {
          layerIdx: hit.layerIdx,
          role: hit.role,
          x: hit.x + (pt.x - initialPt.x),
          y: hit.y + (pt.y - initialPt.y),
        };
        this.canvasController.requestUpdate();
      }
      const preview = this.sceneModel.paintToolDragPreview;
      if (preview) {
        await this.commitHandleDrag(hit, preview.x, preview.y, paint);
        delete this.sceneModel.paintToolDragPreview;
      }
      this.canvasController.requestUpdate();
      return;
    }

    // ── Branch C: direct xKey/yKey ───────────────────────────────────────────
    const keys = DIRECT_ROLE_MAP[hit.role];
    if (!keys) return;

    const source = keys.nested ? fillPaint[keys.nested] ?? {} : fillPaint;
    const previewBaseX = source[keys.xKey] ?? 0;
    const previewBaseY = source[keys.yKey] ?? 0;

    for await (const event of eventStream) {
      const pt = this.glyphPoint(event);
      if (pt.x === undefined) continue;
      this.sceneModel.paintToolDragPreview = {
        layerIdx: hit.layerIdx,
        role: hit.role,
        x: previewBaseX + (pt.x - initialPt.x),
        y: previewBaseY + (pt.y - initialPt.y),
      };
      this.canvasController.requestUpdate();
    }
    const preview = this.sceneModel.paintToolDragPreview;
    if (preview) {
      await this.commitHandleDrag(hit, preview.x, preview.y, paint);
      delete this.sceneModel.paintToolDragPreview;
    }
    this.canvasController.requestUpdate();
  }

  // ── Commit handle drag ───────────────────────────────────────────────────────

  async commitHandleDrag(hit, newX, newY, paint) {
    const layers = paint.layers.map((layer, i) => {
      if (i !== hit.layerIdx) return layer;

      const isWrapper = TRANSFORM_WRAPPER_TYPES.has(
        layer.type?.replace(/^PaintVar/, "Paint")
      );
      const fillPaint = isWrapper ? layer : layer.paint ?? layer;

      const pack = (nfp) =>
        isWrapper ? nfp : layer.paint ? { ...layer, paint: nfp } : nfp;

      // ── Branch A: angle ──────────────────────────────────────────────────
      const angleEntry = ANGLE_ROLE_MAP[hit.role];
      if (angleEntry) {
        const cx = fillPaint.centerX ?? 0,
          cy = fillPaint.centerY ?? 0;
        const angleRad = Math.atan2(newY - cy, newX - cx);
        const angleTurns = angleRad / (Math.PI * 2);
        const value =
          hit.role === "rot-handle"
            ? angleTurns
            : Math.max(-1, Math.min(1, angleTurns));
        return pack({ ...fillPaint, [angleEntry.angleKey]: value });
      }

      // ── Branch B: custom ─────────────────────────────────────────────────
      if (hit.role === "scale-x") {
        const ARM = 60;
        return pack({ ...fillPaint, scaleX: (newX - (fillPaint.centerX ?? 0)) / ARM });
      }
      if (hit.role === "scale-y") {
        const ARM = 60;
        return pack({ ...fillPaint, scaleY: (newY - (fillPaint.centerY ?? 0)) / ARM });
      }
      if (hit.role === "skew-x") {
        const cx = fillPaint.centerX ?? 0,
          cy = fillPaint.centerY ?? 0;
        const angle = Math.atan2(newY - cy, newX - cx) / Math.PI;
        return pack({ ...fillPaint, xSkewAngle: Math.max(-0.5, Math.min(0.5, angle)) });
      }

      if (hit.role === "xfm-scaleX" || hit.role === "xfm-scaleY") {
        const t = fillPaint.transform ?? { xx: 1, yx: 0, xy: 0, yy: 1, dx: 0, dy: 0 };

        // Each axis handle carries the child-space reference point (refX, refY)
        // at which it was placed. Reconstruct the matrix column from:
        //   newX = dx + xx*refX + xy*refY   (X col)
        //   newY = dy + yx*refX + yy*refY   (X col)
        // or the Y column equivalently.
        //
        // Solving for the column via least-squares (ref·ref denominator):
        //   col = (ref · (newPos - origin)) / |ref|²
        const refX = hit.refX ?? (hit.role === "xfm-scaleX" ? 200 : 0);
        const refY = hit.refY ?? (hit.role === "xfm-scaleY" ? 200 : 0);
        const relX = newX - t.dx;
        const relY = newY - t.dy;
        const denom = refX * refX + refY * refY || 1;

        if (hit.role === "xfm-scaleX") {
          // Solves the X column: [xx, yx]
          // newX - dx = xx*refX + xy*refY  →  dot with [refX,refY] / |ref|²
          // Because xy*refY part from the other column: we only move the X arm,
          // so set xx and yx holding xy/yy constant.
          const xx = (relX * refX + relY * refY) / denom;
          const yx = (relY * refX - relX * refY) / denom;
          return pack({ ...fillPaint, transform: { ...t, xx, yx } });
        } else {
          // Solves the Y column: [xy, yy]
          const xy = (relX * refX + relY * refY) / denom;
          const yy = (relY * refX - relX * refY) / denom;
          return pack({ ...fillPaint, transform: { ...t, xy, yy } });
        }
      }

      // ── Branch C: direct xKey/yKey ───────────────────────────────────────
      const keys = DIRECT_ROLE_MAP[hit.role];
      if (!keys) {
        console.warn("Unhandled handle role:", hit.role);
        return layer;
      }
      if (keys.nested) {
        const sub = fillPaint[keys.nested] ?? {};
        return pack({
          ...fillPaint,
          [keys.nested]: {
            ...sub,
            [keys.xKey]: Math.round(newX),
            [keys.yKey]: Math.round(newY),
          },
        });
      }
      return pack({
        ...fillPaint,
        [keys.xKey]: Math.round(newX),
        [keys.yKey]: Math.round(newY),
      });
    });

    await writeV1Paint(this.sceneController, { ...paint, layers });
    // glyphChanged fires here → _onGlyphChanged → bounds cache invalidated →
    // _prefetchAllChildBounds → handles redrawn with fresh bbox-derived positions.
  }

  // ── Palette cycling ──────────────────────────────────────────────────────────

  async _cyclePaletteIndex(layerIdx, delta) {
    const paint = getV1Paint(this.sceneController);
    if (!paint) return;

    const palette =
      (this.fontController?.customData ?? {})[
        "com.github.googlei18n.ufo2ft.colorPalettes"
      ]?.[0] ?? [];
    const maxIdx = Math.max(0, palette.length - 1);

    const layers = paint.layers.map((layer, i) => {
      if (i !== layerIdx) return layer;
      const fp = layer.paint ?? layer;
      const current = fp.paletteIndex ?? 0;
      const next = (((current + delta) % (maxIdx + 1)) + (maxIdx + 1)) % (maxIdx + 1);
      return layer.paint != null
        ? { ...layer, paint: { ...layer.paint, paletteIndex: next } }
        : { ...layer, paletteIndex: next };
    });

    await writeV1Paint(this.sceneController, { ...paint, layers });
    this.sceneController._dispatchEvent(new CustomEvent("glyphChanged"));
  }
}

// ─── Visualization layer ───────────────────────────────────────────────────────

registerVisualizationLayerDefinition({
  identifier: "fontra.painttool.handles",
  name: "Paint tool handles",
  selectionFunc: glyphSelector("editing"),
  zIndex: 510,
  screenParameters: { strokeWidth: 1.5, handleRadius: HANDLE_RADIUS },
  colors: {
    handleFill: "#00BFFF",
    handleStroke: "#000",
    lineColor: "#0008",
    solidBadge: "#FFD700",
    highlightRing: "#FF4500",
    transformBox: "#FF8C00", // orange  – PaintTransform axis arms
    rotateArc: "#9370DB", // purple  – PaintRotate arc
    scaleArm: "#32CD32", // green   – PaintScale arms
    skewArm: "#FF6347", // tomato  – PaintSkew arm
    translateCross: "#00CED1", // teal    – PaintTranslate crosshair
  },
  colorsDarkMode: {
    handleFill: "#00BFFF",
    handleStroke: "#FFF",
    lineColor: "#FFF6",
    solidBadge: "#FFD700",
    highlightRing: "#FF6347",
    transformBox: "#FF8C00",
    rotateArc: "#9370DB",
    scaleArm: "#32CD32",
    skewArm: "#FF6347",
    translateCross: "#00CED1",
  },
  draw: (context, positionedGlyph, parameters, model, _controller) => {
    const handles = model.paintToolHandles;
    if (!handles?.length) return;

    const r = parameters.handleRadius;
    const highlight = model.paintToolHighlight;
    const preview = model.paintToolDragPreview;

    // Apply live preview position override
    const effectiveHandles = handles.map((h) =>
      preview && h.layerIdx === preview.layerIdx && h.role === preview.role
        ? { ...h, x: preview.x, y: preview.y }
        : h
    );

    // Group handles by layer index for connector-line drawing
    const byLayer = {};
    for (const h of effectiveHandles) {
      (byLayer[h.layerIdx] ??= []).push(h);
    }

    // ── Dashed connector lines for gradient handles ────────────────────────
    context.save();
    context.setLineDash([4, 4]);
    context.strokeStyle = parameters.lineColor;
    context.lineWidth = parameters.strokeWidth;
    for (const group of Object.values(byLayer)) {
      const gradient = group.filter(
        (h) =>
          !h.role.startsWith("xfm-") &&
          h.role !== "solid" &&
          h.role !== "translate" &&
          h.role !== "rot-center" &&
          h.role !== "rot-handle" &&
          h.role !== "scale-center" &&
          h.role !== "scale-x" &&
          h.role !== "scale-y" &&
          h.role !== "skew-center" &&
          h.role !== "skew-x"
      );
      if (gradient.length >= 2) {
        context.beginPath();
        context.moveTo(gradient[0].x, gradient[0].y);
        for (let k = 1; k < gradient.length; k++) {
          context.lineTo(gradient[k].x, gradient[k].y);
        }
        context.stroke();
      }
    }
    context.restore();

    // ── Transform-type shape indicators ───────────────────────────────────
    context.save();
    context.lineWidth = parameters.strokeWidth;

    for (const group of Object.values(byLayer)) {
      // PaintTranslate – crosshair
      const tHandle = group.find((h) => h.role === "translate");
      if (tHandle) {
        const S = 10;
        context.setLineDash([]);
        context.strokeStyle = parameters.translateCross;
        context.beginPath();
        context.moveTo(tHandle.x - S, tHandle.y);
        context.lineTo(tHandle.x + S, tHandle.y);
        context.moveTo(tHandle.x, tHandle.y - S);
        context.lineTo(tHandle.x, tHandle.y + S);
        context.stroke();
      }

      // PaintRotate – dashed hint circle + radial arm
      const rotCenter = group.find((h) => h.role === "rot-center");
      const rotHandle = group.find((h) => h.role === "rot-handle");
      if (rotCenter && rotHandle) {
        context.setLineDash([4, 4]);
        context.strokeStyle = parameters.rotateArc;
        context.beginPath();
        context.arc(rotCenter.x, rotCenter.y, 80, 0, Math.PI * 2);
        context.stroke();
        context.setLineDash([]);
        context.beginPath();
        context.moveTo(rotCenter.x, rotCenter.y);
        context.lineTo(rotHandle.x, rotHandle.y);
        context.stroke();
      }

      // PaintScale – solid arms from center to each scale handle
      const scaleCenter = group.find((h) => h.role === "scale-center");
      const scaleX = group.find((h) => h.role === "scale-x");
      const scaleY = group.find((h) => h.role === "scale-y");
      if (scaleCenter && (scaleX || scaleY)) {
        context.setLineDash([]);
        context.strokeStyle = parameters.scaleArm;
        context.beginPath();
        if (scaleX) {
          context.moveTo(scaleCenter.x, scaleCenter.y);
          context.lineTo(scaleX.x, scaleX.y);
        }
        if (scaleY) {
          context.moveTo(scaleCenter.x, scaleCenter.y);
          context.lineTo(scaleY.x, scaleY.y);
        }
        context.stroke();
      }

      // PaintSkew – dashed arm to skew handle
      const skewCenter = group.find((h) => h.role === "skew-center");
      const skewX = group.find((h) => h.role === "skew-x");
      if (skewCenter && skewX) {
        context.setLineDash([2, 3]);
        context.strokeStyle = parameters.skewArm;
        context.beginPath();
        context.moveTo(skewCenter.x, skewCenter.y);
        context.lineTo(skewX.x, skewX.y);
        context.stroke();
      }

      // PaintTransform – origin + two axis arms + closed parallelogram corner
      const xfmOrigin = group.find((h) => h.role === "xfm-origin");
      const xfmScaleX = group.find((h) => h.role === "xfm-scaleX");
      const xfmScaleY = group.find((h) => h.role === "xfm-scaleY");
      if (xfmOrigin && xfmScaleX && xfmScaleY) {
        context.setLineDash([]);
        context.strokeStyle = parameters.transformBox;
        context.beginPath();
        // X arm
        context.moveTo(xfmOrigin.x, xfmOrigin.y);
        context.lineTo(xfmScaleX.x, xfmScaleX.y);
        // Y arm
        context.moveTo(xfmOrigin.x, xfmOrigin.y);
        context.lineTo(xfmScaleY.x, xfmScaleY.y);
        // Close the parallelogram
        context.moveTo(xfmScaleX.x, xfmScaleX.y);
        context.lineTo(
          xfmScaleX.x + (xfmScaleY.x - xfmOrigin.x),
          xfmScaleX.y + (xfmScaleY.y - xfmOrigin.y)
        );
        context.lineTo(xfmScaleY.x, xfmScaleY.y);
        context.stroke();
      }
    }
    context.restore();

    // ── Draw each handle dot / badge ───────────────────────────────────────
    for (const h of effectiveHandles) {
      const isHighlighted =
        highlight && h.layerIdx === highlight.layerIdx && h.role === highlight.role;

      context.save();

      if (isHighlighted) {
        context.beginPath();
        context.arc(h.x, h.y, r + 3, 0, Math.PI * 2);
        context.strokeStyle = parameters.highlightRing;
        context.lineWidth = 2;
        context.stroke();
      }

      if (h.role === "solid") {
        context.beginPath();
        context.moveTo(h.x, h.y - r);
        context.lineTo(h.x + r, h.y);
        context.lineTo(h.x, h.y + r);
        context.lineTo(h.x - r, h.y);
        context.closePath();
        context.fillStyle = parameters.solidBadge;
      } else {
        context.beginPath();
        context.arc(h.x, h.y, r, 0, Math.PI * 2);
        context.fillStyle = parameters.handleFill;
      }

      context.fill();
      context.strokeStyle = parameters.handleStroke;
      context.lineWidth = parameters.strokeWidth;
      context.stroke();
      context.restore();
    }
  },
});
