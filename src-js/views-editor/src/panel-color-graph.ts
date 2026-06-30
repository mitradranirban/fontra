/**
 * panel-color-graph.ts
 * Visual Color Graph Panel for ColorPak v0.7.0
 *
 * Renders COLRv1 paint trees as interactive visual graphs with live color previews,
 * instead of the text-form-based approach used in panel-color-layers.js.
 */

import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { getLayerPaintGraph, getPaintGraph } from "./colrv1-canvas-renderer.js";
import { PAINT_PARAM_SCHEMA, normalizePaintType } from "./panel-color-layers.js";
import Panel from "./panel.js";
import { setActivePaletteIndex } from "./visualization-layers.js";
const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";

interface PaintNodeOptions {
  label?: string;
  onSelectPaint?: (paint: any, layerIdx: number, nodeId: number) => void;
  selectedPaintId?: { current: number | null };
  nodeId?: number;
  layerIdx?: number;
}

interface FieldDescriptor {
  key: string;
  type?: string;
  paired?: boolean;
  pairWith?: string;
  sourceKey?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  itemSchema?: FieldDescriptor[];
}
// ---------------------------------------------------------------------------
// Paint type → display color category
// ---------------------------------------------------------------------------
const PAINT_CATEGORY_COLORS: Record<string, string> = {
  PaintSolid: "#4f98a3",
  PaintLinearGradient: "#6daa45",
  PaintRadialGradient: "#a86fdf",
  PaintSweepGradient: "#fdab43",
  PaintGlyph: "#5591c7",
  PaintColrGlyph: "#5591c7",
  PaintVarGlyph: "#5591c7",
  PaintColrLayers: "#dd6974",
  PaintTranslate: "#e8af34",
  PaintRotate: "#e8af34",
  PaintSkew: "#e8af34",
  PaintTransform: "#e8af34",
  PaintScale: "#e8af34",
  PaintComposite: "#bb653b",
};

// ---------------------------------------------------------------------------
// Render a CSS gradient preview for gradient paints
// ---------------------------------------------------------------------------
function buildGradientPreview(paint: any, palette: string[]) {
  const stops = paint?.colorLine?.colorStops ?? [];
  if (!stops.length) return "transparent";
  const cssStops = stops.map((s: any) => {
    const hex = palette[s.paletteIndex] ?? "#888";
    const alpha = s.alpha ?? 1.0;
    const pct = Math.round((s.stopOffset ?? 0) * 100);
    return `${hexWithAlpha(hex, alpha)} ${pct}%`;
  });
  const type = normalizePaintType(paint?.type ?? "");
  if (type === "PaintLinearGradient") {
    return `linear-gradient(to right, ${cssStops.join(", ")})`;
  }
  if (type === "PaintRadialGradient") {
    return `radial-gradient(circle, ${cssStops.join(", ")})`;
  }
  if (type === "PaintSweepGradient") {
    return `conic-gradient(${cssStops.join(", ")})`;
  }
  return `linear-gradient(to right, ${cssStops.join(", ")})`;
}

