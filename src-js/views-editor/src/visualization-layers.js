// src-js/views-editor/src/visualization-layers.js

import { withSavedState } from "@fontra/core/utils.js";
import { mulScalar } from "@fontra/core/var-funcs.js";
import {
  COLRV1_KEY,
  getPaintGraph,
  getTagLocation,
  renderCOLRv1,
} from "./colrv1-canvas-renderer.js";

import { equalGlyphSelection } from "./scene-controller.js";

// ---------------------------------------------------------------------------
// VisualizationLayers
// ---------------------------------------------------------------------------

export class VisualizationLayers {
  constructor(definitions, darkTheme) {
    this.definitions = definitions;
    this._darkTheme = darkTheme;
    this._scaleFactor = 1;
    this._visibleLayerIds = new Set(
      this.definitions
        .filter((layer) => !layer.userSwitchable || layer.defaultOn)
        .map((layer) => layer.identifier)
    );
    this.requestUpdate = () => {
      delete this.layers;
    };
  }

  get darkTheme() {
    return this._darkTheme;
  }

  set darkTheme(darkTheme) {
    this._darkTheme = darkTheme;
    this.requestUpdate();
  }

  get scaleFactor() {
    return this._scaleFactor;
  }

  set scaleFactor(scaleFactor) {
    this._scaleFactor = scaleFactor;
    this.requestUpdate();
  }

  get visibleLayerIds() {
    return this._visibleLayerIds;
  }

  set visibleLayerIds(visibleLayerIds) {
    this._visibleLayerIds = visibleLayerIds;
    this.requestUpdate();
  }

  toggle(layerID, onOff) {
    if (onOff) {
      this._visibleLayerIds.add(layerID);
    } else {
      this._visibleLayerIds.delete(layerID);
    }
    this.requestUpdate();
  }

  buildLayers() {
    const layers = [];
    for (const layerDef of this.definitions) {
      if (!this.visibleLayerIds.has(layerDef.identifier)) {
        continue;
      }
      const parameters = {
        ...mulScalar(layerDef.screenParameters || {}, this.scaleFactor),
        ...(layerDef.glyphParameters || {}),
        ...(layerDef.colors || {}),
        ...(this.darkTheme && layerDef.colorsDarkMode ? layerDef.colorsDarkMode : {}),
      };
      const layer = {
        selectionFunc: layerDef.selectionFunc,
        selectionFilter: layerDef.selectionFilter,
        parameters: parameters,
        draw: layerDef.draw,
      };
      layers.push(layer);
    }
    this.layers = layers;
  }

  drawVisualizationLayers(visContext) {
    if (!this.layers) {
      this.buildLayers();
    }

    const { model, controller } = visContext;
    const context = controller.context;

    for (const layer of this.layers) {
      for (const item of layer.selectionFunc(visContext, layer)) {
        withSavedState(context, () => {
          context.translate(item.x, item.y);
          layer.draw(context, item, layer.parameters, model, controller);
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// VisualizationContext
// ---------------------------------------------------------------------------

export class VisualizationContext {
  constructor(model, controller) {
    this.model = model;
    this.controller = controller;
    this.glyphsBySelectionMode = getGlyphsBySelectionMode(model);
  }
}

// ---------------------------------------------------------------------------
// COLRv1 inline layer definition
//
// ---------------------------------------------------------------------------
export function setColrv1AxisValues(axisValues) {
  /* no-op — now read live in draw() */
}
export const colrv1PaintOverlayDefinition = {
  identifier: "fontra.colrv1.paint",
  name: "COLRv1 Paint",

  draw(context, positionedGlyph, parameters, model, controller) {
    // Resolve paint from all possible data paths
    const instanceCd = positionedGlyph?.glyph?.instance?.customData;
    const varGlyphCd =
      positionedGlyph?.varGlyph?.glyph?.customData ?? // VariableGlyphController.glyph.customData
      positionedGlyph?.varGlyph?.customData ?? // direct customData
      positionedGlyph?.glyph?.varGlyph?.customData ?? // glyph-side nesting
      positionedGlyph?.varGlyph?.instance?.customData; // interpolated instance

    const paint = getPaintGraph(instanceCd) ?? getPaintGraph(varGlyphCd);
    if (!paint) return;

    const axisValues = getTagLocation(model.fontController, model.sceneSettings);
    renderCOLRv1(context, positionedGlyph, model.fontController, axisValues, 0);
  },
};
// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function getGlyphsBySelectionMode(model) {
  const selectedPositionedGlyph = model.getSelectedPositionedGlyph();
  const allPositionedGlyphs = model.positionedLines.flatMap((line) => line.glyphs);
  return {
    all: allPositionedGlyphs,
    unselected: allPositionedGlyphs.filter(
      (glyph) => glyph !== selectedPositionedGlyph
    ),
    hovered:
      model.hoveredGlyph &&
      !equalGlyphSelection(model.hoveredGlyph, model.selectedGlyph)
        ? hoveredGlyphs(model)
        : [],
    selected:
      model.selectedGlyph && !model.selectedGlyph.isEditing
        ? selectedGlyphs(model)
        : [],
    editing: model.selectedGlyph?.isEditing ? selectedGlyphs(model) : [],
    notediting: allPositionedGlyphs.filter(
      (glyph) => glyph !== selectedPositionedGlyph || !model.selectedGlyph?.isEditing
    ),
  };
}

function hoveredGlyphs(model) {
  const glyph = model.getHoveredPositionedGlyph();
  return glyph ? [glyph] : [];
}

function selectedGlyphs(model) {
  const glyph = model.getSelectedPositionedGlyph();
  return glyph ? [glyph] : [];
}
