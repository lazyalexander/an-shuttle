"""Exercise the exported bytes with a real host and a deterministic offline kit."""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import site
import subprocess
import sys
from tempfile import TemporaryDirectory
import tarfile
import tomllib
from xml.etree import ElementTree
from zipfile import ZipFile

from PIL import Image


def call(*args):
    result = subprocess.run(list(map(str,args)), check=True, stdout=subprocess.PIPE, text=True)
    return json.loads(result.stdout) if result.stdout.strip() else None


def approved(*args):
    plan = call(*args)
    return call(*args, "--approve", plan["approval_sha256"])


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def qualify(archive, work):
    call("an-loom", "verify", archive)
    project = work / "project"
    project.mkdir()
    with tarfile.open(archive) as release:
        release.extractall(project, filter="data")
    delivery = work/"delivery"
    call("an-loom", "export-native-spool-v3", archive, delivery)
    contract = tomllib.loads((project/"native-spool.toml").read_text())
    exe = Path(sys.executable).resolve()
    packages = Path(site.getsitepackages()[0]).resolve()
    files = {p.relative_to(packages).as_posix():digest(p) for p in sorted(packages.rglob("*")) if p.is_file()}
    runtime = dict(schema="an-native-python-runtime-v1", executable=str(exe), executable_sha256=digest(exe),
                   stdlib=str(Path(sys.base_prefix).resolve()), site=str(packages),
                   site_sha256=sha256(json.dumps(files,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()).hexdigest(),
                   dependencies=contract["dependencies"])
    (work/"runtime.json").write_text(json.dumps(runtime))
    host, instance = "an-agent-host", work/"instance"
    call(host, "spool-load", delivery, instance, "--runtime", work/"runtime.json")
    # Use the committed handwheel geometry. This managed-host check needs no online model.
    with ZipFile("examples/cad-paint/sample/handwheel.ora") as sample:
        job = json.loads(sample.read("data/scene.json"))
    request = {key:job[key] for key in ("title","focus","width","solids","scene")}
    request.update(schema="cad-paint-request-v1", intent="render-visible-part-layers",
                   source={"application":"web-cad","epoch":"fixture","document":"handwheel","revision":1},
                   parts={part:{"color":color} for part,color in job["ids"].items()})
    (work/"request.json").write_text(json.dumps(request))
    candidate = work/"appearance.py"
    candidate.write_text('def missing_material(part):\n    assert part == "grip"\n'
                         '    return {"finish":"walnut","color":"#4a2c23","metallic":0,"roughness":0.8}\n')
    task = work/"task"
    call("an-loom","task",project,task)
    received = call("an-loom","receive-task",task,"kit/appearance.py",candidate)
    assert received["sha256"]==digest(candidate)
    approved(host,"spool-kit-update",instance,"appearance.py",candidate)
    run = approved(host,"spool-start",instance,"paint",work/"request.json","120")
    assert run["status"]=="succeeded" and run["workspace"]["termination_confirmed"]
    approved(host,"spool-accept",instance,"paint")
    for name in ("painting.ora","beauty.png"):
        binding = call(host,"spool-artifacts",instance,"paint","--output",name)
        revision = binding["output"]["binding"]["revision"]
        call(host,"artifact-checkout",binding["catalog"],revision,work/name)
    with ZipFile(work/"painting.ora") as document:
        scene = json.loads(document.read("data/scene.json"))
        assert scene["kit_sha256"]==received["sha256"] and scene["request_sha256"]==digest(work/"request.json")
        png = Image.open(work/"beauty.png").convert("RGBA")
        merged = Image.new("RGBA",png.size)
        layers = ElementTree.fromstring(document.read("stack.xml")).findall(".//layer")
        assert {layer.get("name") for layer in layers}==set(request["parts"])
        for layer in reversed(layers):
            merged.alpha_composite(Image.open(BytesIO(document.read(layer.get("src")))))
        assert merged.tobytes()==png.tobytes()


if __name__ == "__main__":
    with TemporaryDirectory() as tmp:
        qualify(Path(sys.argv[1]).resolve(strict=True), Path(tmp).resolve())
