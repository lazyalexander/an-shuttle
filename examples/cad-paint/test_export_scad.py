"""The external codec must preserve geometry and refuse invalid imports."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import numpy as np
import trimesh

spec = importlib.util.spec_from_file_location("export_scad", Path(__file__).with_name("export-scad.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportContract(unittest.TestCase):
    def test_binary_and_ascii_preserve_triangle_coordinates_and_winding(self):
        vertices = [[0, 0, 0], [1, 0, 0], [0, 0.125, 0], [0, 0, 2]]
        faces = [[0, 1, 2], [0, 3, 1]]
        source = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
        with tempfile.TemporaryDirectory() as directory:
            for format in ["stl", "stl_ascii"]:
                path = Path(directory) / "part.stl"
                source.export(path, file_type=format)
                result = module.mesh_data(path)
                actual = np.array(result["vertices"])[result["faces"]]
                np.testing.assert_array_equal(actual, np.array(vertices)[faces])
                self.assertEqual(len(result["vertices"]), 4)

    def test_empty_and_malformed_imports_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.stl"
            for data in [b"", b"not an STL", b"\0" * 83]:
                path.write_bytes(data)
                with self.assertRaises(ValueError):
                    module.mesh_data(path)


if __name__ == "__main__":
    unittest.main()
