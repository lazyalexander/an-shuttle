"""Rebake OpenSCAD part meshes from the source assembly, at its neutral angle."""
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory

folder = Path(sys.argv[1]).resolve()
meshes = {}
with TemporaryDirectory() as tmp:
    for part in json.loads((folder / "model.json").read_text())["parts"]:
        path = Path(tmp) / (part + ".stl")
        subprocess.run([os.environ.get("OPENSCAD_BIN", "openscad"), "--export-format", "binstl", "-D", "part=" + json.dumps(part),
                        "-o", str(path), str(folder / "model.scad")], check=True)
        data = path.read_bytes()
        count, = struct.unpack_from("<I", data, 80)
        if len(data) != 84 + 50 * count:
            raise ValueError("Invalid binary STL")
        vertices, indices, faces = [], {}, []
        for facet in struct.iter_unpack("<12fH", data[84:]):
            face = []
            for offset in (3, 6, 9):
                point = tuple(round(n, 5) for n in facet[offset:offset+3])
                if point not in indices:
                    indices[point] = len(vertices)
                    vertices.append(point)
                face.append(indices[point])
            faces.append(face)
        if not vertices or not faces:
            raise ValueError("Empty part: " + part)
        meshes[part] = {"vertices":vertices,"faces":faces}
(folder / "meshes.json").write_text(json.dumps(meshes,separators=(",",":"))+"\n")
