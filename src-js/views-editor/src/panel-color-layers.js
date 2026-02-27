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

  async update() {
    await this.fontController.ensureInitialized;

    const customData = this.fontController.customData ?? {};
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

    const varGlyphController =
      await this.sceneController.sceneModel.getSelectedVariableGlyphController();

    // Backend promotes "com.github.googlei18n.ufo2ft.colorLayerMapping" from
    // the top-level .glif lib into customData[CUSTOM_DATA_KEY] on read.
    const mapping = varGlyphController?.glyph?.customData?.[CUSTOM_DATA_KEY] ?? [];

    const formContents = [];

    // Main header with plain text "+" button
    formContents.push({
      type: "header",
      label: translate("color-layers.title"),
      auxiliaryElement: html.div(
        {
          style: "cursor: pointer; font-size: 1.2em; line-height: 1; padding: 0 0.3em;",
          onclick: () => this._addLayer(glyphName, palette.length, mapping),
          title: translate("color-layers.add-layer"),
        },
        ["+"]
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

        // Per-layer sub-header with plain text "−" button
        formContents.push({
          type: "header",
          label: layerName,
          auxiliaryElement: html.div(
            {
              style:
                "cursor: pointer; font-size: 1.2em; line-height: 1; padding: 0 0.3em;",
              onclick: () => this._removeLayer(glyphName, i, mapping),
              title: translate("color-layers.remove-layer"),
            },
            ["\u2212"]
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

    this.colorLayersForm.setFieldDescriptions(formContents);
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

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
    // This prevents _writeMapping being called with an empty/broken array,
    // which would delete the entire mapping from the glyph.
    if (!currentMapping?.length || index >= currentMapping.length) {
      return;
    }

    // Deep-clone each [layerName, colorIndex] pair so we never mutate
    // the live glyph object before the write completes.
    const mapping = currentMapping.map((entry) => [...entry]);
    mapping[index] = [mapping[index][0], value];
    await this._writeMapping(glyphName, mapping);
  }
}

customElements.define("panel-color-layers", ColorLayersPanel);
