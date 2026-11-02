"""Pack visible CAD part pixels into independent OpenRaster paint layers."""
from io import BytesIO
import json
from pathlib import Path
import sys
from xml.etree import ElementTree as ET
import zipfile

from PIL import Image, ImageChops

folder = Path(sys.argv[1])
job = json.loads((folder / "scene.json").read_text())
beauty = Image.open(folder / "beauty.png").convert("RGBA")
ids = Image.open(folder / "ids.png").convert("RGB")
if ids.size != beauty.size:
    raise ValueError("Part IDs and beauty pass dimensions differ")


def png(image):
    buf = BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


root = ET.Element("image", version="0.0.3", w=str(beauty.width), h=str(beauty.height), name="Vise study")
stack = ET.SubElement(root, "stack")
merged = Image.new("RGBA", beauty.size)
with zipfile.ZipFile(folder / "painting.tmp", "w") as archive:
    archive.writestr("mimetype", "image/openraster")
    for part, color in job["ids"].items():
        solid = Image.new("RGB", ids.size, color)
        r,g,b = ImageChops.difference(ids, solid).split()
        mask = ImageChops.lighter(ImageChops.lighter(r, g), b).point(lambda v: 0 if v else 255)
        layer = Image.new("RGBA", beauty.size)
        layer.paste(beauty, mask=mask)
        merged.alpha_composite(layer)
        src = "data/" + part + ".png"
        archive.writestr(src, png(layer))
        ET.SubElement(stack, "layer", name=part, src=src, x="0", y="0", opacity="1.0",
                      attrib={"composite-op":"svg:src-over"})
    if merged.tobytes() != beauty.tobytes():
        raise ValueError("Part layers do not reconstruct the rendering")
    archive.writestr("stack.xml", ET.tostring(root, encoding="utf-8"))
    archive.write(folder / "beauty.png", "mergedimage.png")
    thumb = beauty.copy()
    thumb.thumbnail((192,192))
    archive.writestr("Thumbnails/thumbnail.png", png(thumb))
    archive.write(folder / "scene.json", "data/scene.json")
(folder / "painting.tmp").replace(folder / "painting.ora")
