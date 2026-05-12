// src-js/views-editor/src/panel-color-layers.js

import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { Form } from "@fontra/web-components/ui-form.js";
import { collectReferencedGlyphs, setNestedGlyphOnLayer } from "./colrv1-utils.js";
import Panel from "./panel.js";
const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";
const CUSTOM_DATA_KEY = "colorLayerMapping";
const COLRV1_KEY = "colorv1";
const REPLACE_LAYER_TYPES = ["PaintTransform", "PaintScale", "PaintComposite"];

const DEFAULT_PAINTS = {
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
  PaintTranslate: {
    type: "PaintTranslate",
    dx: 0,
    dy: 0,
    paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
  },
  PaintRotate: {
    type: "PaintRotate",
    angle: 0,
    paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
  },
  PaintSkew: {
    type: "PaintSkew",
    xSkewAngle: 0,
    ySkewAngle: 0,
    paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
  },
  PaintTransform: {
    type: "PaintTransform",
    transform: { xx: 1, yx: 0, xy: 0, yy: 1, dx: 0, dy: 0 },
    paint: {
      type: "PaintGlyph",
      glyph: "",
      paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
    },
  },
  PaintComposite: {
    type: "PaintComposite",
    compositeMode: "src_in",
    sourcePaint: {
      type: "PaintColrLayers",
      layers: [
        {
          type: "PaintGlyph",
          glyph: "",
          paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
        },
      ],
    },
    backdropPaint: { type: "PaintSolid", paletteIndex: 1, alpha: 1.0 },
  },
};
// ---------------------------------------------------------------------------
// COLRv1 parameter schema (unchanged)
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
  // AFTER
  PaintTransform: [
    { key: "xx", label: "xx", pairWith: "yx", sourceKey: "transform" },
    { key: "yx", label: "yx", paired: true, sourceKey: "transform" },
    { key: "xy", label: "xy", pairWith: "yy", sourceKey: "transform" },
    { key: "yy", label: "yy", paired: true, sourceKey: "transform" },
    { key: "dx", label: "dx", pairWith: "dy", sourceKey: "transform" },
    { key: "dy", label: "dy", paired: true, sourceKey: "transform" },
  ],
  PaintComposite: [],
};

const normalizePaintType = (t) => t?.replace(/^PaintVar/, "Paint") ?? t;

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
// Variable helpers
// ---------------------------------------------------------------------------

