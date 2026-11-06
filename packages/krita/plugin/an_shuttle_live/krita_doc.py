"""Adapter from the shuttle rules in core.py to Krita's Python API."""
import contextlib
import os

from krita import Krita

try:
    from PyQt5.QtCore import QByteArray
    from PyQt5.QtGui import QIcon, QImage, QPainter
except ImportError:  # Krita 6
    from PyQt6.QtCore import QByteArray
    from PyQt6.QtGui import QIcon, QImage, QPainter

from .core import HAND_GROUP, RENDER_GROUP, Refusal, digest

ARGB32 = getattr(QImage, "Format_ARGB32", None) or QImage.Format.Format_ARGB32
SOURCE = getattr(QPainter, "CompositionMode_Source", None) or QPainter.CompositionMode.CompositionMode_Source


def _same(path, document):
    return bool(path) and os.path.realpath(path) == os.path.realpath(document)


def _child(parent, name):
    for node in parent.childNodes():
        if node.name() == name:
            return node
    return None


def _group(doc, name):
    group = _child(doc.rootNode(), name)
    if group is None or group.type() != "grouplayer":
        raise Refusal("render-group-missing", "the working document has no %r group" % name)
    return group


class KritaDocuments:
    def __init__(self):
        self.app = Krita.instance()

    def find(self, document):
        for doc in self.app.documents():
            if _same(doc.fileName(), document):
                return doc
        return None

    def _show(self, doc):
        window = self.app.activeWindow()
        if window is not None:
            window.addView(doc)

    def open(self, document):
        doc = self.app.openDocument(document)
        if doc is None:
            raise Refusal("open-failed", "Krita could not open the working document")
        self._show(doc)
        return doc

    def create(self, document, width, height):
        os.makedirs(os.path.dirname(document), exist_ok=True)
        doc = self.app.createDocument(width, height, os.path.basename(document), "RGBA", "U8", "", 300.0)
        root = doc.rootNode()
        for node in list(root.childNodes()):
            node.remove()
        render = doc.createGroupLayer(RENDER_GROUP)
        hand = doc.createGroupLayer(HAND_GROUP)
        root.addChildNode(render, None)
        root.addChildNode(hand, render)  # hand-painting sits above the render
        hand.addChildNode(doc.createNode("手绘 1", "paintlayer"), None)
        render.setLocked(True)
        doc.setFileName(document)
        doc.setBatchmode(True)
        try:
            if not doc.saveAs(document):
                raise Refusal("save-failed", "Krita could not create the working document")
        finally:
            doc.setBatchmode(False)
        self._show(doc)
        return doc

    def size(self, doc):
        return doc.width(), doc.height()

    @contextlib.contextmanager
    def locked(self, doc):
        """The brief lock: the window takes no input while layers are replaced and saved."""
        window = self.app.activeWindow()
        widget = window.qwindow() if window is not None else None
        if widget is not None:
            widget.setEnabled(False)
        try:
            yield
        finally:
            if widget is not None:
                widget.setEnabled(True)

    def render_layers(self, doc):
        width, height = self.size(doc)
        return {node.name(): digest(node.pixelData(0, 0, width, height))
                for node in _group(doc, RENDER_GROUP).childNodes()}

    def preserve(self, doc, name, label):
        node = _child(_group(doc, RENDER_GROUP), name)
        copy = node.duplicate()
        copy.setName(label)
        copy.setLocked(False)
        _group(doc, HAND_GROUP).addChildNode(copy, None)

    def remove(self, doc, name):
        _child(_group(doc, RENDER_GROUP), name).remove()

    def replace(self, doc, painting):
        width, height = painting.width, painting.height
        render = _group(doc, RENDER_GROUP)
        below = None
        result = {}
        for layer in reversed(painting.layers):  # bottom first, so each new node goes above the last
            image = QImage.fromData(layer.png)
            if image.isNull():
                raise Refusal("bad-ora", "cannot decode layer %r" % layer.name)
            canvas = QImage(width, height, ARGB32)
            canvas.fill(0)
            painter = QPainter(canvas)
            painter.setCompositionMode(SOURCE)
            painter.drawImage(layer.x, layer.y, image.convertToFormat(ARGB32))
            painter.end()
            bits = canvas.constBits()
            bits.setsize(canvas.sizeInBytes())
            node = _child(render, layer.name)
            if node is None:
                node = doc.createNode(layer.name, "paintlayer")
                render.addChildNode(node, below)
            node.setLocked(False)
            # ARGB32 is B, G, R, A in memory, the same order as Krita's RGBA U8.
            node.setPixelData(QByteArray(bytes(bits)), 0, 0, width, height)
            node.setLocked(True)
            below = node
        doc.waitForDone()
        doc.refreshProjection()
        for layer in painting.layers:
            result[layer.name] = digest(_child(render, layer.name).pixelData(0, 0, width, height))
        render.setLocked(True)
        return result

    def save(self, doc):
        doc.setBatchmode(True)
        try:
            if not doc.save():
                raise Refusal("save-failed", "Krita could not save the working document")
        finally:
            doc.setBatchmode(False)

    def message(self, document, text):
        for window in self.app.windows():
            for view in window.views():
                if view.document() is not None and _same(view.document().fileName(), document):
                    view.showFloatingMessage(text, QIcon(), 4000, 1)
