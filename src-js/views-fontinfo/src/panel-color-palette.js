import { recordChanges } from "@fontra/core/change-recorder.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { BaseInfoPanel } from "./panel-base.js";

export const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(v * 255)
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

/**
 * Walk a COLRv1 paint graph and collect all palette indices referenced.
 * Handles PaintSolid, PaintVarSolid, gradient ColorStops, and recursive
 * child paints (layers, paint, sourcePaint, backdropPaint).
 */
function collectPaletteIndices(paint, indices = new Set()) {
  if (!paint || typeof paint !== "object") return indices;

  if (paint.paletteIndex != null) indices.add(paint.paletteIndex);

  if (paint.colorLine?.colorStops) {
    for (const stop of paint.colorLine.colorStops) {
      if (stop.paletteIndex != null) indices.add(stop.paletteIndex);
    }
  }

  if (Array.isArray(paint.layers)) {
    for (const layer of paint.layers) collectPaletteIndices(layer, indices);
  }
  if (paint.paint) collectPaletteIndices(paint.paint, indices);
  if (paint.sourcePaint) collectPaletteIndices(paint.sourcePaint, indices);
  if (paint.backdropPaint) collectPaletteIndices(paint.backdropPaint, indices);

  return indices;
}

/**
 * Returns a Map of paletteIndex → [glyphName, ...] across all glyphs
 * that carry a colorv1 paint graph.
 */
