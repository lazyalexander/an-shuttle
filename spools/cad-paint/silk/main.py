"""Consume a single frozen CAD request and produce visible-part paint layers."""
from hashlib import sha256
import json
from math import isfinite
import os
from pathlib import Path
import re
from secrets import randbelow
import sys

# The native host provides flattened read-only snapshots. In the studio these
# two directories are the trusted silk and the selected per-attempt kit copy.
sys.path[:0] = [os.environ["AN_SPOOL_SILK_DIR"], os.environ["AN_SPOOL_KIT_DIR"]]
import appearance
from ora import pack
from render import render


def surface(candidate):
    if not isinstance(candidate, dict):
        raise ValueError("Missing material")
    finish, color = candidate["finish"], candidate["color"]
    if not isinstance(finish, str) or not 0 < len(finish.strip()) <= 80 or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("Invalid material finish or color")
    for key in ("metallic", "roughness"):
        value = candidate[key]
        if type(value) not in (float, int) or not isfinite(value) or not 0 <= value <= 1:
            raise ValueError("Invalid material " + key)
    return {key:candidate[key] for key in ("finish", "color", "metallic", "roughness")}


def recipe(request):
    if request["schema"] != "cad-paint-request-v1" or request["intent"] != "render-visible-part-layers":
        raise ValueError("Unknown CAD request")
    source, scene = request["source"], request["scene"]
    ids = {part:spec["color"] for part,spec in request["parts"].items()}
    if (not ids or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", part) for part in ids)
        or any(not re.fullmatch(r"#[0-9A-Fa-f]{6}", c) or c.lower()=="#000000" for c in ids.values())
        or len({c.lower() for c in ids.values()}) != len(ids)
        or {s["part"] for s in request["solids"]} != set(ids)):
        raise ValueError("Invalid CAD part inventory")
    supplied = scene["materials"]
    materials, generated = {}, []
    for part in ids:
        if part in supplied:
            spec = supplied[part]
            metal = re.search("steel|brass|metal", spec["finish"], re.I)
            materials[part] = surface({**spec, "metallic":.88 if metal else .18, "roughness":.28 if metal else .43})
        else:
            materials[part] = surface(appearance.missing_material(part))
            generated.append(part)
    return dict(revision=source["revision"], source=source, scene=scene, drawing=source["document"],
                title=request["title"], focus=request["focus"], width=request["width"], solids=request["solids"],
                light=scene["light"] if "light" in scene else randbelow(360)-180,
                camera=scene.get("camera", {"yaw":38,"elevation":28}), materials=materials, ids=ids,
                generated=generated, model=request.get("agent", {}).get("model"))


if __name__ == "__main__":
    raw = Path(os.environ["AN_SPOOL_INPUT"]).read_bytes()
    job = recipe(json.loads(raw))
    job["request_sha256"] = sha256(raw).hexdigest()
    job["kit_sha256"] = sha256(Path(appearance.__file__).read_bytes()).hexdigest()
    folder = Path.cwd()
    (folder/"scene.json").write_text(json.dumps(job, indent=2))
    render(folder, job)
    pack(folder, job)
