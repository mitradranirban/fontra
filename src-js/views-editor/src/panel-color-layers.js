// src-js/views-editor/src/panel-color-layers.js

import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { Form } from "@fontra/web-components/ui-form.js";
import Panel from "./panel.js";

const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";
const CUSTOM_DATA_KEY = "colorLayerMapping";
const COLRV1_KEY = "colorv1";

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
  PaintTransform: [
    { key: "xx", label: "xx", pairWith: "yx" },
    { key: "yx", label: "yx", paired: true },
    { key: "xy", label: "xy", pairWith: "yy" },
    { key: "yy", label: "yy", paired: true },
    { key: "dx", label: "dx", pairWith: "dy" },
    { key: "dy", label: "dy", paired: true },
  ],
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
      if (tag === "v1GlyphRef") {
        const [layerIdx] = rest;
        await this._setV1LayerField(
          this._currentGlyphName,
          this._currentPaint,
          layerIdx,
          "glyph",
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
      if (tag === "v1FillPaintType") {
        const [layerIdx] = rest;
        const layers = this._currentPaint.layers ?? [];
        const layer = layers[layerIdx];
        if (!layer) return;
        const defaults = {
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
        };
        const newFillPaint = defaults[value] ?? { type: value };
        const newLayers = layers.map((l, i) =>
          i === layerIdx ? { ...l, paint: newFillPaint } : l
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
          const glyphName = layer.glyph ?? "?";
          layerLabel = `${i}: PaintGlyph "${glyphName}"`;
        } else if (layer.type === "PaintColrGlyph") {
          const glyphName = layer.glyph ?? "?";
          layerLabel = `${i}: PaintColrGlyph "${glyphName}"`;
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
                        const defaults = {
                          PaintSolid: {
                            type: "PaintSolid",
                            paletteIndex: 0,
                            alpha: 1.0,
                          },
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
                        };
                        const newFillPaint = defaults[pt] ?? { type: pt };
                        const newLayers = (this._currentPaint.layers ?? []).map(
                          (l, idx) => (idx === i ? { ...l, paint: newFillPaint } : l)
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

        const fillPaint = layer.paint ?? layer;
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
      const rawVal = targetObj?.[fd.key] ?? defaultVal;
      const displayVal = isVariable(rawVal) ? rawVal.default : rawVal;

      if (fd.pairWith) {
        const partnerFd = schema[j + 1];
        const keyA = fd.key,
          keyB = partnerFd?.key ?? fd.pairWith;
        const rawA = targetObj?.[keyA] ?? 0;
        const rawB = targetObj?.[keyB] ?? 0;
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
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;
      return layer.paint != null
        ? { ...layer, paint: { ...layer.paint, [key]: value } }
        : { ...layer, [key]: value };
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
      // SIMPLIFIED: Write directly to customData["colorv1"]
      if (!varGlyph.customData) varGlyph.customData = {};
      varGlyph.customData[COLRV1_KEY] = newPaint;
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
      if (!glyph.layers[layerName])
        glyph.layers[layerName] = { glyph: { path: { contours: [] }, components: [] } };
      glyph.customData[CUSTOM_DATA_KEY] = newMapping;
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
      glyph: layerName,
      paint: { type: "PaintSolid", paletteIndex: colorIndex, alpha: 1.0 },
    }));
    await this.sceneController.editGlyphAndRecordChanges((varGlyph) => {
      if (!varGlyph.customData) varGlyph.customData = {};
      varGlyph.customData[COLRV1_KEY] = { type: "PaintColrLayers", layers };
      delete varGlyph.customData[CUSTOM_DATA_KEY];
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

customElements.define("panel-color-layers", ColorLayersPanel);
