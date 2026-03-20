// edit-tools-paint.js
// On-screen color-stop / gradient-handle editor for COLRv1 paint layers.
// Mirrors the structure of edit-tools-shape.js (ShapeTool / BaseTool pattern).
//
// CHANGED: PaintToolColorStop + PaintToolGradientHandle merged into a single
// UnifiedPaintTool.  The two sub-tools differed in exactly two ways:
//   1. Cursor: "cell" (color-stop) vs "crosshair" (gradient-handle)
//   2. Solid-badge handling: color-stop cycled paletteIndex, gradient-handle
//      ignored solid hits entirely.
// Both behaviours are now handled in one class:
//   • Cursor is set dynamically based on what the pointer is hovering over.
//   • handleDrag dispatches on hit.role instead of branching at the class level.

import { BaseTool, shouldInitiateDrag } from "./edit-tools-base.js";
import {
  glyphSelector,
  registerVisualizationLayerDefinition,
} from "./visualization-layer-definitions.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const COLRV1_KEY = "colorv1";
const HANDLE_RADIUS = 8; // screen pixels
const HIT_RADIUS = 12; // screen pixels – larger for easier picking

// ─── Top-level tool wrapper ────────────────────────────────────────────────────

export class PaintTool {
  identifier = "paint-tool";
  // Only one sub-tool now; keep the array so the framework still works.
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

/**
 * Collect all draggable on-screen handles for a given paint graph.
 * Returns an array of { layerIdx, role, x, y }.
 */
function collectHandles(paint) {
  const handles = [];
  if (!paint?.layers) return handles;

  paint.layers.forEach((layer, i) => {
    const p = layer.paint ?? layer;
    if (!p?.type) return;

    const t = p.type.replace(/^PaintVar/, "Paint");

    if (t === "PaintLinearGradient") {
      handles.push({ layerIdx: i, role: "p0", x: p.x0 ?? 0, y: p.y0 ?? 0 });
      handles.push({ layerIdx: i, role: "p1", x: p.x1 ?? 0, y: p.y1 ?? 0 });
      handles.push({ layerIdx: i, role: "p2", x: p.x2 ?? 0, y: p.y2 ?? 0 });
    } else if (t === "PaintRadialGradient") {
      handles.push({ layerIdx: i, role: "center0", x: p.x0 ?? 0, y: p.y0 ?? 0 });
      handles.push({ layerIdx: i, role: "center1", x: p.x1 ?? 0, y: p.y1 ?? 0 });
    } else if (t === "PaintSweepGradient") {
      const cx = p.centerX ?? 0;
      const cy = p.centerY ?? 0;
      handles.push({ layerIdx: i, role: "sweepCenter", x: cx, y: cy });

      // Add angle handles (display radius; does not affect gradient)
      const SWEEP_HANDLE_RADIUS = 100;
      const startRad = (p.startAngle ?? 0) * 180 * (Math.PI / 180);
      const endRad = (p.endAngle ?? 0.5) * 180 * (Math.PI / 180);

      handles.push({
        layerIdx: i,
        role: "sweepStart",
        x: cx + SWEEP_HANDLE_RADIUS * Math.cos(startRad),
        y: cy + SWEEP_HANDLE_RADIUS * Math.sin(startRad),
      });
      handles.push({
        layerIdx: i,
        role: "sweepEnd",
        x: cx + SWEEP_HANDLE_RADIUS * Math.cos(endRad),
        y: cy + SWEEP_HANDLE_RADIUS * Math.sin(endRad),
      });
    } else if (t === "PaintSolid") {
      handles.push({ layerIdx: i, role: "solid", x: 0, y: 0 });
    }
  });

  return handles;
}

/** Map a handle role to its paint parameter keys. */
const ROLE_KEY_MAP = {
  p0: { xKey: "x0", yKey: "y0" },
  p1: { xKey: "x1", yKey: "y1" },
  p2: { xKey: "x2", yKey: "y2" },
  center0: { xKey: "x0", yKey: "y0" },
  center1: { xKey: "x1", yKey: "y1" },
  sweepCenter: { xKey: "centerX", yKey: "centerY" },
  sweepStart: { angleKey: "startAngle" },
  sweepEnd: { angleKey: "endAngle" },
  r0: { xKey: "x0", yKey: "y0" }, // r0 handle at (x0 + r0, y0)
  r1: { xKey: "x1", yKey: "y1" }, // r1 handle at (x1 + r1, y1)
};
// ─── Unified paint tool ────────────────────────────────────────────────────────

export class UnifiedPaintTool extends BaseTool {
  iconPath = "/images/paintbrush.svg";
  identifier = "paint-tool-unified";

