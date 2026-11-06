"""Shuttle rules without Krita: python3 -B -m unittest packages/krita/plugin/test_core.py"""
import contextlib
import json
import os
import shutil
import tempfile
import unittest

import importlib.util

# Load core.py alone: the package __init__ registers with a running Krita.
_spec = importlib.util.spec_from_file_location(
    "an_shuttle_live_core", os.path.join(os.path.dirname(os.path.abspath(__file__)), "an_shuttle_live", "core.py"))
core = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(core)

SAMPLE = os.path.join(os.path.dirname(__file__), "../../../examples/cad-paint/sample/vise.ora")


class FakeKrita:
    """Documents as {path: {"size": (w, h), "render": {name: pixels}, "hand": [names]}}."""

    def __init__(self):
        self.docs, self.log, self.locked_during = {}, [], []
        self.depth = 0

    def find(self, document):
        return self.docs.get(document) and document

    def open(self, document):
        raise AssertionError("fake documents are always open")

    def create(self, document, width, height):
        self.docs[document] = {"size": (width, height), "render": {}, "hand": ["手绘 1"]}
        open(document, "wb").close()
        return document

    def size(self, doc):
        return self.docs[doc]["size"]

    @contextlib.contextmanager
    def locked(self, doc):
        self.depth += 1
        try:
            yield
        finally:
            self.depth -= 1

    def render_layers(self, doc):
        return {name: core.digest(pixels) for name, pixels in self.docs[doc]["render"].items()}

    def preserve(self, doc, name, label):
        self.docs[doc]["hand"].append(label)

    def remove(self, doc, name):
        del self.docs[doc]["render"][name]

    def replace(self, doc, painting):
        self.locked_during.append(self.depth == 1)
        for layer in painting.layers:
            self.docs[doc]["render"][layer.name] = layer.png
        return {layer.name: core.digest(layer.png) for layer in painting.layers}

    def save(self, doc):
        self.log.append(("save", self.depth == 1))

    def message(self, document, text):
        self.log.append(("message", text))


def request(method, document, revision, ora=None):
    body = {"protocol": core.PROTOCOL, "method": method, "document": document, "revision": revision}
    if ora:
        body["ora"] = ora
    return json.dumps(body)


class ShuttleRules(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.folder)
        self.document = os.path.join(self.folder, "vise", "working.kra")
        os.makedirs(os.path.dirname(self.document))
        self.krita = FakeKrita()
        self.ora = os.path.abspath(SAMPLE)

    def apply(self, revision):
        return core.handle(request("apply", self.document, revision, self.ora), self.krita)

    def test_reads_the_sample_flat_stack(self):
        painting = core.read_ora(self.ora)
        self.assertEqual((painting.width, painting.height), (960, 680))
        self.assertEqual([layer.name for layer in painting.layers], ["base", "rail", "fixedJaw", "movingJaw"])

    def test_first_update_creates_and_later_updates_replace_in_place(self):
        first = self.apply(1)
        self.assertTrue(first["ok"], first)
        self.assertTrue(first["created"])
        self.assertEqual(first["preserved"], [])
        self.assertEqual(sorted(first["layers"]), ["base", "fixedJaw", "movingJaw", "rail"])
        second = self.apply(2)
        self.assertTrue(second["ok"], second)
        self.assertFalse(second["created"])
        self.assertEqual(second["preserved"], [])
        self.assertEqual(self.krita.docs[self.document]["hand"], ["手绘 1"])
        self.assertEqual(self.krita.locked_during, [True, True])
        self.assertIn(("save", True), self.krita.log)
        self.assertEqual(core.read_state(self.document)["revision"], 2)

    def test_old_or_repeated_revisions_are_refused(self):
        self.assertTrue(self.apply(3)["ok"])
        for revision in (3, 2):
            reply = self.apply(revision)
            self.assertFalse(reply["ok"])
            self.assertEqual(reply["code"], "stale-revision")

    def test_user_paint_on_a_render_layer_moves_into_the_hand_group(self):
        self.assertTrue(self.apply(1)["ok"])
        self.krita.docs[self.document]["render"]["movingJaw"] = b"user brush strokes"
        reply = self.apply(2)
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(reply["preserved"], ["movingJaw"])
        self.assertEqual(self.krita.docs[self.document]["hand"], ["手绘 1", "movingJaw · 修订 2 前的手动修改"])

    def test_pending_only_shows_a_message(self):
        reply = core.handle(request("pending", self.document, 4), self.krita)
        self.assertTrue(reply["ok"])
        self.assertEqual(self.krita.log, [("message", "正在更新到第 4 版 · 手绘层可以继续画")])
        self.assertNotIn(self.document, self.krita.docs)

    def test_malformed_requests_are_refused(self):
        for line in ("nope", json.dumps({"protocol": "other"}),
                     request("apply", "relative.kra", 1, self.ora),
                     request("apply", self.document, 0, self.ora),
                     request("apply", self.document, True, self.ora),
                     request("delete", self.document, 1)):
            reply = core.handle(line, self.krita)
            self.assertFalse(reply["ok"], line)
            self.assertEqual(reply["code"], "bad-request")

    def test_a_missing_document_with_state_is_not_silently_recreated(self):
        self.assertTrue(self.apply(1)["ok"])
        del self.krita.docs[self.document]
        os.remove(self.document)
        reply = self.apply(2)
        self.assertEqual(reply["code"], "bad-state")


if __name__ == "__main__":
    unittest.main()