function buildIndexUsageMap(fontController) {
  const usage = new Map();
  const glyphs = fontController.glyphMap ?? {};
  for (const glyphName of Object.keys(glyphs)) {
    const glyph = fontController.getCachedGlyph?.(glyphName);
    const paint = glyph?.colorv1?.paint;
    if (!paint) continue;
    for (const idx of collectPaletteIndices(paint)) {
      if (!usage.has(idx)) usage.set(idx, []);
      usage.get(idx).push(glyphName);
    }
  }
  return usage;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export class ColorPalettesPanel extends BaseInfoPanel {
  static id = "color-palettes-panel";
  static title = "color-palettes.title";
  static fontAttributes = ["customData"];

  #activePaletteIndex = 0;

  async setupUI() {
    const palettes = structuredClone(
      this.fontController.colorPalettes ??
        this.fontController.customData?.[PALETTES_KEY] ?? [[[0, 0, 0, 1.0]]]
    );

    // Clamp in case palettes were removed
    if (this.#activePaletteIndex >= palettes.length) {
      this.#activePaletteIndex = palettes.length - 1;
    }

    // Snapshot active index into a local constant —
    // avoids any closure/shadowing bugs in callbacks below
    const activePi = this.#activePaletteIndex;
    const activePalette = palettes[activePi];
    const usageMap = buildIndexUsageMap(this.fontController);

    this.panelElement.innerHTML = "";

    // ── Tab strip (only shown when more than one palette exists) ──────────
    if (palettes.length > 1) {
      const tabStrip = html.div(
        { class: "palette-tab-strip" },
        palettes.map((_, tabPi) => {
          const tab = html.button(
            {
              class: `palette-tab${tabPi === activePi ? " active" : ""}`,
            },
            [translate("color-palettes.palette-label", tabPi)]
          );
          tab.addEventListener("click", () => {
            this.#activePaletteIndex = tabPi;
            this.setupUI();
          });
          return tab;
        })
      );
      this.panelElement.appendChild(tabStrip);
    }

    // ── Section header ────────────────────────────────────────────────────
    const paletteHeader = html.div({ class: "palette-section-header" }, [
      html.span({ class: "palette-label" }, [
        translate("color-palettes.palette-label", activePi),
      ]),
      html.span({ class: "palette-entry-count" }, [
        `${activePalette.length} ${activePalette.length === 1 ? "entry" : "entries"}`,
      ]),
    ]);

    // ── Swatches ──────────────────────────────────────────────────────────
    const swatches = activePalette.map((color, ci) =>
      this.#makeSwatch(color, ci, activePi, palettes, usageMap)
    );

    const addColorBtn = html.button({ class: "add-color-btn" }, [
      translate("color-palettes.add-color") || "+ Color",
    ]);
    addColorBtn.addEventListener("click", async () => {
      palettes[activePi].push([0, 0, 0, 1.0]);
      await this.savePalettes(palettes);
    });

    const swatchGrid = html.div({ class: "color-swatches" }, [
      ...swatches,
      addColorBtn,
    ]);

    this.panelElement.appendChild(
      html.div({ class: "color-palette-section" }, [paletteHeader, swatchGrid])
    );

    // ── Palette management buttons ────────────────────────────────────────
    const paletteActions = html.div({ class: "palette-actions" }, []);

    const addPaletteBtn = html.button({ class: "add-palette-btn" }, [
      translate("color-palettes.add-palette"),
    ]);
    addPaletteBtn.addEventListener("click", async () => {
      palettes.push(structuredClone(activePalette));
      this.#activePaletteIndex = palettes.length - 1;
      await this.savePalettes(palettes);
    });
    paletteActions.appendChild(addPaletteBtn);

    if (palettes.length > 1) {
      const removePaletteBtn = html.button(
        { class: "remove-palette-btn", title: "Remove this palette" },
        [translate("color-palettes.remove-palette") || "− Remove Palette"]
      );
      removePaletteBtn.addEventListener("click", async () => {
        palettes.splice(activePi, 1);
        this.#activePaletteIndex = Math.max(0, activePi - 1);
        await this.savePalettes(palettes);
      });
      paletteActions.appendChild(removePaletteBtn);
    }

    this.panelElement.appendChild(paletteActions);
  }

  // ── Swatch builder ────────────────────────────────────────────────────────

  #makeSwatch(color, ci, activePi, palettes, usageMap) {
    const [r, g, b, a = 1.0] = color;

    // Color picker
    const colorInput = html.input({
      type: "color",
      title: translate("color-palettes.color-index-tooltip", ci),
      value: toHex(r, g, b),
    });
    colorInput.addEventListener("change", async (e) => {
      const [nr, ng, nb] = hexToRgb(e.target.value);
      palettes[activePi][ci] = [nr, ng, nb, palettes[activePi][ci][3] ?? 1.0];
      await this.savePalettes(palettes);
    });

    // Alpha slider
    const alphaLabel = html.span({ class: "alpha-value" }, [`${Math.round(a * 100)}%`]);
    const alphaSlider = html.input({
      type: "range",
      min: "0",
      max: "1",
      step: "0.01",
      value: String(a),
      class: "alpha-slider",
      title: `Alpha: ${Math.round(a * 100)}%`,
    });
    alphaSlider.addEventListener("input", async (e) => {
      const newAlpha = parseFloat(e.target.value);
      alphaLabel.textContent = `${Math.round(newAlpha * 100)}%`;
      palettes[activePi][ci][3] = newAlpha;
      alphaSlider.style.setProperty(
        "--swatch-color",
        `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`
      );
      await this.savePalettes(palettes);
    });

    // Usage badge
    const usedGlyphs = usageMap.get(ci) ?? [];
    const usageBadge = html.span(
      {
        class: `usage-badge${usedGlyphs.length === 0 ? " unused" : ""}`,
        title:
          usedGlyphs.length > 0
            ? `Used in: ${usedGlyphs.join(", ")}`
            : "Not used in any COLRv1 glyph",
      },
      [usedGlyphs.length > 0 ? `${usedGlyphs.length}g` : "—"]
    );

    // Remove entry button (guard: always keep at least one entry)
    const removeBtn = html.button(
      { class: "remove-color-btn", title: "Remove color entry" },
      ["×"]
    );
    removeBtn.addEventListener("click", async () => {
      if (palettes[activePi].length <= 1) return;
      palettes[activePi].splice(ci, 1);
      await this.savePalettes(palettes);
    });

    return html.div({ class: "swatch-entry" }, [
      html.div({ class: "swatch-index" }, [String(ci)]),
      colorInput,
      html.div({ class: "swatch-alpha" }, [alphaSlider, alphaLabel]),
      usageBadge,
      removeBtn,
    ]);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  async savePalettes(palettes) {
    const root = { customData: { ...this.fontController.customData } };
    const changes = recordChanges(root, (root) => {
      root.customData[PALETTES_KEY] = palettes;
    });
    if (changes.hasChange) {
      await this.postChange(
        changes.change,
        changes.rollbackChange,
        translate("color-palettes.edit-description")
      );
      this.fontController.customData[PALETTES_KEY] = palettes;
      await this.setupUI();
    }
  }
}

customElements.define("panel-color-palettes", ColorPalettesPanel);
