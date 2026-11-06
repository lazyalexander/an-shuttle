"""Krita live shuttle: protocol and update rules, independent of Krita.

The working document has two top-level groups. ``agent 渲染`` belongs to the agent:
its layers stay locked and are replaced by each accepted painting. ``手绘`` belongs
to the user and is never written. If the user unlocked and painted on a render
layer, that layer is copied into the hand group before it is replaced.
"""
import hashlib
import json
import os
import posixpath
import zipfile
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass

PROTOCOL = "an-shuttle-krita-live-v1"
RENDER_GROUP = "agent 渲染"
HAND_GROUP = "手绘"
MAX_REQUEST = 64 * 1024
MAX_LAYER_BYTES = 64 * 1024 * 1024
MAX_SIDE = 16384


class Refusal(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Layer:
    name: str
    x: int
    y: int
    png: bytes


@dataclass(frozen=True)
class Painting:
    width: int
    height: int
    layers: tuple  # top to bottom, as in stack.xml


def digest(data):
    return hashlib.sha256(bytes(data)).hexdigest()


def read_ora(path):
    """Read a flat OpenRaster stack: one image, paint layers only."""
    try:
        archive = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as error:
        raise Refusal("bad-ora", "cannot read OpenRaster product: %s" % error)
    with archive:
        if archive.read("mimetype") != b"image/openraster":
            raise Refusal("bad-ora", "not an OpenRaster file")
        root = ElementTree.fromstring(archive.read("stack.xml"))
        width, height = int(root.get("w", "0")), int(root.get("h", "0"))
        if root.tag != "image" or not (0 < width <= MAX_SIDE and 0 < height <= MAX_SIDE):
            raise Refusal("bad-ora", "invalid OpenRaster image size")
        stack = list(root)
        if len(stack) != 1 or stack[0].tag != "stack":
            raise Refusal("bad-ora", "expected one flat stack")
        layers, names = [], set()
        for element in stack[0]:
            name, source = element.get("name", ""), element.get("src", "")
            if element.tag != "layer" or not name or name in names or len(name) > 120:
                raise Refusal("bad-ora", "unsupported or duplicate layer: %r" % name)
            normal = posixpath.normpath(source)
            if not normal.startswith("data/") or normal != source or not source.endswith(".png"):
                raise Refusal("bad-ora", "layer source outside data/: %r" % source)
            if archive.getinfo(source).file_size > MAX_LAYER_BYTES:
                raise Refusal("bad-ora", "layer too large: %r" % name)
            names.add(name)
            layers.append(Layer(name, int(element.get("x", "0")), int(element.get("y", "0")), archive.read(source)))
        if not layers:
            raise Refusal("bad-ora", "no layers")
        return Painting(width, height, tuple(layers))


def sidecar(document):
    return document + ".an-shuttle.json"


def read_state(document):
    try:
        with open(sidecar(document), encoding="utf-8") as handle:
            state = json.load(handle)
    except FileNotFoundError:
        return None
    if state.get("protocol") != PROTOCOL or not isinstance(state.get("revision"), int) \
            or not isinstance(state.get("layers"), dict):
        raise Refusal("bad-state", "unreadable shuttle state beside the document")
    return state


def write_state(document, revision, layers):
    path, temporary = sidecar(document), sidecar(document) + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump({"protocol": PROTOCOL, "revision": revision, "layers": layers}, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def parse(line):
    if len(line) > MAX_REQUEST:
        raise Refusal("bad-request", "request too large")
    try:
        request = json.loads(line)
    except ValueError:
        raise Refusal("bad-request", "malformed JSON")
    if not isinstance(request, dict) or request.get("protocol") != PROTOCOL:
        raise Refusal("bad-request", "unsupported protocol")
    method, document, revision = request.get("method"), request.get("document"), request.get("revision")
    if method not in ("pending", "apply"):
        raise Refusal("bad-request", "unknown method")
    if not isinstance(document, str) or not os.path.isabs(document) or not document.endswith(".kra"):
        raise Refusal("bad-request", "document must be an absolute .kra path")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise Refusal("bad-request", "revision must be a positive integer")
    if method == "apply" and (not isinstance(request.get("ora"), str) or not os.path.isabs(request["ora"])):
        raise Refusal("bad-request", "ora must be an absolute path")
    return request


def handle(line, krita):
    """Answer one request line. ``krita`` is the document adapter (see krita_doc.py)."""
    try:
        request = parse(line)
        if request["method"] == "pending":
            krita.message(request["document"], "正在更新到第 %d 版 · 手绘层可以继续画" % request["revision"])
            return {"protocol": PROTOCOL, "ok": True}
        return dict(apply(request["document"], request["revision"], request["ora"], krita),
                    protocol=PROTOCOL, ok=True)
    except Refusal as refusal:
        return {"protocol": PROTOCOL, "ok": False, "code": refusal.code, "message": str(refusal)}
    except Exception as error:  # the adapter talks to a live application
        return {"protocol": PROTOCOL, "ok": False, "code": "krita-error", "message": str(error)[:300]}


def apply(document, revision, ora, krita):
    painting = read_ora(ora)
    state = read_state(document)
    if state is not None and revision <= state["revision"]:
        raise Refusal("stale-revision", "document is already at revision %d" % state["revision"])
    created = False
    doc = krita.find(document)
    if doc is None:
        if os.path.exists(document):
            doc = krita.open(document)
        else:
            if state is not None:
                raise Refusal("bad-state", "shuttle state exists but the document is missing")
            doc = krita.create(document, painting.width, painting.height)
            created = True
    if krita.size(doc) != (painting.width, painting.height):
        raise Refusal("size-mismatch", "document size differs from the painting")
    known = state["layers"] if state else {}
    with krita.locked(doc):
        current = krita.render_layers(doc)  # name -> pixel digest
        preserved = []
        incoming = {layer.name for layer in painting.layers}
        for name, pixels in current.items():
            # A layer the agent never wrote, or one changed since, belongs to the user now.
            if known.get(name) != pixels:
                krita.preserve(doc, name, "%s · 修订 %d 前的手动修改" % (name, revision))
                preserved.append(name)
            if name not in incoming:
                krita.remove(doc, name)
        layers = krita.replace(doc, painting)
        krita.save(doc)
    write_state(document, revision, layers)
    krita.message(document, "已更新到第 %d 版" % revision)
    return {"document": document, "revision": revision, "layers": layers,
            "preserved": preserved, "created": created}
