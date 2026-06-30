import { withSavedState } from "@fontra/core/utils.ts";
import { mulScalar } from "@fontra/core/var-funcs.js";
import {
  COLRV1_KEY,
  convertFontraPathToPath2D,
  getInterpolatedVariantPaint,
  getInterpolatedVariantPath,
  getLayerPaintGraph,
  getPaintGraph,
  getTagLocation,
  renderCOLRv0FromLayers,
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
let _activePaletteIndex = 0;

export function getActivePaletteIndex() {
  return _activePaletteIndex;
}

export function setActivePaletteIndex(index) {
  _activePaletteIndex = index;
}
const colrPathCache = new Map();
export const colrv1PaintOverlayDefinition = {
  identifier: "fontra.colrv1.paint",
  name: "COLRv1 Paint",

  draw(context, positionedGlyph, parameters, model, controller) {
    const activePaletteIndex = getActivePaletteIndex();
    const instanceCd = positionedGlyph?.glyph?.instance?.customData;
    const varGlyphCd =
      positionedGlyph?.varGlyph?.glyph?.customData ?? // VariableGlyphController.glyph.customData
      positionedGlyph?.varGlyph?.customData ?? // direct customData
      positionedGlyph?.glyph?.varGlyph?.customData ?? // glyph-side nesting
      positionedGlyph?.varGlyph?.instance?.customData; // interpolated instance

    const paint =
      getPaintGraph(instanceCd) ??
      getLayerPaintGraph(positionedGlyph, model.sceneSettings) ??
      getPaintGraph(varGlyphCd);
    if (paint) {
      // COLRv1: existing paint graph path
      const axisValues = getTagLocation(model.fontController, model.sceneSettings);

      const selectedPositionedGlyph = model.getSelectedPositionedGlyph?.();
      const isEditingThisGlyph =
        !!model.selectedGlyph?.isEditing &&
        positionedGlyph === selectedPositionedGlyph;

      if (isEditingThisGlyph) {
        // Edit mode: render the active layer's paint only, using
        // gc.flattenedPath2d for self-references.
        renderCOLRv1(
          context,
          positionedGlyph,
          model.fontController,
          axisValues,
          activePaletteIndex,
          controller,
          colrPathCache,
          model.sceneSettings
        );
      } else {
        // Out of edit mode: stack the active source's layer + its
        // ^variants. Order approximates COLR semantics (first drawn =
        // bottom): ^background variants first.
        const varGlyph =
          positionedGlyph?.varGlyph?.glyph ?? positionedGlyph?.varGlyph;
        const allLayers = varGlyph?.layers ?? {};

        // Resolve a "primary" layer name for the displayed instance, then
        // collect all unique ^suffixes that share that primary family.
        const gc = positionedGlyph?.glyph;
        const varGlyphController = positionedGlyph?.varGlyph;
        let primaryLayerName = gc?.layerName;
        if (!primaryLayerName && gc?.sourceIndex != null) {
          primaryLayerName = varGlyph?.sources?.[gc.sourceIndex]?.layerName;
        }
        if (!primaryLayerName) {
          const defaultSource =
            varGlyph?.sources?.find((s) => !s.inactive && !s.locationBase) ??
            varGlyph?.sources?.find((s) => !s.inactive) ??
            varGlyph?.sources?.[0];
          primaryLayerName = defaultSource?.layerName;
        }
        const primaryRoot = primaryLayerName?.split("^")[0];

        const familyNames = primaryRoot
          ? Object.keys(allLayers).filter(
              (n) => n === primaryRoot || n.startsWith(primaryRoot + "^")
            )
          : Object.keys(allLayers);
        familyNames.sort((a, b) => {
          const aBg = a.includes("^background");
          const bBg = b.includes("^background");
          return aBg === bBg ? 0 : aBg ? -1 : 1;
        });

        const sourceLocation = model.sceneSettings?.fontLocationSourceMapped ?? {};

        let renderedAny = false;
        for (const name of familyNames) {
          const layerGlyph = allLayers[name]?.glyph;
          const layerPaint = getPaintGraph(layerGlyph?.customData);
          if (!layerPaint) continue;
          const rawPath = layerGlyph?.path;
          const hasContent =
            rawPath?.coordinates?.length > 0 || rawPath?.contours?.length > 0;
          if (!hasContent) continue;

          // Interpolate path + paint for this variant across all sources
          // sharing the suffix.
          const suffix = name.slice(primaryRoot.length); // "" for main
          const interpolatedPath = getInterpolatedVariantPath(
            varGlyphController,
            suffix,
            sourceLocation
          );
          const interpolatedPaint = getInterpolatedVariantPaint(
            varGlyphController,
            suffix,
            sourceLocation
          );
          const path2d = convertFontraPathToPath2D(interpolatedPath ?? rawPath);
          if (!path2d) continue;
          renderCOLRv1(
            context,
            positionedGlyph,
            model.fontController,
            axisValues,
            activePaletteIndex,
            controller,
            colrPathCache,
            model.sceneSettings,
            {
              paintOverride: interpolatedPaint ?? layerPaint,
              selfRefPath: path2d,
            }
          );
          renderedAny = true;
        }

        // Fallback to single-paint render (e.g., for glyphs whose paint
        // lives only on the interpolated instance or varGlyph customData).
        if (!renderedAny) {
          renderCOLRv1(
            context,
            positionedGlyph,
            model.fontController,
            axisValues,
            activePaletteIndex,
            controller,
            colrPathCache,
            model.sceneSettings
          );
        }
      }
    } else {
      // COLRv0: draw directly from color.N UFO layers + CPAL palette
      renderCOLRv0FromLayers(
        context,
        positionedGlyph,
        model.fontController,
        activePaletteIndex
      );
    }
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
