export function collectReferencedGlyphs(node, found = new Set()) {
  if (!node || typeof node !== "object") return [...found];

  if (Array.isArray(node)) {
    for (const item of node) collectReferencedGlyphs(item, found);
    return [...found];
  }

  if (typeof node.glyph === "string" && node.glyph.trim()) {
    found.add(node.glyph);
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      collectReferencedGlyphs(value, found);
    }
  }

  return [...found];
}
export function defaultSolidPaint() {
  return { type: "PaintSolid", paletteIndex: 0, alpha: 1.0 };
}

export function defaultTransform() {
  return { xx: 1, yx: 0, xy: 0, yy: 1, dx: 0, dy: 0 };
}

function normalizeLayerToBackendShape(layer) {
  if (!layer || typeof layer !== "object") return layer;

  if (normalizePaintType(layer.type) === "PaintTransform") {
    const nested =
      layer.paint &&
      (layer.paint.type === "PaintGlyph" ||
        layer.paint.type === "PaintColrGlyph" ||
        layer.paint.type === "PaintVarGlyph")
        ? layer.paint
        : {
            type: "PaintGlyph",
            glyph: layer.glyph ?? "",
            paint: layer.paint && layer.paint.type ? layer.paint : defaultSolidPaint(),
          };

    return {
      type: "PaintTransform",
      transform: layer.transform ?? defaultTransform(),
      paint: {
        type: nested.type ?? "PaintGlyph",
        glyph: nested.glyph ?? "",
        paint: nested.paint && nested.paint.type ? nested.paint : defaultSolidPaint(),
      },
    };
  }

  return layer;
}

export function setNestedGlyphOnLayer(layer, glyphName) {
  const normalized = normalizeLayerToBackendShape(layer);
  if (normalizePaintType(normalized?.type) !== "PaintTransform") return layer;

  return {
    ...normalized,
    paint: {
      ...normalized.paint,
      glyph: glyphName,
    },
  };
}
