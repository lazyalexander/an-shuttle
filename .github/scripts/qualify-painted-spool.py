"""Check real browser saves against the host catalog and independent pixel reconstruction."""
from hashlib import sha256
import argparse
from io import BytesIO
import json
import os
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


def refused(*args):
    result = subprocess.run(list(map(str, args)), capture_output=True, text=True, timeout=15)
    assert result.returncode != 0, "Expected host refusal"


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
        expected_generated = ["grip"] if request["agent"]["model"] else []
        assert scene["generated"] == expected_generated
        if not expected_generated:
            assert not (attempt / "appearance.py").exists()
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


def verify(work, direct=False):
    project = work / "project"
    for name, parts in [("vise", ["base", "rail", "fixedJaw", "movingJaw"]),
                        ("handwheel", ["stand", "bearing", "wheel", "pin", "grip"])]:
        attempt, = (work / name).glob("drawing-*")
        check_outputs(attempt, parts)
        if name == "handwheel" and (attempt / "appearance.py").exists():
            task = work / "task"
            call("an-loom", "task", project, task)
            candidate = attempt / "appearance.py"
            received = call("an-loom", "receive-task", task, "kit/appearance.py", candidate)
            assert received["sha256"] == digest(candidate) == digest(attempt / "instance/kit/appearance.py")
            protected = attempt / "native-release/silk/render.py"
            before = digest(protected)
            for target in ["render.py", "../silk/render.py"]:
                refused("an-agent-host", "spool-kit-update", attempt / "instance", target, candidate)
            assert digest(protected) == before
    for name, expected in ([] if direct else [("incomplete", "failed"), ("cancelled", "cancelled")]):
        attempt, = (work / name).glob("drawing-*")
        status = call("an-agent-host", "spool-status", attempt / "instance", "paint")
        assert status["termination_confirmed"] and status["execution_status"] == expected
        assert status["artifact_status"] == "not-accepted" and not (attempt / "accepted.json").exists()
        result = json.loads((attempt / "instance/runs/paint/result.json").read_text())
        assert result["workspace"]["reaped"] and result["workspace"]["group_observation"]["empty"]
        assert result["workspace"]["automatic_retries"] == 0
        refused("an-agent-host", "spool-accept", attempt / "instance", "paint")
        print(json.dumps({"drawing": name, **{key: status[key] for key in (
            "phase", "execution_status", "termination_confirmed", "artifact_status")}}), flush=True)


def verify_krita(work, executable):
    root = work / "krita-readback"
    root.mkdir()
    resources = root / "resources"
    resources.mkdir()
    env = {**os.environ, "QT_QPA_PLATFORM": "offscreen"}
    reports = []
    for name, parts in [("vise", ["base", "rail", "fixedJaw", "movingJaw"]),
                        ("handwheel", ["stand", "bearing", "wheel", "pin", "grip"])]:
        attempt, = (work / name).glob("drawing-*")
        output = root / (name + ".kra")
        with (root / (name + ".log")).open("w") as log:
            subprocess.run([str(executable), "--resource-location", str(resources),
                            str(attempt / "painting.ora"), "--export", "--export-filename", str(output)],
                           check=True, timeout=60, env=env, stdout=log, stderr=log)
        with ZipFile(output) as document:
            tree = ElementTree.fromstring(document.read("maindoc.xml"))
            layers = [v for v in tree.iter() if v.tag.split("}")[-1] == "layer"]
            assert len(layers) == len(parts) and {v.get("name") for v in layers} == set(parts)
            assert all(v.get("nodetype") == "paintlayer" and v.get("locked") == "0" for v in layers)
            merged = Image.open(BytesIO(document.read("mergedimage.png"))).convert("RGBA")
            original = Image.open(attempt / "beauty.png").convert("RGBA")
            assert merged.size == original.size and merged.tobytes() == original.tobytes()
        reports.append({"drawing": name, "layers": len(layers), "pixels_equal": True,
                        "accepted_ora_sha256": digest(attempt / "painting.ora"), "kra_sha256": digest(output)})
    (root / "report.json").write_text(json.dumps(reports, indent=2))
    print(json.dumps({"krita_readback": reports}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive_or_stage")
    parser.add_argument("work", type=Path)
    parser.add_argument("--krita", type=Path, help="Also import accepted ORAs into native KRA files and compare layers/pixels")
    parser.add_argument("--direct", action="store_true", help="Verify the two zero-model CAD saves only")
    args = parser.parse_args()
    work = args.work.resolve(strict=True)
    if args.archive_or_stage == "verify":
        verify(work, args.direct)
        if args.krita:
            verify_krita(work, args.krita.resolve(strict=True))
    else:
        prepare(Path(args.archive_or_stage).resolve(strict=True), work)
