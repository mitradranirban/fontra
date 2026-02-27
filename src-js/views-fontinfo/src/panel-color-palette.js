import { recordChanges } from "@fontra/core/change-recorder.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { BaseInfoPanel } from "./panel-base.js";

const PALETTES_KEY = "com.github.googlei18n.ufo2ft.colorPalettes";

export class ColorPalettesPanel extends BaseInfoPanel {
  static id = "color-palettes-panel";
  static title = "color-palettes.title";
  static fontAttributes = ["customData"];

  async setupUI() {
    const palettes = structuredClone(
      this.fontController.customData?.[PALETTES_KEY] ?? [[[0, 0, 0, 1.0]]]
    );

    this.panelElement.innerHTML = "";

    palettes.forEach((palette, pi) => {
      const swatches = palette.map((color, ci) => {
        const inp = html.input({
          type: "color",
          title: translate("color-palettes.color-index-tooltip", ci),
          value: this.toHex(color[0], color[1], color[2]),
        });
        inp.addEventListener("change", async (e) => {
          await this.onColorChange(pi, ci, e.target.value, palettes);
        });
        return html.label({ class: "swatch-label" }, [
          inp,
          html.span({}, [String(ci)]),
        ]);
      });

      const addColorBtn = html.button({ class: "add-color-btn" }, ["+"]);
      addColorBtn.addEventListener("click", async () => {
        palettes[pi].push([0, 0, 0, 1.0]);
        await this.savePalettes(palettes);
      });

      const section = html.div({ class: "color-palette-section" }, [
        html.div({ class: "palette-label" }, [
          translate("color-palettes.palette-label", pi),
        ]),
        html.div({ class: "color-swatches" }, [...swatches, addColorBtn]),
      ]);

      this.panelElement.appendChild(section);
    });

    const addPaletteBtn = html.button({ class: "add-palette-btn" }, [
      translate("color-palettes.add-palette"),
    ]);
    addPaletteBtn.addEventListener("click", async () => {
      palettes.push([[0, 0, 0, 1.0]]);
      await this.savePalettes(palettes);
    });
    this.panelElement.appendChild(addPaletteBtn);
  }

  async onColorChange(pi, ci, hex, palettes) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    palettes[pi][ci] = [r, g, b, 1.0];
    await this.savePalettes(palettes);
  }

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
    }
    await this.setupUI();
  }

  toHex(r, g, b) {
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
}

customElements.define("panel-color-palettes", ColorPalettesPanel);