export function isVariable(val) {
  return typeof val === "object" && val !== null && "keyframes" in val;
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
    this.sceneController.addCurrentGlyphChangeListener(() => this.update());
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

      if (tag === "v1GlyphRef") {
        const [layerIdx] = rest;
        if (this._currentPaint.layers) {
          const newLayers = this._currentPaint.layers.map((l, i) => {
            if (i !== layerIdx) return l;
            return { ...l, glyph: value };
          });
          await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        } else if (
          this._currentPaint.type === "PaintGlyph" ||
          this._currentPaint.type === "PaintColrGlyph" ||
          this._currentPaint.type === "PaintVarGlyph"
        ) {
          await this._writeV1Paint({ ...this._currentPaint, glyph: value });
        }
        return;
      }

      if (tag === "v1NestedGlyphRef") {
        const [layerIdx] = rest;

        if (this._currentPaint.layers) {
          const newLayers = this._currentPaint.layers.map((layer, i) =>
            i !== layerIdx ? layer : setNestedGlyphOnLayer(layer, value)
          );
          await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
          return;
        }

        if (normalizePaintType(this._currentPaint.type) === "PaintTransform") {
          await this._writeV1Paint(setNestedGlyphOnLayer(this._currentPaint, value));
          return;
        }

        return;
      }
      if (tag === "v1NestedPaintParam") {
        const [layerIdx, paramKey] = rest;
        await this._setV1NestedPaintParam(
          this._currentGlyphName,
          this._currentPaint,
          layerIdx,
          paramKey,
          value
        );
        return;
      }
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

      if (tag === "v1CompositeChildParam") {
        const [layerIdx, childKey, paramKey] = rest;
        const layers = this._currentPaint.layers ?? [];
        const newLayers = layers.map((layer, i) => {
          if (i !== layerIdx) return layer;
          const child = layer?.[childKey] ?? {};
          let updatedChild = child;
          if (["xx", "yx", "xy", "yy", "dx", "dy"].includes(paramKey)) {
            updatedChild = {
              ...child,
              transform: {
                ...(child.transform ?? { xx: 1, yx: 0, xy: 0, yy: 1, dx: 0, dy: 0 }),
                [paramKey]: value,
              },
            };
          } else {
            updatedChild = { ...child, [paramKey]: value };
          }
          return { ...layer, [childKey]: updatedChild };
        });
        await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        return;
      }

      if (tag === "v1CompositeChildGlyph") {
        const [layerIdx, childKey] = rest;
        const layers = this._currentPaint.layers ?? [];
        const newLayers = layers.map((layer, i) => {
          if (i !== layerIdx) return layer;
          const child = layer?.[childKey] ?? {};
          let updatedChild = child;
          if (normalizePaintType(child.type) === "PaintTransform") {
            updatedChild = {
              ...child,
              paint: {
                ...(child.paint ?? {
                  type: "PaintGlyph",
                  glyph: "",
                  paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
                }),
                glyph: value,
              },
            };
          } else {
            updatedChild = { ...child, glyph: value };
          }
          return { ...layer, [childKey]: updatedChild };
        });
        await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        return;
      }
      if (tag === "v1CompositeColrLayerParam") {
        const [layerIdx, childKey, subLayerIdx, paramKey] = rest;
        const layers = this._currentPaint.layers ?? [];
        const newLayers = layers.map((layer, i) => {
          if (i !== layerIdx) return layer;
          const child = layer?.[childKey] ?? {};
          const nextChildLayers = (child.layers ?? []).map((subLayer, j) => {
            if (j !== subLayerIdx) return subLayer;
            const isGlyph =
              subLayer.type === "PaintGlyph" || subLayer.type === "PaintVarGlyph";
            const isTransform = normalizePaintType(subLayer.type) === "PaintTransform";
            if (isGlyph)
              return {
                ...subLayer,
                paint: { ...(subLayer.paint ?? {}), [paramKey]: value },
              };
            if (isTransform)
              return {
                ...subLayer,
                paint: {
                  ...(subLayer.paint ?? {}),
                  paint: { ...(subLayer.paint?.paint ?? {}), [paramKey]: value },
                },
              };
            return subLayer;
          });
          return { ...layer, [childKey]: { ...child, layers: nextChildLayers } };
        });
        await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        return;
      }

      if (tag === "v1CompositeColrLayerGlyph") {
        const [layerIdx, childKey, subLayerIdx] = rest;
        const layers = this._currentPaint.layers ?? [];
        const newLayers = layers.map((layer, i) => {
          if (i !== layerIdx) return layer;
          const child = layer?.[childKey] ?? {};
          const nextChildLayers = (child.layers ?? []).map((subLayer, j) => {
            if (j !== subLayerIdx) return subLayer;
            const isGlyph =
              subLayer.type === "PaintGlyph" || subLayer.type === "PaintVarGlyph";
            const isTransform = normalizePaintType(subLayer.type) === "PaintTransform";
            if (isGlyph) return { ...subLayer, glyph: value };
            if (isTransform)
              return {
                ...subLayer,
                paint: { ...(subLayer.paint ?? {}), glyph: value },
              };
            return subLayer;
          });
          return { ...layer, [childKey]: { ...child, layers: nextChildLayers } };
        });
        await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        return;
      }

      if (tag === "v1CompositeColrLayerTransform") {
        const [layerIdx, childKey, subLayerIdx, tKey] = rest;
        const layers = this._currentPaint.layers ?? [];
        const newLayers = layers.map((layer, i) => {
          if (i !== layerIdx) return layer;
          const child = layer?.[childKey] ?? {};
          const nextChildLayers = (child.layers ?? []).map((subLayer, j) => {
            if (j !== subLayerIdx) return subLayer;
            if (normalizePaintType(subLayer.type) !== "PaintTransform") return subLayer;
            return {
              ...subLayer,
              transform: {
                ...(subLayer.transform ?? { xx: 1, yx: 0, xy: 0, yy: 1, dx: 0, dy: 0 }),
                [tKey]: value,
              },
            };
          });
          return { ...layer, [childKey]: { ...child, layers: nextChildLayers } };
        });
        await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        return;
      }

      if (tag === "v1CompositeColrLayersAdd") {
        const [layerIdx, childKey] = rest;
        const layers = this._currentPaint.layers ?? [];
        const newLayers = layers.map((layer, i) => {
          if (i !== layerIdx) return layer;
          const child = layer?.[childKey] ?? { type: "PaintColrLayers", layers: [] };
          const newSubLayer = {
            type: "PaintGlyph",
            glyph: "",
            paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
          };
          return {
            ...layer,
            [childKey]: {
              ...child,
              type: "PaintColrLayers",
              layers: [...(child.layers ?? []), newSubLayer],
            },
          };
        });
        await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        return;
      }

      if (tag === "v1CompositeColrLayersRemove") {
        const [layerIdx, childKey, subLayerIdx] = rest;
        const layers = this._currentPaint.layers ?? [];
        const newLayers = layers.map((layer, i) => {
          if (i !== layerIdx) return layer;
          const child = layer?.[childKey] ?? { type: "PaintColrLayers", layers: [] };
          return {
            ...layer,
            [childKey]: {
              ...child,
              layers: (child.layers ?? []).filter((_, j) => j !== subLayerIdx),
            },
          };
        });
        await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        return;
      }

      if (tag === "v1CompositeColrLayersMove") {
        const [layerIdx, childKey, subLayerIdx, delta] = rest;
        const layers = this._currentPaint.layers ?? [];
        const newLayers = layers.map((layer, i) => {
          if (i !== layerIdx) return layer;
          const child = layer?.[childKey] ?? { type: "PaintColrLayers", layers: [] };
          const arr = [...(child.layers ?? [])];
          const to = subLayerIdx + delta;
          if (
            subLayerIdx < 0 ||
            subLayerIdx >= arr.length ||
            to < 0 ||
            to >= arr.length
          )
            return layer;
          const [item] = arr.splice(subLayerIdx, 1);
          arr.splice(to, 0, item);
          return { ...layer, [childKey]: { ...child, layers: arr } };
        });
        await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
        return;
      }

      if (tag === "v1FillPaintType") {
        const [layerIdx] = rest;
        const layers = this._currentPaint.layers ?? [];
        const layer = layers[layerIdx];
        if (!layer) return;

        let newFillPaint = DEFAULT_PAINTS[value]
          ? structuredClone(DEFAULT_PAINTS[value])
          : { type: value };
        if (REPLACE_LAYER_TYPES.includes(value)) {
          const existingGlyph = layer.glyph ?? layer.paint?.glyph ?? "";
          if (existingGlyph && newFillPaint.paint?.type === "PaintGlyph") {
            newFillPaint = {
              ...newFillPaint,
              paint: { ...newFillPaint.paint, glyph: existingGlyph },
            };
          }
        }
        const newLayers = layers.map((l, i) =>
          i === layerIdx
            ? REPLACE_LAYER_TYPES.has(value)
              ? newFillPaint // PaintTransform/Scale/Composite replace whole layer ✅
              : { ...l, paint: newFillPaint } // Translate/Rotate/Skew nest under PaintGlyph clip ✅
            : l
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

    // SIMPLIFIED: Just get the colorv1 data directly
    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const varGlyph = varGlyphController?.glyph;
    const pg = this.sceneController.sceneModel.getSelectedPositionedGlyph();
    const instanceGlyph = pg?.glyph?.instance;

    // Check both instance and varGlyph for colorv1 data
    const colorV1Data =
      instanceGlyph?.customData?.[COLRV1_KEY] ?? varGlyph?.customData?.[COLRV1_KEY];

    const hasV1 = !!colorV1Data;
    const hasV0 = !!varGlyph?.customData?.[CUSTOM_DATA_KEY]?.length;

    if (hasV1) {
      // Wrap in PaintColrLayers if needed for UI consistency
      let paint = colorV1Data;
      if (paint.type !== "PaintColrLayers") {
        paint = { type: "PaintColrLayers", layers: [paint] };
      }
      this._renderV1UI(paint, glyphName, palette);
    } else if (hasV0) {
      this._renderV0UI(varGlyph, glyphName, palette);
    } else {
      this._renderEmptyUI(glyphName, palette);
    }
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

  _renderV1UI(paint, glyphName, palette) {
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

        let layerLabel = "";

        if (layer.type === "PaintGlyph" || layer.type === "PaintVarGlyph") {
          layerLabel = `${i}: PaintGlyph "${layer.glyph ?? "?"}"`;
        } else if (layer.type === "PaintColrGlyph") {
          layerLabel = `${i}: PaintColrGlyph "${layer.glyph ?? "?"}"`;
        } else if (normalizePaintType(layer.type) === "PaintTransform") {
          layerLabel = `${i}: PaintTransform${
            layer.paint?.glyph ? ` → "${layer.paint.glyph}"` : ""
          }`;
        } else {
          layerLabel = `${i}: ${layer.type ?? "Paint"}`;
        }

        formContents.push({
          type: "header",
          label: layerLabel,
          auxiliaryElement: makeMinusButton(
            () => this._removeV1Layer(glyphName, paint, i),
            translate("color-layers.remove-layer")
          ),
        });

        if (layer.type === "PaintGlyph" || layer.type === "PaintVarGlyph") {
          formContents.push({
            type: "edit-text",
            key: JSON.stringify(["v1GlyphRef", i]),
            label: translate("color-layers.glyph"),
            value: layer.glyph ?? "",
          });

          const fillPaintTypes = [
            "PaintSolid",
            "PaintLinearGradient",
            "PaintRadialGradient",
            "PaintSweepGradient",
            "PaintTranslate",
            "PaintRotate",
            "PaintSkew",
            "PaintTransform",
            "PaintComposite",
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
                        let newFillPaint = DEFAULT_PAINTS[pt]
                          ? structuredClone(DEFAULT_PAINTS[pt])
                          : { type: pt };
                        if (pt === "PaintComposite") {
                          newFillPaint.sourcePaint.layers[0].glyph = layer.glyph ?? "";
                        }
                        // For layer-replacing types, carry existing glyph into nested PaintGlyph
                        if (REPLACE_LAYER_TYPES.includes(pt)) {
                          const existingGlyph = layer.glyph ?? layer.paint?.glyph ?? "";
                          if (
                            existingGlyph &&
                            newFillPaint.paint?.type === "PaintGlyph"
                          ) {
                            newFillPaint = {
                              ...newFillPaint,
                              paint: { ...newFillPaint.paint, glyph: existingGlyph },
                            };
                          }
                        }
                        const newLayers = (this._currentPaint.layers ?? []).map(
                          (l, idx) =>
                            idx === i
                              ? REPLACE_LAYER_TYPES.includes(pt)
                                ? newFillPaint
                                : { ...l, paint: newFillPaint }
                              : l
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
        }

        const fillPaint =
          layer.type === "PaintGlyph" || layer.type === "PaintVarGlyph"
            ? layer.paint ?? layer
            : layer;
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
      const fieldSource = fd.sourceKey ? targetObj?.[fd.sourceKey] : targetObj;
      const rawVal = fieldSource?.[fd.key] ?? defaultVal;
      const displayVal = isVariable(rawVal) ? rawVal.default : rawVal;

      if (fd.pairWith) {
        const partnerFd = schema[j + 1];
        const keyA = fd.key,
          keyB = partnerFd?.key ?? fd.pairWith;
        const rawA = fieldSource?.[keyA] ?? 0;
        const rawB = fieldSource?.[keyB] ?? 0;
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

      if (j === 0) {
        j = schema.length;
        break;
      }
    }
    if (
      fillPaint.paint &&
      (fillPaint.paint.type === "PaintColrGlyph" ||
        fillPaint.paint.type === "PaintVarGlyph" ||
        fillPaint.paint.type === "PaintGlyph")
    ) {
      formContents.push({
        type: "edit-text",
        key: JSON.stringify(["v1NestedGlyphRef", layerIdx]),
        label: translate("color-layers.transformed-glyph"),
        value: fillPaint.paint.glyph ?? "",
      });

      const nestedFill = fillPaint.paint.paint ?? {
        type: "PaintSolid",
        paletteIndex: 0,
        alpha: 1.0,
      };

      if (normalizePaintType(nestedFill.type) === "PaintSolid") {
        formContents.push({
          type: "edit-number",
          key: JSON.stringify(["v1NestedPaintParam", layerIdx, "paletteIndex"]),
          label: translate("color-layers.color-index"),
          value: nestedFill.paletteIndex ?? 0,
          integer: true,
          minValue: 0,
          maxValue: palette.length - 1,
        });
        formContents.push({
          type: "edit-number",
          key: JSON.stringify(["v1NestedPaintParam", layerIdx, "alpha"]),
          label: translate("color-layers.alpha"),
          value: nestedFill.alpha ?? 1.0,
          minValue: 0,
          maxValue: 1,
        });
      }
    }
    // --- NEW PAINT COMPOSITE UI BLOCK ---
    else if (fillPaint.type === "PaintComposite") {
      const compositeModes = [
        ["srcover", "src_over"],
        ["srcin", "src_in"],
        ["srcout", "src_out"],
        ["srcatop", "src_atop"],
        ["dest", "dest"],
        ["destover", "dest_over"],
        ["destin", "dest_in"],
        ["destout", "dest_out"],
        ["destatop", "dest_atop"],
        ["xor", "xor"],
        ["plus", "plus"],
        ["screen", "screen"],
        ["overlay", "overlay"],
        ["darken", "darken"],
        ["lighten", "lighten"],
        ["colordodge", "color_dodge"],
        ["colorburn", "color_burn"],
        ["hardlight", "hard_light"],
        ["softlight", "soft_light"],
        ["difference", "difference"],
        ["exclusion", "exclusion"],
        ["multiply", "multiply"],
        ["hslhue", "hsl_hue"],
        ["hslsaturation", "hsl_saturation"],
        ["hslcolor", "hsl_color"],
        ["hslluminosity", "hsl_luminosity"],
      ];

      formContents.push({
        type: "header",
        label: "Composite Mode",
        auxiliaryElement: html.select(
          {
            value: String(fillPaint.compositeMode ?? "srcover"),
            onchange: async (event) => {
              await this.setV1PaintParam(
                this._currentGlyphName,
                this._currentPaint,
                layerIdx,
                "compositeMode",
                event.target.value
              );
            },
          },
          compositeModes.map(([value, label]) =>
            html.option(
              {
                value,
                selected: String(fillPaint.compositeMode ?? "srcover") === value,
              },
              [label]
            )
          )
        ),
      });
      // ── Source Paint ──────────────────────────────────────────────
      const sourcePaint = fillPaint.sourcePaint ?? {
        type: "PaintSolid",
        paletteIndex: 0,
        alpha: 1.0,
      };
      formContents.push({
        type: "header",
        label: `Source Paint [${sourcePaint.type ?? "?"}]`,
      });

      if (sourcePaint.type === "PaintSolid") {
        formContents.push({
          type: "edit-number",
          key: JSON.stringify([
            "v1CompositeChildParam",
            layerIdx,
            "sourcePaint",
            "paletteIndex",
          ]),
          label: translate("color-layers.color-index"),
          value: sourcePaint.paletteIndex ?? 0,
          integer: true,
          minValue: 0,
          maxValue: palette.length - 1,
        });
        formContents.push({
          type: "edit-number",
          key: JSON.stringify([
            "v1CompositeChildParam",
            layerIdx,
            "sourcePaint",
            "alpha",
          ]),
          label: translate("color-layers.alpha"),
          value: sourcePaint.alpha ?? 1.0,
          minValue: 0,
          maxValue: 1,
        });
      } else if (
        sourcePaint.type === "PaintGlyph" ||
        sourcePaint.type === "PaintVarGlyph" ||
        sourcePaint.type === "PaintColrGlyph"
      ) {
        formContents.push({
          type: "edit-text",
          key: JSON.stringify(["v1CompositeChildGlyph", layerIdx, "sourcePaint"]),
          label: "Source Glyph",
          value: sourcePaint.glyph ?? "",
        });
      } else if (sourcePaint.type === "PaintColrLayers") {
        this._pushCompositeColrLayersFields(
          formContents,
          layerIdx,
          "sourcePaint",
          sourcePaint,
          palette,
          "Source Paint"
        );
      } else {
        // Fallback for any other paint type — show type name
        formContents.push({
          type: "text",
          value: `${sourcePaint.type ?? "unknown"} — edit in paint graph`,
        });
      }

      // ── Backdrop Paint ────────────────────────────────────────────
      const backdropPaint = fillPaint.backdropPaint ?? {
        type: "PaintColrGlyph",
        glyph: "",
      };
      formContents.push({
        type: "header",
        label: `Backdrop Paint [${backdropPaint.type ?? "?"}]`,
      });

      if (backdropPaint.type === "PaintSolid") {
        formContents.push({
          type: "edit-number",
          key: JSON.stringify([
            "v1CompositeChildParam",
            layerIdx,
            "backdropPaint",
            "paletteIndex",
          ]),
          label: translate("color-layers.color-index"),
          value: backdropPaint.paletteIndex ?? 0,
          integer: true,
          minValue: 0,
          maxValue: palette.length - 1,
        });
        formContents.push({
          type: "edit-number",
          key: JSON.stringify([
            "v1CompositeChildParam",
            layerIdx,
            "backdropPaint",
            "alpha",
          ]),
          label: translate("color-layers.alpha"),
          value: backdropPaint.alpha ?? 1.0,
          minValue: 0,
          maxValue: 1,
        });
      } else if (
        backdropPaint.type === "PaintGlyph" ||
        backdropPaint.type === "PaintVarGlyph" ||
        backdropPaint.type === "PaintColrGlyph"
      ) {
        formContents.push({
          type: "edit-text",
          key: JSON.stringify(["v1CompositeChildGlyph", layerIdx, "backdropPaint"]),
          label: "Backdrop Glyph",
          value: backdropPaint.glyph ?? "",
        });
      } else if (backdropPaint.type === "PaintColrLayers") {
        this._pushCompositeColrLayersFields(
          formContents,
          layerIdx,
          "backdropPaint",
          backdropPaint,
          palette,
          "Backdrop Paint"
        );
      } else {
        formContents.push({
          type: "text",
          value: `${backdropPaint.type ?? "unknown"} — edit in paint graph`,
        });
      }
    }
  }
  _pushCompositeFields(formContents, layer, layerIdx, palette) {
    const compositeModes = [
      "src_over",
      "src_in",
      "src_out",
      "src_atop",
      "dest",
      "dest_over",
      "dest_in",
      "dest_out",
      "dest_atop",
      "xor",
      "plus",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color_dodge",
      "color_burn",
      "hard_light",
      "soft_light",
      "difference",
      "exclusion",
      "multiply",
      "hsl_hue",
      "hsl_saturation",
      "hsl_color",
      "hsl_luminosity",
    ];
    const childTypeOptions = [
      "PaintSolid",
      "PaintGlyph",
      "PaintColrLayers",
      "PaintTransform",
    ];
    const makeChildDefault = (type) => {
      switch (type) {
        case "PaintSolid":
          return { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 };
        case "PaintGlyph":
          return {
            type: "PaintGlyph",
            glyph: "",
            paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
          };
        case "PaintTransform":
          return {
            type: "PaintTransform",
            transform: { xx: 1, yx: 0, xy: 0, yy: 1, dx: 0, dy: 0 },
            paint: {
              type: "PaintGlyph",
              glyph: "",
              paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
            },
          };
        case "PaintColrLayers":
          return {
            type: "PaintColrLayers",
            layers: [
              {
                type: "PaintGlyph",
                glyph: "",
                paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
              },
            ],
          };
        default:
          return { type };
      }
    };
    const writeCompositeChild = async (childKey, childPaint) => {
      const layers = this._currentPaint.layers ?? [];
      const newLayers = layers.map((l, i) =>
        i === layerIdx ? { ...l, [childKey]: childPaint } : l
      );
      await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
    };
    const writeCompositeMode = async (mode) => {
      const layers = this._currentPaint.layers ?? [];
      const newLayers = layers.map((l, i) =>
        i === layerIdx ? { ...l, compositeMode: mode } : l
      );
      await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
    };
    const renderChild = (title, childKey, childPaint) => {
      const normalizedType = normalizePaintType(childPaint?.type) ?? "PaintSolid";
      formContents.push({ type: "header", label: title });
      for (const pt of childTypeOptions) {
        const isSelected = normalizedType === pt;
        formContents.push({
          type: "header",
          label: isSelected ? `▶ ${pt}` : `　${pt}`,
          auxiliaryElement: isSelected
            ? null
            : html.button(
                {
                  style: "font-size:0.75em;opacity:0.7;",
                  onclick: async () =>
                    writeCompositeChild(childKey, makeChildDefault(pt)),
                },
                ["use"]
              ),
        });
      }
      if (normalizedType === "PaintSolid") {
        formContents.push({
          type: "edit-number",
          key: JSON.stringify([
            "v1CompositeChildParam",
            layerIdx,
            childKey,
            "paletteIndex",
          ]),
          label: translate("color-layers.color-index"),
          value: childPaint?.paletteIndex ?? 0,
          integer: true,
          minValue: 0,
          maxValue: palette.length - 1,
        });
        formContents.push({
          type: "edit-number",
          key: JSON.stringify(["v1CompositeChildParam", layerIdx, childKey, "alpha"]),
          label: translate("color-layers.alpha"),
          value: childPaint?.alpha ?? 1.0,
          minValue: 0,
          maxValue: 1,
        });
        return;
      }
      if (normalizedType === "PaintGlyph") {
        formContents.push({
          type: "edit-text",
          key: JSON.stringify(["v1CompositeChildGlyph", layerIdx, childKey]),
          label: translate("color-layers.glyph"),
          value: childPaint?.glyph ?? "",
        });
        this._pushParamFields(
          formContents,
          PAINT_PARAM_SCHEMA[
            normalizePaintType(childPaint?.paint?.type) ?? "PaintSolid"
          ] ?? [],
          childPaint?.paint ?? { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
          layerIdx,
          palette
        );
        return;
      }
      if (normalizedType === "PaintTransform") {
        const t = childPaint?.transform ?? { xx: 1, yx: 0, xy: 0, yy: 1, dx: 0, dy: 0 };
        formContents.push({
          type: "edit-number-x-y",
          label: "xx / yx",
          fieldX: {
            key: JSON.stringify(["v1CompositeChildParam", layerIdx, childKey, "xx"]),
            value: t.xx ?? 1,
          },
          fieldY: {
            key: JSON.stringify(["v1CompositeChildParam", layerIdx, childKey, "yx"]),
            value: t.yx ?? 0,
          },
        });
        formContents.push({
          type: "edit-number-x-y",
          label: "xy / yy",
          fieldX: {
            key: JSON.stringify(["v1CompositeChildParam", layerIdx, childKey, "xy"]),
            value: t.xy ?? 0,
          },
          fieldY: {
            key: JSON.stringify(["v1CompositeChildParam", layerIdx, childKey, "yy"]),
            value: t.yy ?? 1,
          },
        });
        formContents.push({
          type: "edit-number-x-y",
          label: "dx / dy",
          fieldX: {
            key: JSON.stringify(["v1CompositeChildParam", layerIdx, childKey, "dx"]),
            value: t.dx ?? 0,
          },
          fieldY: {
            key: JSON.stringify(["v1CompositeChildParam", layerIdx, childKey, "dy"]),
            value: t.dy ?? 0,
          },
        });
        formContents.push({
          type: "edit-text",
          key: JSON.stringify(["v1CompositeChildGlyph", layerIdx, childKey]),
          label: translate("color-layers.glyph"),
          value: childPaint?.paint?.glyph ?? "",
        });
        const nestedFill = childPaint?.paint?.paint ?? {
          type: "PaintSolid",
          paletteIndex: 0,
          alpha: 1.0,
        };
        this._pushParamFields(
          formContents,
          PAINT_PARAM_SCHEMA[normalizePaintType(nestedFill?.type) ?? "PaintSolid"] ??
            [],
          nestedFill,
          layerIdx,
          palette
        );
        return;
      }
      if (normalizedType === "PaintColrLayers") {
        this._pushCompositeColrLayersFields(
          formContents,
          layerIdx,
          childKey,
          childPaint,
          palette,
          title
        );
      }
    };
    formContents.push({ type: "header", label: "Composite Mode" });
    for (const mode of compositeModes) {
      const isSelected = (layer.compositeMode ?? "src_over") === mode;
      formContents.push({
        type: "header",
        label: isSelected ? `▶ ${mode}` : `　${mode}`,
        auxiliaryElement: isSelected
          ? null
          : html.button(
              {
                style: "font-size:0.75em;opacity:0.7;",
                onclick: async () => writeCompositeMode(mode),
              },
              ["use"]
            ),
      });
    }
    renderChild(
      "Source Paint",
      "sourcePaint",
      layer.sourcePaint ?? makeChildDefault("PaintColrLayers")
    );
    renderChild(
      "Backdrop Paint",
      "backdropPaint",
      layer.backdropPaint ?? makeChildDefault("PaintSolid")
    );
  }

  _pushCompositeColrLayersFields(
    formContents,
    layerIdx,
    childKey,
    colrLayersPaint,
    palette,
    title = "PaintColrLayers"
  ) {
    const childLayers = colrLayersPaint?.layers ?? [];
    formContents.push({
      type: "header",
      label: `${title} Layers (${childLayers.length})`,
      auxiliaryElement: html.div(
        { style: "display:flex;gap:4px;align-items:center;" },
        [
          makePlusButton(async () => {
            const layers = this._currentPaint.layers ?? [];
            const newSubLayer = {
              type: "PaintGlyph",
              glyph: "",
              paint: { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 },
            };
            const newLayers = layers.map((l, i) => {
              if (i !== layerIdx) return l;
              const child = l?.[childKey] ?? { type: "PaintColrLayers", layers: [] };
              return {
                ...l,
                [childKey]: {
                  ...child,
                  type: "PaintColrLayers",
                  layers: [...(child.layers ?? []), newSubLayer],
                },
              };
            });
            await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
          }, translate("color-layers.add-layer")),
        ]
      ),
    });
    if (childLayers.length === 0) {
      formContents.push({
        type: "text",
        value: translate("color-layers.no-layers-yet"),
      });
      return;
    }
    for (let subIndex = 0; subIndex < childLayers.length; subIndex++) {
      const subLayer = childLayers[subIndex];
      const isTransform = normalizePaintType(subLayer.type) === "PaintTransform";
      const isGlyph =
        subLayer.type === "PaintGlyph" || subLayer.type === "PaintVarGlyph";
      const label = isTransform
        ? `${subIndex}: PaintTransform → ${subLayer.paint?.glyph ?? ""}`
        : isGlyph
        ? `${subIndex}: PaintGlyph "${subLayer.glyph ?? ""}"`
        : `${subIndex}: ${subLayer.type ?? "Paint"}`;
      formContents.push({
        type: "header",
        label,
        auxiliaryElement: html.div(
          { style: "display:flex;gap:4px;align-items:center;" },
          [
            html.button(
              {
                style: "font-size:0.75em;opacity:0.7;",
                title: "Move up",
                onclick: async () => {
                  const layers = this._currentPaint.layers ?? [];
                  const to = subIndex - 1;
                  if (to < 0) return;
                  const newLayers = layers.map((l, i) => {
                    if (i !== layerIdx) return l;
                    const child = l?.[childKey] ?? {
                      type: "PaintColrLayers",
                      layers: [],
                    };
                    const arr = [...(child.layers ?? [])];
                    const [item] = arr.splice(subIndex, 1);
                    arr.splice(to, 0, item);
                    return { ...l, [childKey]: { ...child, layers: arr } };
                  });
                  await this._writeV1Paint({
                    ...this._currentPaint,
                    layers: newLayers,
                  });
                },
              },
              ["↑"]
            ),
            html.button(
              {
                style: "font-size:0.75em;opacity:0.7;",
                title: "Move down",
                onclick: async () => {
                  const layers = this._currentPaint.layers ?? [];
                  const to = subIndex + 1;
                  const newLayers = layers.map((l, i) => {
                    if (i !== layerIdx) return l;
                    const child = l?.[childKey] ?? {
                      type: "PaintColrLayers",
                      layers: [],
                    };
                    const arr = [...(child.layers ?? [])];
                    if (to >= arr.length) return l;
                    const [item] = arr.splice(subIndex, 1);
                    arr.splice(to, 0, item);
                    return { ...l, [childKey]: { ...child, layers: arr } };
                  });
                  await this._writeV1Paint({
                    ...this._currentPaint,
                    layers: newLayers,
                  });
                },
              },
              ["↓"]
            ),
            makeMinusButton(async () => {
              const layers = this._currentPaint.layers ?? [];
              const newLayers = layers.map((l, i) => {
                if (i !== layerIdx) return l;
                const child = l?.[childKey] ?? { type: "PaintColrLayers", layers: [] };
                return {
                  ...l,
                  [childKey]: {
                    ...child,
                    layers: (child.layers ?? []).filter((_, j) => j !== subIndex),
                  },
                };
              });
              await this._writeV1Paint({ ...this._currentPaint, layers: newLayers });
            }, translate("color-layers.remove-layer")),
          ]
        ),
      });
      if (isTransform) {
        const t = subLayer.transform ?? { xx: 1, yx: 0, xy: 0, yy: 1, dx: 0, dy: 0 };
        formContents.push({
          type: "edit-number-x-y",
          label: "xx / yx",
          fieldX: {
            key: JSON.stringify([
              "v1CompositeColrLayerTransform",
              layerIdx,
              childKey,
              subIndex,
              "xx",
            ]),
            value: t.xx ?? 1,
          },
          fieldY: {
            key: JSON.stringify([
              "v1CompositeColrLayerTransform",
              layerIdx,
              childKey,
              subIndex,
              "yx",
            ]),
            value: t.yx ?? 0,
          },
        });
        formContents.push({
          type: "edit-number-x-y",
          label: "xy / yy",
          fieldX: {
            key: JSON.stringify([
              "v1CompositeColrLayerTransform",
              layerIdx,
              childKey,
              subIndex,
              "xy",
            ]),
            value: t.xy ?? 0,
          },
          fieldY: {
            key: JSON.stringify([
              "v1CompositeColrLayerTransform",
              layerIdx,
              childKey,
              subIndex,
              "yy",
            ]),
            value: t.yy ?? 1,
          },
        });
        formContents.push({
          type: "edit-number-x-y",
          label: "dx / dy",
          fieldX: {
            key: JSON.stringify([
              "v1CompositeColrLayerTransform",
              layerIdx,
              childKey,
              subIndex,
              "dx",
            ]),
            value: t.dx ?? 0,
          },
          fieldY: {
            key: JSON.stringify([
              "v1CompositeColrLayerTransform",
              layerIdx,
              childKey,
              subIndex,
              "dy",
            ]),
            value: t.dy ?? 0,
          },
        });
      }
      const glyphRef = isTransform ? subLayer.paint?.glyph : subLayer.glyph;
      formContents.push({
        type: "edit-text",
        key: JSON.stringify([
          "v1CompositeColrLayerGlyph",
          layerIdx,
          childKey,
          subIndex,
        ]),
        label: translate("color-layers.glyph"),
        value: glyphRef ?? "",
      });
      const solidFill = isTransform ? subLayer.paint?.paint : subLayer.paint;
      if (solidFill && normalizePaintType(solidFill.type) === "PaintSolid") {
        formContents.push({
          type: "edit-number",
          key: JSON.stringify([
            "v1CompositeColrLayerParam",
            layerIdx,
            childKey,
            subIndex,
            "paletteIndex",
          ]),
          label: translate("color-layers.color-index"),
          value: solidFill.paletteIndex ?? 0,
          integer: true,
          minValue: 0,
          maxValue: palette.length - 1,
        });
        formContents.push({
          type: "edit-number",
          key: JSON.stringify([
            "v1CompositeColrLayerParam",
            layerIdx,
            childKey,
            subIndex,
            "alpha",
          ]),
          label: translate("color-layers.alpha"),
          value: solidFill.alpha ?? 1.0,
          minValue: 0,
          maxValue: 1,
        });
      } else {
        formContents.push({
          type: "text",
          value: `${solidFill?.type ?? "unknown"} nested fill is currently read-only`,
        });
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
    const TRANSFORM_MATRIX_KEYS = ["xx", "yx", "xy", "yy", "dx", "dy"];
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;
      const layerIsTransform = normalizePaintType(layer.type) === "PaintTransform";
      const fillPaint = !layerIsTransform && layer.paint != null ? layer.paint : layer;
      const isTransformMatrixKey =
        TRANSFORM_MATRIX_KEYS.includes(key) &&
        normalizePaintType(fillPaint.type) === "PaintTransform";
      const updatedFill = isTransformMatrixKey
        ? { ...fillPaint, transform: { ...fillPaint.transform, [key]: value } }
        : { ...fillPaint, [key]: value };
      return !layerIsTransform && layer.paint != null
        ? { ...layer, paint: updatedFill }
        : updatedFill;
    });
    await this._writeV1Paint({ ...paint, layers });
  }

  async _setV1NestedPaintParam(glyphName, paint, layerIndex, key, value) {
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;

      // Shape B: PaintTransform → PaintGlyph → PaintSolid
      // layer.paint is the PaintGlyph; layer.paint.paint is the PaintSolid to update
      if (normalizePaintType(layer.type) === "PaintTransform") {
        const glyphPaint = layer.paint;
        if (
          !glyphPaint ||
          !["PaintGlyph", "PaintVarGlyph", "PaintColrGlyph"].includes(glyphPaint.type)
        ) {
          return layer;
        }
        return {
          ...layer,
          paint: {
            ...glyphPaint,
            paint: {
              ...(glyphPaint.paint ?? {
                type: "PaintSolid",
                paletteIndex: 0,
                alpha: 1.0,
              }),
              [key]: value,
            },
          },
        };
      }

      // Original path (kept for any future Shape A usage, currently unreachable)
      const fillPaint = layer.paint ?? layer;
      const nestedGlyphPaint = fillPaint.paint;
      if (
        !nestedGlyphPaint ||
        !["PaintGlyph", "PaintVarGlyph", "PaintColrGlyph"].includes(
          nestedGlyphPaint.type
        )
      ) {
        return layer;
      }
      const updatedNestedGlyphPaint = {
        ...nestedGlyphPaint,
        paint: {
          ...(nestedGlyphPaint.paint ?? {
            type: "PaintSolid",
            paletteIndex: 0,
            alpha: 1.0,
          }),
          [key]: value,
        },
      };
      return layer.paint != null
        ? { ...layer, paint: { ...fillPaint, paint: updatedNestedGlyphPaint } }
        : { ...fillPaint, paint: updatedNestedGlyphPaint };
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
      if (fillPaint.colorLine && arrayKey === "colorStops") {
        const newFill = {
          ...fillPaint,
          colorLine: { ...fillPaint.colorLine, colorStops: newArray },
        };
        return layer.paint != null
          ? { ...layer, paint: newFill }
          : { ...layer, ...newFill };
      }
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
      const layerName = defaultSource?.layerName;
      const layerGlyph = varGlyph.layers?.[layerName]?.glyph;

      if (layerGlyph) {
        if (!layerGlyph.customData) layerGlyph.customData = {};
        layerGlyph.customData[COLRV1_KEY] = newPaint;
        layerGlyph.customData["fontra.colrv1.referencedGlyphs"] =
          collectReferencedGlyphs(newPaint);

        if (varGlyph.customData?.[COLRV1_KEY]) {
          delete varGlyph.customData[COLRV1_KEY];
        }
      } else {
        console.error("Paint Tool Error: Could not find target layer for data write.");
      }
      return translate("color-layers.edit-colrv1-paint");
    });
  }
  // ── COLRv0 mutations (unchanged) ─────────────────────────────────────────

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
      // 1. Create the layer entry if it doesn't exist (Geometric structure)
      if (!glyph.layers[layerName]) {
        glyph.layers[layerName] = {
          glyph: {
            path: { contours: [] },
            components: [],
            customData: {}, // Ensure customData exists at the layer level
          },
        };
      }

      // 2. Update the COLRv0 mapping (for backward compatibility)
      glyph.customData[CUSTOM_DATA_KEY] = newMapping;

      // 3. Update COLRv1 structure if it exists (C.json style)
      // We check if the glyph is already being treated as a COLRv1 glyph
      const defaultSource =
        glyph.sources?.find((s) => !s.inactive && !s.locationBase) ??
        glyph.sources?.[0];
      const primaryLayerName = defaultSource?.layerName;
      const primaryLayerGlyph = glyph.layers?.[primaryLayerName]?.glyph;

      if (primaryLayerGlyph && primaryLayerGlyph.customData?.[COLRV1_KEY]) {
        const paint = primaryLayerGlyph.customData[COLRV1_KEY];
        if (paint.layers) {
          // Add the new layer to the COLRv1 paint graph
          paint.layers.push({
            type: "PaintGlyph",
            glyph: glyphName, // Or the specific component name
            paint: { type: "PaintSolid", paletteIndex: colorIndex, alpha: 1.0 },
          });
        }
      }

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

  async _convertV0toV1(glyphName, mapping, palette) {
    const layers = mapping.map(([layerName, colorIndex]) => ({
      type: "PaintGlyph",
      glyph: layerName, // In V1, this usually refers to the glyph name itself or a component
      paint: { type: "PaintSolid", paletteIndex: colorIndex, alpha: 1.0 },
    }));

    await this.sceneController.editGlyphAndRecordChanges((varGlyph) => {
      // 1. Find the target layer (C.json style)
      const defaultSource =
        varGlyph.sources?.find((s) => !s.inactive && !s.locationBase) ??
        varGlyph.sources?.[0];
      const layerName = defaultSource?.layerName;
      const layerGlyph = varGlyph.layers?.[layerName]?.glyph;

      if (layerGlyph) {
        // 2. Attach the new COLRv1 paint to the specific layer
        if (!layerGlyph.customData) layerGlyph.customData = {};
        layerGlyph.customData[COLRV1_KEY] = { type: "PaintColrLayers", layers };

        // 3. Clean up the old COLRv0 data (usually stored in 'colorv0')
        delete varGlyph.customData[CUSTOM_DATA_KEY];

        // 4. Safety: Ensure no "D.json" style root data exists
        if (varGlyph.customData?.[COLRV1_KEY]) delete varGlyph.customData[COLRV1_KEY];
      }

      return translate("color-layers.convert-v0-to-v1");
    });
  }

  _getCurrentDesignSpaceTarget() {
    const location = this.sceneController.sceneSettings.location || {};
    const axes = this.fontController.globalAxes ?? [];

    for (const axis of axes) {
      const currentVal = location[axis.tag];
      const defaultVal = axis.defaultValue ?? 0;
      if (currentVal !== undefined && currentVal !== defaultVal) {
        return { tag: axis.tag, loc: currentVal };
      }
    }

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
    const currentValue = isVariable(val) ? resolveAtLocation(val, { [tag]: loc }) : val;

    let newKfs = [];
    if (isVariable(val)) {
      newKfs = [...val.keyframes, { axis: tag, loc, value: currentValue }];
    } else {
      newKfs = [{ axis: tag, loc, value: val }];
    }

    newKfs.sort((a, b) => a.loc - b.loc);
    await this._setV1FieldKeyframes(glyphName, paint, layerIdx, field, newKfs);
  }
}
export { DEFAULT_PAINTS, normalizePaintType, PAINT_PARAM_SCHEMA };
customElements.define("panel-color-layers", ColorLayersPanel);
