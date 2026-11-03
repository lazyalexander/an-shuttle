"""Check real browser saves against the host catalog and independent pixel reconstruction."""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys
import tarfile
from xml.etree import ElementTree
from zipfile import ZipFile

from PIL import Image


def call(*args):
    return json.loads(subprocess.check_output(list(map(str, args)), text=True))


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def check_outputs(attempt, parts):
    instance = attempt / "instance"
    request = json.loads((attempt / "request.json").read_text())
    saved = json.loads((attempt / "saved.json").read_text())
    assert saved == {k: v for k, v in request.items() if k != "agent"}
    accepted = call("an-agent-host", "spool-artifacts", instance, "paint")
    assert accepted == json.loads((attempt / "accepted.json").read_text())
    assert {v["path"] for v in accepted["outputs"]} == {"beauty.png", "painting.ora"}
    for item in accepted["outputs"]:
        assert item["binding"]["content_sha256"] == digest(attempt / item["path"])
    with ZipFile(attempt / "painting.ora") as document:
        scene = json.loads(document.read("data/scene.json"))
        assert scene["source"] == request["source"] and scene["source"]["revision"] == 1
        assert scene["request_sha256"] == digest(attempt / "request.json")
        assert scene["kit_sha256"] == digest(instance / "kit/appearance.py")
        assert scene["generated"] == (["grip"] if scene["drawing"] == "handwheel" else [])
        png_bytes = (attempt / "beauty.png").read_bytes()
        assert document.read("mergedimage.png") == png_bytes
        png = Image.open(BytesIO(png_bytes)).convert("RGBA")
        merged = Image.new("RGBA", png.size)
        layers = ElementTree.fromstring(document.read("stack.xml")).findall(".//layer")
        assert {layer.get("name") for layer in layers} == set(parts)
        for layer in reversed(layers):
            image = Image.open(BytesIO(document.read(layer.get("src")))).convert("RGBA")
            assert image.getchannel("A").getbbox()
            merged.alpha_composite(image)
        assert merged.tobytes() == png.tobytes()
        print(json.dumps({"drawing": scene["drawing"], "revision": scene["source"]["revision"],
                          "layers": len(layers), "size": png.size, "generated": scene["generated"],
                          "request_sha256": scene["request_sha256"], "kit_sha256": scene["kit_sha256"],
                          "host_release": accepted["release"],
                          "outputs": {item["path"]: item["binding"]["revision"] for item in accepted["outputs"]}}),
              flush=True)


def prepare(archive, work):
    call("an-loom", "verify", archive)
    project = work / "project"
    project.mkdir()
    with tarfile.open(archive) as release:
        release.extractall(project, filter="data")
    runtime = work / "runtime.json"
    subprocess.run([sys.executable, "-B", "examples/cad-paint/prepare-runtime.py",
                    project / "native-spool.toml", runtime], check=True)


def verify(work):
    project = work / "project"
    for name, parts in [("vise", ["base", "rail", "fixedJaw", "movingJaw"]),
                        ("handwheel", ["stand", "bearing", "wheel", "pin", "grip"])]:
        attempt, = (work / name).glob("drawing-*")
        check_outputs(attempt, parts)
        if name == "handwheel":
            task = work / "task"
            call("an-loom", "task", project, task)
            candidate = attempt / "appearance.py"
            received = call("an-loom", "receive-task", task, "kit/appearance.py", candidate)
            assert received["sha256"] == digest(candidate) == digest(attempt / "instance/kit/appearance.py")
    refused, = (work / "incomplete").glob("drawing-*")
    status = call("an-agent-host", "spool-status", refused / "instance", "paint")
    assert status["termination_confirmed"] and status["execution_status"] == "failed"
    assert status["artifact_status"] == "not-accepted" and not (refused / "accepted.json").exists()
    print(json.dumps({key: status[key] for key in ("phase", "execution_status", "termination_confirmed",
                                                    "artifact_status")}), flush=True)


if __name__ == "__main__":
    work = Path(sys.argv[2]).resolve(strict=True)
    if sys.argv[1] == "verify":
        verify(work)
    else:
        prepare(Path(sys.argv[1]).resolve(strict=True), work)
