// src-js/views-editor/src/panel-color-layers.js

import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { Form } from "@fontra/web-components/ui-form.js";
import Panel from "./panel.js";

const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";

// MAPPING_KEY is the canonical UFO lib key used by ufo2ft.
// The backend reads/writes it at the top level of the .glif lib.
// Internally, Fontra transfers it through glyph.customData under the
// short key below so the backend's pop("colorLayerMapping") finds it.
const MAPPING_KEY = "com.github.googlei18n.ufo2ft.colorLayerMapping"; // kept for reference
const CUSTOM_DATA_KEY = "colorLayerMapping"; // short key used in glyph.customData
const COLRV1_KEY = "colorv1"; // key used in glyph.customData for COLRv1 paint graph

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlusButton(onclick, title) {
  return html.div(
    {
      style: "cursor: pointer; font-size: 1.2em; line-height: 1; padding: 0 0.3em;",
      onclick,
      title,
    },
    ["+"]
  );
}

function makeMinusButton(onclick, title) {
  return html.div(
    {
      style: "cursor: pointer; font-size: 1.2em; line-height: 1; padding: 0 0.3em;",
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
    return html.div({ class: "panel" }, [
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [this.colorLayersForm]
      ),
    ]);
  }

  async toggle(on, focus) {
    if (on) {
      this.update();
    }
  }

  // ── Entry point ────────────────────────────────────────────────────────────

  async update() {
    // Guard: catch font-not-ready errors during startup
    let customData;
    try {
      customData = this.fontController.customData ?? {};
    } catch {
      return; // Font not ready yet, will be called again when ready
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

  // ── Empty state ────────────────────────────────────────────────────────────

  _renderEmptyUI(glyphName, palette) {
    const formContents = [
      { type: "text", value: translate("color-layers.no-layers-yet") },
    ];

    // Offer both V0 and V1 as starting points
    formContents.push({
      type: "header",
      label: translate("color-layers.title"),
      auxiliaryElement: html.div({ style: "display:flex; gap:4px;" }, [
        html.button(
          {
            title: "Start COLRv0 (layer mapping)",
            onclick: () => this._addLayer(glyphName, palette.length, []),
          },
          ["v0 +"]
        ),
        html.button(
          {
            title: "Start COLRv1 (paint graph)",
            onclick: () => this._initV1(glyphName),
          },
          ["v1 +"]
        ),
      ]),
    });

    this.colorLayersForm.setFieldDescriptions(formContents);
  }

  // ── COLRv0 UI (original logic, unchanged) ─────────────────────────────────

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
          getValue: () => mapping[i][1],
          setValue: async (glyph, layerGlyph, fieldItem, value) => {
            await this._setColorIndex(glyphName, i, value);
          },
        });
      }
    }

    // Allow converting to COLRv1
    formContents.push({
      type: "header",
      label: "",
      auxiliaryElement: html.button(
        {
          title: "Convert this glyph to COLRv1 paint graph",
          onclick: () => this._convertV0toV1(glyphName, mapping, palette),
          style: "font-size:0.75em; opacity:0.6;",
        },
        ["→ COLRv1"]
      ),
    });

    this.colorLayersForm.setFieldDescriptions(formContents);
  }

  // ── COLRv1 UI ─────────────────────────────────────────────────────────────

  _renderV1UI(glyph, glyphName, palette) {
    const paint = glyph.customData[COLRV1_KEY] ?? {
      type: "PaintColrLayers",
      layers: [],
    };
    const layers = paint.layers ?? [];
    const formContents = [];

    // Header with version badge and add-layer button
    formContents.push({
      type: "header",
      label: "COLRv1",
      auxiliaryElement: html.div(
        { style: "display:flex; gap:6px; align-items:center;" },
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

        // Determine label: use referenced glyph name or layer index
        const layerLabel =
          layer.type === "PaintGlyph"
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

        // Paint type selector
        formContents.push({
          type: "edit-text",
          key: JSON.stringify(["v1PaintType", i]),
          label: "Paint type",
          value: layer.type ?? "",
          getValue: () => layers[i]?.type ?? "",
          setValue: async (g, lg, fi, value) => {
            await this._setV1LayerField(glyphName, paint, i, "type", value);
          },
        });

        // If PaintGlyph: show referenced glyph name
        if (layer.type === "PaintGlyph") {
          formContents.push({
            type: "edit-text",
            key: JSON.stringify(["v1GlyphRef", i]),
            label: "Glyph",
            value: layer.glyph ?? "",
            getValue: () => layers[i]?.glyph ?? "",
            setValue: async (g, lg, fi, value) => {
              await this._setV1LayerField(glyphName, paint, i, "glyph", value);
            },
          });
        }

        // Fill paint: paletteIndex + alpha if present
        const fillPaint = layer.paint ?? layer;
        if (fillPaint?.paletteIndex != null) {
          formContents.push({
            type: "edit-number",
            key: JSON.stringify(["v1ColorIndex", i]),
            label: translate("sidebar.selection-info.color-index"),
            value: fillPaint.paletteIndex,
            integer: true,
            minValue: 0,
            maxValue: palette.length - 1,
            getValue: () => {
              const l = layers[i];
              return (l?.paint ?? l)?.paletteIndex ?? 0;
            },
            setValue: async (g, lg, fi, value) => {
              await this._setV1ColorIndex(glyphName, paint, i, value);
            },
          });

          formContents.push({
            type: "edit-number",
            key: JSON.stringify(["v1Alpha", i]),
            label: "Alpha",
            value: fillPaint.alpha ?? 1.0,
            minValue: 0,
            maxValue: 1,
            getValue: () => {
              const l = layers[i];
              return (l?.paint ?? l)?.alpha ?? 1.0;
            },
            setValue: async (g, lg, fi, value) => {
              await this._setV1Alpha(glyphName, paint, i, value);
            },
          });
        }
      }
    }

    this.colorLayersForm.setFieldDescriptions(formContents);
  }

  // ── COLRv0 mutations (original, unchanged) ────────────────────────────────

  _nextLayerName(mapping) {
    const existing = new Set(mapping.map(([n]) => n));
    let i = 0;
    while (existing.has(`color.${i}`)) i++;
    return `color.${i}`;
  }

  async _writeMapping(glyphName, newMapping) {
    await this.sceneController.editGlyphAndRecordChanges((glyph) => {
      if (newMapping.length > 0) {
        // Use the short key — backend pops "colorLayerMapping" and writes it
        // to the top-level .glif lib as "com.github.googlei18n.ufo2ft.colorLayerMapping"
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
        glyph.layers[layerName] = {
          glyph: { path: { contours: [] }, components: [] },
        };
      }
      // Use the short key — same contract as _writeMapping
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

    // Read from CUSTOM_DATA_KEY — matches what the backend and update() use.
    const currentMapping = varGlyphController?.glyph?.customData?.[CUSTOM_DATA_KEY];

    // Guard: if the mapping is absent or the index is stale, bail out silently.
    if (!currentMapping?.length || index >= currentMapping.length) {
      return;
    }

    // Deep-clone each [layerName, colorIndex] pair so we never mutate
    // the live glyph object before the write completes.
    const mapping = currentMapping.map((entry) => [...entry]);
    mapping[index] = [mapping[index][0], value];
    await this._writeMapping(glyphName, mapping);
  }

  // ── COLRv1 mutations ──────────────────────────────────────────────────────

  async _initV1(glyphName) {
    const paint = {
      type: "PaintColrLayers",
      layers: [],
    };
    await this._writeV1Paint(paint);
  }

  async _addV1Layer(glyphName, paint, paletteSize) {
    const layers = paint.layers ?? [];
    const newLayer = {
      type: "PaintGlyph",
      glyph: glyphName,
      paint: {
        type: "PaintSolid",
        paletteIndex: Math.min(layers.length, paletteSize - 1),
        alpha: 1.0,
      },
    };
    await this._writeV1Paint({
      ...paint,
      layers: [...layers, newLayer],
    });
  }

  async _removeV1Layer(glyphName, paint, index) {
    const layers = [...(paint.layers ?? [])];
    layers.splice(index, 1);
    await this._writeV1Paint({ ...paint, layers });
  }

  async _setV1ColorIndex(glyphName, paint, layerIndex, value) {
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;
      const fillPaint = layer.paint
        ? { ...layer.paint, paletteIndex: value }
        : { ...layer, paletteIndex: value };
      return layer.paint ? { ...layer, paint: fillPaint } : fillPaint;
    });
    await this._writeV1Paint({ ...paint, layers });
  }

  async _setV1Alpha(glyphName, paint, layerIndex, value) {
    const layers = (paint.layers ?? []).map((layer, i) => {
      if (i !== layerIndex) return layer;
      const fillPaint = layer.paint
        ? { ...layer.paint, alpha: value }
        : { ...layer, alpha: value };
      return layer.paint ? { ...layer, paint: fillPaint } : fillPaint;
    });
    await this._writeV1Paint({ ...paint, layers });
  }

  async _setV1LayerField(glyphName, paint, layerIndex, field, value) {
    const layers = (paint.layers ?? []).map((layer, i) =>
      i === layerIndex ? { ...layer, [field]: value } : layer
    );
    await this._writeV1Paint({ ...paint, layers });
  }

  // ✅ Fix — writes to StaticGlyph.customData in the default layer
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
      return "Edit COLRv1 paint";
    });
  }

  // ── COLRv0 → COLRv1 converter ─────────────────────────────────────────────

  async _convertV0toV1(glyphName, mapping, palette) {
    // Each V0 [layerName, colorIndex] becomes a PaintGlyph + PaintSolid
    const layers = mapping.map(([layerName, colorIndex]) => ({
      type: "PaintGlyph",
      glyph: layerName,
      paint: {
        type: "PaintSolid",
        paletteIndex: colorIndex,
        alpha: 1.0,
      },
    }));

    const newPaint = { type: "PaintColrLayers", layers };

    await this.sceneController.editGlyphAndRecordChanges((varGlyph) => {
      const defaultSource =
        varGlyph.sources?.find((s) => !s.inactive && !s.locationBase) ??
        varGlyph.sources?.[0];
      const layerGlyph = varGlyph.layers?.[defaultSource?.layerName]?.glyph;
      if (layerGlyph) {
        if (!layerGlyph.customData) layerGlyph.customData = {};
        layerGlyph.customData[COLRV1_KEY] = newPaint;
      }
      delete varGlyph.customData[CUSTOM_DATA_KEY]; // V0 mapping IS on VariableGlyph
      return "Convert COLRv0 → COLRv1";
    });
  }
}

customElements.define("panel-color-layers", ColorLayersPanel);