function hexWithAlpha(hex: string, alpha: number): string {
  if (!hex || !hex.startsWith("#")) return `rgba(128,128,128,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ---------------------------------------------------------------------------
// Build a paint swatch element for a given paint + palette
// ---------------------------------------------------------------------------
function makePaintSwatch(paint: any, palette: string[]): HTMLElement {
  const type = normalizePaintType(paint?.type ?? "");
  const size = "28px";
  const style = `
    width:${size}; height:${size}; border-radius:50%; display:inline-block;
    flex-shrink:0; border:1.5px solid rgba(255,255,255,0.18);
    box-shadow:0 1px 4px rgba(0,0,0,0.35);
    vertical-align:middle; overflow:hidden;
  `;
  if (type === "PaintSolid") {
    const hex = palette[paint?.paletteIndex ?? 0] ?? "#888";
    const alpha = paint?.alpha ?? 1.0;
    return html.span({ style: style + `background:${hexWithAlpha(hex, alpha)};` });
  }
  if (
    ["PaintLinearGradient", "PaintRadialGradient", "PaintSweepGradient"].includes(type)
  ) {
    const grad = buildGradientPreview(paint, palette);
    return html.span({ style: style + `background:${grad};` });
  }
  // Structural / composite / glyph nodes — show category icon-color indicator
  const catColor = PAINT_CATEGORY_COLORS[type] ?? "#888";
  return html.span({
    style: style + `background:${catColor}22; border-color:${catColor};`,
    title: type,
  });
}

// ---------------------------------------------------------------------------
// Build a color-stop row list for gradient paints
// ---------------------------------------------------------------------------
function makeColorStopsPreview(paint: any, palette: string[]): HTMLElement {
  const stops = paint?.colorLine?.colorStops ?? [];
  if (!stops.length)
    return html.span({ style: "font-size:0.75em;opacity:0.5;" }, "no stops");
  const row = html.div({
    style: "display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;",
  });
  for (const s of stops) {
    const hex = palette[s.paletteIndex ?? 0] ?? "#888";
    const alpha = s.alpha ?? 1.0;
    const pct = Math.round((s.stopOffset ?? 0) * 100);
    const swatch = html.div({
      style: `display:inline-flex; align-items:center; gap:3px;
              font-size:0.72em; background:rgba(255,255,255,0.06);
              border-radius:4px; padding:1px 5px; color:var(--color-text-muted);`,
      title: `Index ${s.paletteIndex}, alpha=${alpha}`,
    });
    swatch.appendChild(
      html.span({
        style: `width:12px;height:12px;border-radius:50%;display:inline-block;
              background:${hexWithAlpha(
                hex,
                alpha
              )};border:1px solid rgba(255,255,255,0.2);`,
      })
    );
    swatch.appendChild(document.createTextNode(`${pct}%`));
    row.appendChild(swatch);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Render a single paint node as a visual card in the graph
// ---------------------------------------------------------------------------
function makePaintNode(
  paint: any,
  depth: number,
  palette: string[],
  opts: PaintNodeOptions = {}
): HTMLElement {
  const { label = "", onSelectPaint, selectedPaintId, nodeId, layerIdx } = opts;
  const type = normalizePaintType(paint?.type ?? translate("color-graph.unknown"));
  const catColor = PAINT_CATEGORY_COLORS[type] ?? "#888";
  const isSelected = nodeId !== undefined && nodeId === selectedPaintId?.current;

  const node = html.div({
    style: `
      margin-left:${depth * 18}px;
      border-left: 3px solid ${catColor};
      background: var(--color-surface, #1c1b19);
      border-radius: 0 6px 6px 0;
      margin-bottom: 4px;
      padding: 6px 10px;
      cursor: pointer;
    `,
    onclick: () => onSelectPaint && onSelectPaint(paint, layerIdx ?? 0, nodeId ?? 0),
  });

  // Header row
  const header = html.div({ style: "display:flex; align-items:center; gap:8px;" });
  header.appendChild(makePaintSwatch(paint, palette));

  const typeLabel = html.span(
    {
      style: `font-size:0.8em; font-weight:600; color:${catColor};
            flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;`,
    },
    label ? `${label} · ${type}` : type
  );
  header.appendChild(typeLabel);

  // Glyph reference badge
  const glyphName = paint?.glyph ?? paint?.paint?.glyph;
  if (glyphName) {
    header.appendChild(
      html.span(
        {
          style: `font-size:0.72em; background:rgba(255,255,255,0.1); border-radius:3px;
              padding:1px 5px; color:var(--color-text-muted); max-width:80px;
              overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`,
          title: glyphName,
        },
        glyphName
      )
    );
  }

  node.appendChild(header);

  // Gradient bar + color stops
  if (
    ["PaintLinearGradient", "PaintRadialGradient", "PaintSweepGradient"].includes(type)
  ) {
    const gradBar = html.div({
      style: `margin-top:5px; height:8px; border-radius:4px;
              background:${buildGradientPreview(paint, palette)};
              border:1px solid rgba(255,255,255,0.08);`,
    });
    node.appendChild(gradBar);
    node.appendChild(makeColorStopsPreview(paint, palette));
  }

  // Palette index + alpha for solid paints
  if (type === "PaintSolid") {
    const alpha = paint?.alpha ?? 1.0;
    const idx = paint?.paletteIndex ?? 0;
    node.appendChild(
      html.div(
        {
          style: "font-size:0.72em; color:var(--color-text-muted); margin-top:3px;",
        },
        `${translate("color-graph.palette-index")}: ${idx}  ${translate(
          "color-graph.alpha"
        )}: ${alpha.toFixed(2)}`
      )
    );
  }

  // Transform params summary
  if (
    [
      "PaintTranslate",
      "PaintRotate",
      "PaintSkew",
      "PaintScale",
      "PaintScaleUniform",
    ].includes(type)
  ) {
    const params = [];
    if (paint?.dx !== undefined) params.push(`dx=${paint.dx} dy=${paint.dy}`);
    if (paint?.angle !== undefined) params.push(`angle=${paint.angle}`);
    if (paint?.xSkewAngle !== undefined)
      params.push(`skewX=${paint.xSkewAngle} skewY=${paint.ySkewAngle}`);
    if (paint?.scaleX !== undefined)
      params.push(`scaleX=${paint.scaleX} scaleY=${paint.scaleY}`);
    if (paint?.scale !== undefined) params.push(`scale=${paint.scale}`);
    if (params.length) {
      node.appendChild(
        html.div(
          {
            style: "font-size:0.72em; color:var(--color-text-muted); margin-top:3px;",
          },
          params.join(" · ")
        )
      );
    }
  }

  // PaintTransform matrix summary
  if (type === "PaintTransform" && paint?.transform) {
    const t = paint.transform;
    node.appendChild(
      html.div(
        {
          style:
            "font-size:0.72em; color:var(--color-text-muted); margin-top:3px; font-family:monospace;",
        },
        `[${t.xx ?? 1}, ${t.yx ?? 0}, ${t.xy ?? 0}, ${t.yy ?? 1}] dx=${t.dx ?? 0} dy=${
          t.dy ?? 0
        }`
      )
    );
  }

  // Composite mode badge
  if (type === "PaintComposite" && paint?.compositeMode) {
    node.appendChild(
      html.div(
        {
          style: `display:inline-block; font-size:0.72em; background:rgba(187,101,59,0.25);
              border-radius:3px; padding:1px 6px; margin-top:4px; color:#bb653b;`,
        },
        `${translate("color-graph.composite-mode")}: ${paint.compositeMode}`
      )
    );
  }

  return node;
}

