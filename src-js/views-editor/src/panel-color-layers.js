// src-js/views-editor/src/panel-color-layers.js

import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { Form } from "@fontra/web-components/ui-form.js";
import Panel from "./panel.js";

const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";
const CUSTOM_DATA_KEY = "colorLayerMapping";
const COLRV1_KEY = "colorv1";

// ---------------------------------------------------------------------------
// COLRv1 parameter schema
// ---------------------------------------------------------------------------
const PAINT_PARAM_SCHEMA = {
  PaintSolid: [
    {
      key: "paletteIndex",
      label: translate("color-layers.color-index"),
      min: 0,
      integer: true,
    },
    { key: "alpha", label: translate("color-layers.alpha"), min: 0, max: 1 },
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
      sourceKey: "colorLine", // ← nested under colorLine
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
  PaintRotate: [{ key: "angle", label: "Angle (turns)", min: -1, max: 1 }],
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
  PaintTransform: [
    { key: "xx", label: "xx", pairWith: "yx" },
    { key: "yx", label: "yx", paired: true },
    { key: "yy", label: "yy", paired: true },
    { key: "dx", label: "dx", pairWith: "dy" },
    { key: "dy", label: "dy", paired: true },
  ],
};

const normalizePaintType = (t) => t?.replace(/^PaintVar/, "Paint") ?? t;

// ---------------------------------------------------------------------------
// Helpers
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

      const [tag, ...rest] = parsed; //

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

      // Handle array parameters (gradient stops)
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
    };

    return html.div({ class: "panel" }, [
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [this.colorLayersForm]
      ),
    ]);
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
    const pg = this.sceneController.sceneModel.getSelectedPositionedGlyph();
    const layerGlyph = pg?.glyph?.instance;
    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();
    const varGlyph = varGlyphController?.glyph;

    const hasV1 = !!layerGlyph?.customData?.[COLRV1_KEY];
    const hasV0 = !!varGlyph?.customData?.[CUSTOM_DATA_KEY]?.length;

    if (hasV1) {
      this._renderV1UI(layerGlyph, glyphName, palette);
    } else if (hasV0) {
      this._renderV0UI(varGlyph, glyphName, palette);
    } else {
      this._renderEmptyUI(glyphName, palette);
    }
  }

  _renderV1UI(glyph, glyphName, palette) {
    const paint = glyph.customData[COLRV1_KEY] ?? {
      type: "PaintColrLayers",
      layers: [],
    };
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
        const layerLabel =
          layer.type === "PaintGlyph" || layer.type === "PaintVarGlyph"
            ? `${i}: PaintGlyph "${layer.glyph ?? "?"}"`
            : `${i}: ${layer.type ?? "Paint"}`;

        formContents.push({
          type: "header",
          label: layerLabel,
          auxiliaryElement: makeMinusButton(
            () => this._removeV1Layer(glyphName, paint, i),
            translate("color-layers.remove-layer")
          ),
        });

        formContents.push({
          type: "edit-text",
          key: JSON.stringify(["v1PaintType", i]),
          label: translate("color-layers.paint-type"),
          value: layer.type ?? "",
        });

        if (layer.type === "PaintGlyph" || layer.type === "PaintVarGlyph") {
          formContents.push({
            type: "edit-text",
            key: JSON.stringify(["v1GlyphRef", i]),
            label: translate("color-layers.glyph"),
            value: layer.glyph ?? "",
          });
        }

        const fillPaint = layer.paint ?? layer;
        const normalType = normalizePaintType(fillPaint?.type ?? layer.type);
        const schema = PAINT_PARAM_SCHEMA[normalType] ?? [];

        this._pushParamFields(formContents, schema, fillPaint, i, layer, palette);
      }
    }
    this.colorLayersForm.setFieldDescriptions(formContents);
  }

  _pushParamFields(formContents, schema, fillPaint, layerIdx, layer, palette) {
    const targetObj = fillPaint; // Target the resolved paint object

    let j = 0;
    while (j < schema.length) {
      const fd = schema[j]; //

      if (fd.type === "array") {
        this._pushArrayParamFields(
          formContents,
          fd,
          targetObj,
          layerIdx,
          layer,
          palette
        );
        j++;
        continue;
      }

      if (fd.paired) {
        j++;
        continue;
      }

      if (fd.pairWith) {
        const partnerFd = schema[j + 1];
        const keyA = fd.key;
        const keyB = partnerFd?.key ?? fd.pairWith;

        formContents.push({
          type: "edit-number-x-y",
          label: `${translate(fd.label)} / ${translate(partnerFd?.label ?? keyB)}`,
          fieldX: {
            key: JSON.stringify(["v1Param", layerIdx, keyA]),
            value: targetObj?.[keyA] ?? 0,
          },
          fieldY: {
            key: JSON.stringify(["v1Param", layerIdx, keyB]),
            value: targetObj?.[keyB] ?? 0,
          },
        });
        j += 2;
      } else {
        const isIndex = fd.key === "paletteIndex";
        const defaultVal =
          fd.key === "alpha"
            ? 1.0
            : ["scaleX", "scaleY", "scale", "xx", "yy"].includes(fd.key)
            ? 1.0
            : 0; // [cite: 77-82]

        formContents.push({
          type: "edit-number",
          key: JSON.stringify(["v1Param", layerIdx, fd.key]),
          label: translate(fd.label),
          value: targetObj?.[fd.key] ?? defaultVal,
          integer: fd.integer ?? false,
          minValue: fd.min ?? (isIndex ? 0 : undefined),
          maxValue: isIndex ? palette.length - 1 : fd.max ?? undefined,
        });
        j++;
      }
    }
  }

  _pushArrayParamFields(formContents, fieldDef, targetObj, layerIdx, layer, palette) {
    const source = fieldDef.sourceKey ? targetObj?.[fieldDef.sourceKey] : targetObj;
    const arrayData = source?.[fieldDef.key] ?? [];
    const itemSchema = fieldDef.itemSchema ?? [];

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

      for (const itemField of itemSchema) {
        const isIndex = itemField.key === "paletteIndex";
        const defaultVal = itemField.key === "alpha" ? 1.0 : 0;

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
          value: item?.[itemField.key] ?? defaultVal,
          integer: itemField.integer ?? false,
          minValue: itemField.min ?? (isIndex ? 0 : undefined),
          maxValue: isIndex ? palette.length - 1 : itemField.max ?? undefined,
        });
      }
    }
  }

  // ── COLRv1 Mutations ──────────────────────────────────────────────────────

  async _setV1PaintParam(glyphName, paint, layerIndex, key, value) {
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;
      if (layer.paint != null) {
        return { ...layer, paint: { ...layer.paint, [key]: value } };
      }
      return { ...layer, [key]: value };
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
      const array = fillPaint[arrayKey] ?? [];
      const newArray = array.map((item, idx) =>
        idx === itemIdx ? { ...item, [itemKey]: value } : item
      );

      return layer.paint != null
        ? { ...layer, paint: { ...layer.paint, [arrayKey]: newArray } }
        : { ...layer, [arrayKey]: newArray };
    });
    await this._writeV1Paint({ ...paint, layers });
  }

  async _addArrayItem(layerIdx, arrayKey, currentArray) {
    const newItem = arrayKey === "varStopColor" ? { paletteIndex: 0, alpha: 1.0 } : {};
    const newArray = [...currentArray, newItem];
    await this._setV1ArrayField(
      this._currentGlyphName,
      this._currentPaint,
      layerIdx,
      arrayKey,
      newArray
    );
  }

  async _removeArrayItem(layerIdx, arrayKey, itemIdx) {
    const layers = (this._currentPaint.layers ?? []).map((layer, i) => {
      if (i !== layerIdx) return layer;
      const fillPaint = layer.paint ?? layer;
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
      const layerGlyph = varGlyph.layers?.[defaultSource?.layerName]?.glyph;
      if (layerGlyph) {
        if (!layerGlyph.customData) layerGlyph.customData = {};
        layerGlyph.customData[COLRV1_KEY] = newPaint;
      }
      return translate("color-layers.edit-colrv1-paint");
    });
  }

  // ── COLRv0 UI ─────────────────────────────────────────────────────────────

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
          label: translate("sidebar.selection-info.color-index"),
          value: colorIndex,
          integer: true,
          minValue: 0,
          maxValue: palette.length - 1,
        });
      }
      formContents.push({
        type: "header",
        label: "",
        auxiliaryElement: html.button(
          {
            title: "Convert to COLRv1",
            onclick: () => this._convertV0toV1(glyphName, mapping, palette),
            style: "font-size:0.75em;opacity:0.6;",
          },
          ["→ COLRv1"]
        ),
      });
    }

    this.colorLayersForm.setFieldDescriptions(formContents);
  }

  // ── COLRv0 mutations ──────────────────────────────────────────────────────

  _nextLayerName(mapping) {
    const existing = new Set(mapping.map(([n]) => n));
    let i = 0;
    while (existing.has(`color.${i}`)) i++;
    return `color.${i}`;
  }

  async _writeMapping(glyphName, newMapping) {
    await this.sceneController.editGlyphAndRecordChanges((glyph) => {
      if (newMapping.length > 0) {
        glyph.customData[CUSTOM_DATA_KEY] = newMapping;
      } else {
        delete glyph.customData[CUSTOM_DATA_KEY];
      }
      return translate("color-layers.edit-description");
    });
  }

  async _addLayer(glyphName, paletteSize, mapping) {
    const layerName = this._nextLayerName(mapping);
    const colorIndex = mapping.length < paletteSize ? mapping.length : 0;
    const newMapping = [...mapping, [layerName, colorIndex]];
    await this.sceneController.editGlyphAndRecordChanges((glyph) => {
      if (!glyph.layers[layerName]) {
        glyph.layers[layerName] = { glyph: { path: { contours: [] }, components: [] } };
      }
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

  // ── COLRv0 → COLRv1 converter ─────────────────────────────────────────────

  async _convertV0toV1(glyphName, mapping, palette) {
    const layers = mapping.map(([layerName, colorIndex]) => ({
      type: "PaintGlyph",
      glyph: layerName,
      paint: { type: "PaintSolid", paletteIndex: colorIndex, alpha: 1.0 },
    }));
    await this.sceneController.editGlyphAndRecordChanges((varGlyph) => {
      const defaultSource =
        varGlyph.sources?.find((s) => !s.inactive && !s.locationBase) ??
        varGlyph.sources?.[0];
      const layerGlyph = varGlyph.layers?.[defaultSource?.layerName]?.glyph;
      if (layerGlyph) {
        if (!layerGlyph.customData) layerGlyph.customData = {};
        layerGlyph.customData[COLRV1_KEY] = { type: "PaintColrLayers", layers };
      }
      delete varGlyph.customData[CUSTOM_DATA_KEY];
      return translate("color-layers.convert-v0-to-v1");
    });
  }
}

customElements.define("panel-color-layers", ColorLayersPanel);
