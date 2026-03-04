import paintcompiler
from fontTools.ttLib import TTFont

from fontra.backends.fontra import loadFontraProject  # Native fontra-compile equiv

from ..core.colrv1builder import build_all_glyph_paints
from .base import FilterActionProtocol


class BuildColrV1Filter(FilterActionProtocol):
    def __init__(self, **kwargs):
        self.output = kwargs.get("output", "colrv1.ttf")

    async def connect(self, backend):
        context = getattr(backend, "context", {})

        # Native: Load .fontra project (no subprocess)
        project_path = context.get("project_path")  # From fontra-read
        project = await loadFontraProject(project_path)
        context["project"] = project

        # Compile base outlines (fontra-compile internal)
        temp_ttf = f"temp-{self.output}"
        font = TTFont()
        # ... build outlines via project.glyphs (fontra-compile logic)
        font.save(temp_ttf)

        # Add COLRv1 (your colrv1builder)
        glyphs = build_all_glyph_paints(project.glyphs, project.font_info.colorPalettes)
        paintcompiler.compile(font, glyphs, palettes=project.font_info.colorPalettes)
        font.save(self.output)

        context["font_path"] = self.output
        return backend