  // ── Cursor ──────────────────────────────────────────────────────────────────
  // "cell"      when hovering a solid-badge  (former ColorStop behaviour)
  // "crosshair" when hovering a gradient handle (former GradientHandle behaviour)
  // "default"   when not editing or no hit
  setCursor(hit = null) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      this.canvasController.canvas.style.cursor = "default";
      return;
    }
    if (hit?.role === "solid") {
      this.canvasController.canvas.style.cursor = "cell";
    } else if (hit) {
      this.canvasController.canvas.style.cursor = "crosshair";
    } else {
      // No handle under pointer – use a neutral editing cursor.
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
  // Dispatches on hit.role:
  //   "solid"  → cycle paletteIndex (former ColorStop exclusive behaviour)
  //   anything else → drag gradient handle (both tools could do this)

  async handleDrag(eventStream, initialEvent) {
    if (!this.sceneModel.selectedGlyph?.isEditing) {
      await this.editor.tools["pointer-tool"].handleDrag(eventStream, initialEvent);
      return;
    }

    const hit = this._hitTest(initialEvent);
    if (!hit) return;

    if (hit.role === "solid") {
      // Click on solid badge → cycle paletteIndex (shift = backwards)
      await this._cyclePaletteIndex(hit.layerIdx, initialEvent.shiftKey ? -1 : 1);
      // Drain remaining events so the framework doesn't hang.
      for await (const _ev of eventStream) {
        break;
      }
      return;
    }

    // Gradient / sweep handle drag
    await this.dragHandle(hit, eventStream, initialEvent);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  deactivate() {
    super.deactivate();
    delete this.sceneModel.paintToolHandles;
    delete this.sceneModel.paintToolHighlight;
    this.canvasController.requestUpdate();
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  _getHandles() {
    const paint = getV1Paint(this.sceneController);
    return paint ? collectHandles(paint) : [];
  }

  /** Convert a pointer event to glyph-space coordinates. */
  _glyphPoint(event) {
    return this.sceneController.selectedGlyphPoint(event);
  }

  /** Hit-test all handles; return the nearest within HIT_RADIUS or null. */
  _hitTest(event) {
    const pt = this._glyphPoint(event);
    if (pt.x === undefined) return null;

    const handles = this._getHandles();
    const scale = this.canvasController.magnification ?? 1;
    const threshold = HIT_RADIUS / scale;

    let best = null,
      bestDist = Infinity;
    for (const h of handles) {
      const dx = h.x - pt.x,
        dy = h.y - pt.y;
      const dist = Math.hypot(dx, dy);
      if (dist < threshold && dist < bestDist) {
        best = h;
        bestDist = dist;
      }
    }
    return best;
  }
  glyphPoint(event) {
    return this.sceneController.selectedGlyphPoint(event);
  }
  _updateHighlight(event) {
    const hit = this._hitTest(event);
    this.sceneModel.paintToolHighlight = hit;
    this.sceneModel.paintToolHandles = this._getHandles();
    this.setCursor(hit); // dynamic cursor based on what's under the pointer
    this.canvasController.requestUpdate();
  }

  async dragHandle(hit, eventStream, initialEvent) {
    const initialPt = this.glyphPoint(initialEvent);
    if (!(await shouldInitiateDrag(eventStream, initialEvent))) return;

    const paint = getV1Paint(this.sceneController);
    if (!paint) return;

    const layer = paint.layers[hit.layerIdx];
    const fillPaint = layer.paint ?? layer;
    const keys = ROLE_KEY_MAP[hit.role]; // Note: your underscore naming
    if (!keys) return;

    // For angle handles: preview relative to ORIGINAL handle position
    let previewBaseX = hit.x;
    let previewBaseY = hit.y;

    if (keys.xKey && keys.yKey) {
      // Direct position handles (p0/p1/etc)
      previewBaseX = fillPaint[keys.xKey] ?? 0;
      previewBaseY = fillPaint[keys.yKey] ?? 0;
    }

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

    // Commit final position
    const preview = this.sceneModel.paintToolDragPreview;
    if (preview) {
      await this.commitHandleDrag(hit, preview.x, preview.y, paint);
      delete this.sceneModel.paintToolDragPreview;
    }
    this.canvasController.requestUpdate();
  }
  async commitHandleDrag(hit, newX, newY, paint) {
    const keys = ROLE_KEY_MAP[hit.role];
    if (!keys) return console.warn("No keys for role:", hit.role);

    const layers = paint.layers.map((layer, i) => {
      if (i !== hit.layerIdx) return layer;
      const fillPaint = layer.paint ?? layer;

      if (keys.angleKey) {
        // COMPUTE ANGLE FROM VECTOR TO CENTER
        const cx = fillPaint.centerX ?? 0;
        const cy = fillPaint.centerY ?? 0;
        const angleRad = Math.atan2(newY - cy, newX - cx);
        // COLRv1 format: (radians → degrees → /180)
        const angleColr = (angleRad * 180) / Math.PI / 180;

        const newFillPaint = { ...fillPaint, [keys.angleKey]: angleColr };
        return layer.paint ? { ...layer, paint: newFillPaint } : newFillPaint;
      } else if (keys.xKey && keys.yKey) {
        // EXISTING: Direct position/radius handles
        const newFillPaint = {
          ...fillPaint,
          [keys.xKey]: Math.round(newX),
          [keys.yKey]: Math.round(newY),
        };
        return layer.paint ? { ...layer, paint: newFillPaint } : newFillPaint;
      }

      console.warn("Unhandled handle type:", hit.role);
      return layer;
    });

    await writeV1Paint(this.sceneController, { ...paint, layers });
  }

  async _cyclePaletteIndex(layerIdx, delta) {
    const paint = getV1Paint(this.sceneController);
    if (!paint) return;

    const fontCustomData = this.fontController?.customData ?? {};
    const palette =
      fontCustomData["com.github.googlei18n.ufo2ft.colorPalettes"]?.[0] ?? [];
    const maxIdx = Math.max(0, palette.length - 1);

    const layers = paint.layers.map((layer, i) => {
      if (i !== layerIdx) return layer;
      const fillPaint = layer.paint ?? layer;
      const current = fillPaint.paletteIndex ?? 0;
      const next = (((current + delta) % (maxIdx + 1)) + (maxIdx + 1)) % (maxIdx + 1);
      if (layer.paint != null) {
        return { ...layer, paint: { ...layer.paint, paletteIndex: next } };
      }
      return { ...layer, paletteIndex: next };
    });

    await writeV1Paint(this.sceneController, { ...paint, layers });
    this.sceneController._dispatchEvent(new CustomEvent("glyphChanged"));
  }
}

// ─── Visualization layer ───────────────────────────────────────────────────────
// Unchanged from the original – draws handles, dashed connector lines, and
// diamond badges for PaintSolid layers.

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
  },
  colorsDarkMode: {
    handleFill: "#00BFFF",
    handleStroke: "#FFF",
    lineColor: "#FFF6",
    solidBadge: "#FFD700",
    highlightRing: "#FF6347",
  },
  draw: (context, positionedGlyph, parameters, model, controller) => {
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

    // Draw connecting lines between gradient handle pairs
    const byLayer = {};
    for (const h of effectiveHandles) {
      (byLayer[h.layerIdx] ??= []).push(h);
    }
    context.save();
    context.setLineDash([4, 4]);
    context.strokeStyle = parameters.lineColor;
    context.lineWidth = parameters.strokeWidth;
    for (const group of Object.values(byLayer)) {
      const gradient = group.filter((h) => h.role !== "solid");
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

    // Draw each handle
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
        // Diamond badge for PaintSolid layers
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