// ---------------------------------------------------------------------------
// Recursively walk a paint tree and produce node elements
// ---------------------------------------------------------------------------
function renderPaintTree(
  paint: any,
  depth: number,
  palette: string[],
  container: HTMLElement,
  opts: PaintNodeOptions,
  counter: { n: number } = { n: 0 }
): void {
  if (!paint) return;
  const nodeId = counter.n++;
  const layerIdx = opts.layerIdx ?? 0;
  const type = normalizePaintType(paint?.type ?? "");
  const node = makePaintNode(paint, depth, palette, { ...opts, nodeId, layerIdx });
  container.appendChild(node);

  // PaintColrLayers / layer arrays
  if (paint.layers?.length) {
    for (let i = 0; i < paint.layers.length; i++) {
      const layer = paint.layers[i];
      // Each layer can be a PaintGlyph-like struct (has .glyph + .paint) or a raw paint
      const isGlyphLayer =
        layer.type === "PaintGlyph" || layer.type === "PaintVarGlyph";
      const childPaint = isGlyphLayer ? layer : (layer.paint ?? layer);
      const glyph = layer.glyph ?? layer.paint?.glyph ?? "";
      renderPaintTree(
        isGlyphLayer ? layer : childPaint,
        depth + 1,
        palette,
        container,
        {
          ...opts,
          layerIdx: depth === 0 ? i : layerIdx,
          label: glyph ? `[${i}] ${glyph}` : `[${i}]`,
        },
        counter
      );
    }
  } else if (paint.paint) {
    // Single nested paint (PaintGlyph, PaintTranslate, PaintRotate, etc.)
    renderPaintTree(
      paint.paint,
      depth + 1,
      palette,
      container,
      { ...opts, label: "fill", layerIdx: layerIdx },
      counter
    );
  }

  // Composite children
  if (type === "PaintComposite") {
    if (paint.sourcePaint) {
      renderPaintTree(
        paint.sourcePaint,
        depth + 1,
        palette,
        container,
        { ...opts, label: "source", layerIdx: layerIdx },
        counter
      );
    }
    if (paint.backdropPaint) {
      renderPaintTree(
        paint.backdropPaint,
        depth + 1,
        palette,
        container,
        { ...opts, label: "backdrop", layerIdx: layerIdx },
        counter
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Palette color tile strip (top of panel)
// ---------------------------------------------------------------------------
function makePaletteStrip(palette: string[]): HTMLElement {
  const strip = html.div({
    style: `display:flex; flex-wrap:wrap; gap:4px; padding:6px 10px;
            background:var(--color-surface-offset, #1d1c1a);
            border-bottom:1px solid var(--color-border, #393836);`,
  });
  const label = html.span(
    {
      style:
        "font-size:0.7em; color:var(--color-text-muted); align-self:center; margin-right:4px;",
    },
    translate("color-graph.palette") + ":"
  );
  strip.appendChild(label);
  for (let i = 0; i < palette.length; i++) {
    const hex = palette[i] ?? "#888";
    strip.appendChild(
      html.div({
        style: `width:18px; height:18px; border-radius:3px; background:${hex};
              border:1px solid rgba(255,255,255,0.15); flex-shrink:0;`,
        title: `[${i}] ${hex}`,
      })
    );
  }
  return strip;
}

// ---------------------------------------------------------------------------
// Legend bar
// ---------------------------------------------------------------------------
function makeLegend(): HTMLElement {
  const entries = [
    ["PaintSolid", translate("color-graph.solid")],
    ["PaintLinearGradient", translate("color-graph.linear-gradient")],
    ["PaintRadialGradient", translate("color-graph.radial-gradient")],
    ["PaintSweepGradient", translate("color-graph.sweep-gradient")],
    ["PaintGlyph", translate("color-graph.glyph")],
    ["PaintColrLayers", translate("color-graph.layers")],
    ["PaintTranslate", translate("color-graph.transform")],
    ["PaintComposite", translate("color-graph.composite")],
  ];
  const legend = html.div({
    style: `display:flex; flex-wrap:wrap; gap:6px; padding:5px 10px;
            font-size:0.7em; color:var(--color-text-muted);
            border-bottom:1px solid var(--color-border, #393836);
            background:var(--color-surface, #1c1b19);`,
  });
  for (const [key, label] of entries) {
    const color = PAINT_CATEGORY_COLORS[key] ?? "#888";
    const item = html.div({ style: "display:flex; align-items:center; gap:3px;" });
    item.appendChild(
      html.span({
        style: `width:9px; height:9px; border-radius:50%; background:${color}; display:inline-block; flex-shrink:0;`,
      })
    );
    item.appendChild(document.createTextNode(label));
    legend.appendChild(item);
  }
  return legend;
}

// ---------------------------------------------------------------------------
// Empty / no-data placeholder
// ---------------------------------------------------------------------------
function makeEmptyState(message: string | Node): HTMLElement {
  const msgNode =
    message instanceof Node ? message : document.createTextNode(String(message ?? ""));

  return html.div(
    {
      style:
        "display:flex; flex-direction:column; align-items:center; justify-content:center; padding:48px 16px; color:var(--color-text-muted); font-size:0.85em; gap:10px; text-align:center; flex:1",
    },
    [html.div({ style: "font-size:2.5em; opacity:0.25; line-height:1" }, "🎨"), msgNode]
  );
}

function buildDetailPane(
  pane: HTMLElement,
  paint: any,
  layerIdx: number,
  palette: string[],
  graphPanel: ColorGraphPanel
): void {
  pane.innerHTML = "";
  const type = normalizePaintType(paint?.type ?? "");
  const paintParamSchema = PAINT_PARAM_SCHEMA as Record<string, FieldDescriptor[]>;
  const schema = paintParamSchema[type] ?? [];
  // Header
  pane.appendChild(
    html.div(
      {
        style: `font-size:0.78em; font-weight:600; padding:8px 2px 4px;
            color:var(--color-text); border-bottom:1px solid var(--color-border);`,
      },
      `Edit · ${type}`
    )
  );

  if (!schema || !schema.length) {
    pane.appendChild(
      html.div(
        {
          style: "font-size:0.75em; color:var(--color-text-muted); padding:8px 0;",
        },
        "No editable parameters for this node type."
      )
    );
    return;
  }

  // For each field in PAINT_PARAM_SCHEMA[type]
  for (const fd of schema) {
    if (fd.paired) continue; // skip — rendered with its partner

    const sourceObj = fd.sourceKey ? paint?.[fd.sourceKey] : paint;

    if (fd.type === "array") {
      // Color stops — render each stop with editable fields
      const stops = sourceObj?.[fd.key] ?? [];
      const stopHeader = html.div(
        {
          style: "font-size:0.75em; color:var(--color-text-muted); padding:6px 0 2px;",
        },
        `${fd.key} (${stops.length})`
      );
      pane.appendChild(stopHeader);

      stops.forEach((stop: any, _si: number) => {
        const row = html.div({
          style: "display:flex; gap:6px; align-items:center; margin-bottom:4px;",
        });
        for (const sf of fd.itemSchema ?? []) {
          const input = makeNumberInput(
            stop[sf.key] ?? 0,
            sf.min,
            sf.max,
            sf.integer ?? false,
            async (val: number) => {
              stop[sf.key] = val;
              const layersPanel = graphPanel.editorController.panels?.["color-layers"];
              if (layersPanel) await layersPanel._writeV1Paint(graphPanel.currentPaint);
              graphPanel.update();
            }
          );
          row.appendChild(
            html.label(
              {
                style: "font-size:0.72em; color:var(--color-text-muted);",
              },
              sf.key
            )
          );
          row.appendChild(input);
        }
        pane.appendChild(row);
      });
      continue;
    }

    const partner = fd.pairWith ? schema.find((s) => s.key === fd.pairWith) : null;
    const row = html.div({
      style: "display:flex; gap:8px; align-items:center; margin-bottom:4px;",
    });
    row.appendChild(
      html.label(
        {
          style: "font-size:0.72em; color:var(--color-text-muted); min-width:60px;",
        },
        fd.key
      )
    );

    const rawVal =
      sourceObj?.[fd.key] ??
      (fd.key === "alpha" || ["scaleX", "scaleY", "scale", "xx", "yy"].includes(fd.key)
        ? 1.0
        : 0);
    row.appendChild(
      makeNumberInput(rawVal, fd.min, fd.max, fd.integer ?? false, async (val) => {
        sourceObj[fd.key] = val; // Mutate the node directly
        const layersPanel = graphPanel.editorController.panels?.["color-layers"];
        if (layersPanel) await layersPanel._writeV1Paint(graphPanel.currentPaint);
        graphPanel.update();
      })
    );

    if (partner) {
      const rawB = sourceObj?.[partner.key] ?? 0;
      row.appendChild(
        html.label(
          {
            style: "font-size:0.72em; color:var(--color-text-muted);",
          },
          partner.key
        )
      );
      row.appendChild(
        makeNumberInput(
          rawB,
          partner.min,
          partner.max,
          partner.integer ?? false,
          async (val) => {
            sourceObj[partner.key] = val; // Mutate the node directly
            const layersPanel = graphPanel.editorController.panels?.["color-layers"];
            if (layersPanel) await layersPanel._writeV1Paint(graphPanel.currentPaint);
            graphPanel.update();
          }
        )
      );
    }
    pane.appendChild(row);
  }
}

// Small helper — native number input wired to async callback
function makeNumberInput(
  value: number,
  min: number | undefined,
  max: number | undefined,
  integer: boolean,
  onChange: (val: number) => void
): HTMLInputElement {
  const input = html.input({
    type: "number",
    value: String(value),
    min: min !== undefined ? String(min) : undefined,
    max: max !== undefined ? String(max) : undefined,
    step: integer ? "1" : "0.01",
    style: `width:70px; background:var(--color-surface-2);
            border:1px solid var(--color-border); border-radius:4px;
            color:var(--color-text); padding:2px 5px; font-size:0.78em;`,
  });
  input.addEventListener("change", () => {
    const val = integer ? parseInt(input.value) : parseFloat(input.value);
    if (!isNaN(val)) onChange(val);
  });
  return input;
}

// ---------------------------------------------------------------------------
// The Panel class
// ---------------------------------------------------------------------------
export default class ColorGraphPanel extends Panel {
  static identifier = "color-graph";
  static iconPath = "/images/color-graph.svg";
  identifier = ColorGraphPanel.identifier;
  iconPath = ColorGraphPanel.iconPath;

  sceneController: any;
  _selectedPaintId: { current: number | null };
  _layersPanel: any;
  currentGlyphName?: string;
  currentPaint?: any;
  activePaletteIndex: number;
  _scrollArea!: HTMLElement;
  _detailPane!: HTMLElement;

  constructor(editorController: any) {
    super(editorController);
    this.sceneController = editorController.sceneController;
    this._selectedPaintId = { current: null };
    this._layersPanel = editorController.panels?.["color-layers"] ?? null;
    this.activePaletteIndex = 0;

    this.sceneController.sceneSettingsController.addKeyListener(
      "selectedGlyphName",
      () => this.update()
    );
    this.sceneController.sceneSettingsController.addKeyListener("editLayerName", () =>
      this.update()
    );
    this.sceneController.addCurrentGlyphChangeListener(() => this.update());
  }

  getContentElement() {
    this._scrollArea = html.div({
      class: "panel-section panel-section--flex panel-section--scrollable",
    });
    this._detailPane = html.div({
      id: "cgp-detail-pane",
      style:
        "flex-shrink:0; max-height:45%; overflow-y:auto; border-top:1px solid var(--color-border); background:var(--color-surface-offset); padding:0 8px 16px; display:none;",
    });
    return html.div({ class: "panel" }, [this._scrollArea, this._detailPane]);
  }

  async toggle(on: boolean, _focus: boolean): Promise<void> {
    if (on) await this.update();
  }

  // -------------------------------------------------------------------------
  // Main render method
  // -------------------------------------------------------------------------
  async update(): Promise<void> {
    const scrollArea = this._scrollArea;
    const detailPane = this._detailPane;
    if (!scrollArea) return;
    scrollArea.innerHTML = "";

    this.activePaletteIndex ??= 0;
    setActivePaletteIndex(this.activePaletteIndex);

    const glyphName = this.sceneController?.sceneSettings?.selectedGlyphName;
    if (!glyphName) {
      scrollArea.appendChild(
        makeEmptyState(translate("color-graph.no-glyph-selected"))
      );
      return;
    }

    let paint = null;
    try {
      const varGlyphController =
        await this.sceneController.sceneModel.getSelectedVariableGlyphController();
      const varGlyph = varGlyphController?.glyph;
      const pg = this.sceneController.sceneModel?.getSelectedPositionedGlyph?.();
      const instanceGlyph = pg?.glyph?.instance;
      const colorV1Data =
        getPaintGraph(instanceGlyph?.customData) ??
        getLayerPaintGraph(pg, this.sceneController.sceneSettings) ??
        getPaintGraph(varGlyph?.customData);
      if (colorV1Data) {
        paint = colorV1Data;
        if (paint.type !== "PaintColrLayers") {
          paint = { type: "PaintColrLayers", layers: [paint] };
        }
      }
    } catch (_) {}
    this.currentGlyphName = glyphName;
    this.currentPaint = paint;

    // Header
    const headerBar = html.div({
      style: `display:flex; align-items:center; padding:6px 10px; gap:8px; border-bottom:1px solid var(--color-border, #393836); background:var(--color-surface, #1c1b19); flex-shrink:0;`,
    });
    headerBar.appendChild(
      html.span(
        {
          style:
            "font-size:0.78em; font-weight:600; color:var(--color-text, #cdccca); flex:1;",
        },
        `${translate("color-graph.paint-graph")} — ${glyphName}`
      )
    );

    headerBar.appendChild(
      html.button(
        {
          style: `font-size:0.78em; padding:2px 8px; border-radius:4px; cursor:pointer; background:var(--color-surface-offset); border:1px solid var(--color-border); color:var(--color-text-muted);`,
          onclick: () => this.update(),
          title: translate("color-graph.refresh"),
        },
        translate("color-graph.refresh")
      )
    );
    let palettes = [];
    try {
      const cd = this.fontController?.customData ?? {};
      palettes = cd[PALETTES_KEY] ?? [];
    } catch (_) {}

    if (!palettes.length) {
      scrollArea.appendChild(makeEmptyState(translate("color-graph.no-palette")));
      return;
    }

    const paletteIndex = Math.max(
      0,
      Math.min(this.activePaletteIndex, palettes.length - 1)
    );
    setActivePaletteIndex(paletteIndex);
    const palette = (palettes[paletteIndex] ?? []).map((entry: any) => {
      if (Array.isArray(entry)) {
        const [r, g, b] = entry;
        return `#${Math.round(r * 255)
          .toString(16)
          .padStart(2, "0")}${Math.round(g * 255)
          .toString(16)
          .padStart(2, "0")}${Math.round(b * 255)
          .toString(16)
          .padStart(2, "0")}`;
      }
      return entry;
    });
    if (palettes.length > 1) {
      const paletteSelect = html.select({
        style: "font-size:0.78em; padding:2px 6px; border-radius:4px;",
      });

      palettes.forEach((_: any, i: number) => {
        paletteSelect.appendChild(
          html.option({ value: String(i) }, `Palette ${i + 1}`)
        );
      });

      paletteSelect.value = String(paletteIndex);
      paletteSelect.addEventListener("change", async () => {
        this.activePaletteIndex = Number(paletteSelect.value) || 0;
        setActivePaletteIndex(this.activePaletteIndex);
        this.sceneController.canvasController.requestUpdate();
        await this.update();
      });

      headerBar.appendChild(paletteSelect);
    }

    scrollArea.appendChild(headerBar);
    scrollArea.appendChild(makePaletteStrip(palette));
    scrollArea.appendChild(makeLegend());

    detailPane.style.display = "none";

    if (!paint) {
      scrollArea.appendChild(
        makeEmptyState(
          translate("color-graph.no-paint-data") +
            " — " +
            glyphName +
            ". " +
            translate("color-graph.add-paint-layers")
        )
      );
    } else {
      renderPaintTree(paint, 0, palette, scrollArea, {
        onSelectPaint: (selectedPaint: any, layerIdx: number, nodeId: number) => {
          this._selectedPaintId.current =
            this._selectedPaintId.current === nodeId ? null : nodeId;
          if (this._selectedPaintId.current === null) {
            detailPane.style.display = "none";
          } else {
            detailPane.style.display = "block";
            buildDetailPane(detailPane, selectedPaint, layerIdx, palette, this);
          }
        },
        selectedPaintId: this._selectedPaintId,
      });
    }
  }
}
customElements.define("panel-color-graph", ColorGraphPanel);
