"""Silk checks are independent of any candidate kit's own assertions."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
os.environ["AN_SPOOL_SILK_DIR"] = str(root / "silk")
os.environ["AN_SPOOL_KIT_DIR"] = str(root / "kit")
sys.path.insert(0, str(root/"silk"))
from main import recipe


class PaintingContract(unittest.TestCase):
    def setUp(self):
        self.request = {
            "schema":"cad-paint-request-v1", "intent":"render-visible-part-layers",
            "source":{"document":"wheel","epoch":"test","revision":7},
            "scene":{"light":0, "camera":{"yaw":20,"elevation":45},
                     "materials":{"wheel":{"finish":"brushed brass","color":"#112233"}}},
            "parts":{"wheel":{"color":"#ff0000"},"grip":{"color":"#00ff00"}},
            "solids":[{"part":"wheel"},{"part":"grip"}], "title":"Wheel", "focus":[0,0,0], "width":100,
        }

    def test_kit_controls_only_missing_finishes(self):
        walnut = {"color":"#503022","finish":"walnut","metallic":0,"roughness":0.8}
        with patch("appearance.missing_material", return_value=walnut) as kit:
            job = recipe(self.request)
        kit.assert_called_once_with("grip")
        self.assertEqual(job["source"], self.request["source"])
        self.assertEqual(job["camera"], self.request["scene"]["camera"])
        self.assertEqual(job["light"], 0)
        self.assertEqual(job["materials"]["wheel"]["color"], "#112233")
        self.assertEqual(job["materials"]["grip"], walnut)

    def test_invalid_kit_result_refuses_before_render(self):
        with patch("appearance.missing_material", return_value={"finish":"x","color":"#123456","metallic":1,"roughness":2}):
            with self.assertRaisesRegex(ValueError,"roughness"):
                recipe(self.request)

    def test_invalid_part_ids_refuse_before_calling_the_kit(self):
        self.request["parts"]["../bad"] = self.request["parts"].pop("grip")
        with patch("appearance.missing_material") as kit, self.assertRaises(ValueError):
            recipe(self.request)
        kit.assert_not_called()
