"""Rebake OpenSCAD part meshes from the source assembly, at its neutral angle."""
import json
import os
from pathlib import Path
import math
import trimesh
import subprocess
import sys
from tempfile import TemporaryDirectory

def mesh_data(path):
    mesh = trimesh.load_mesh(path, file_type="stl", process=False, allow_remote=False)
    if not isinstance(mesh, trimesh.Trimesh) or not len(mesh.faces):
        raise ValueError("Empty or unsupported part mesh")
    vertices, indices, faces = [], {}, []
    for triangle in mesh.triangles:
        face = []
        for vertex in triangle:
            if not all(math.isfinite(float(n)) for n in vertex):
                raise ValueError("Non-finite part coordinates")
            point = tuple(round(float(n), 5) for n in vertex)
            if point not in indices:
                indices[point] = len(vertices)
                vertices.append(point)
            face.append(indices[point])
        faces.append(face)
    return {"vertices": vertices, "faces": faces}


def main():
    folder = Path(sys.argv[1]).resolve()
    meshes = {}
    with TemporaryDirectory() as tmp:
        for part in json.loads((folder / "model.json").read_text())["parts"]:
            path = Path(tmp) / (part + ".stl")
            subprocess.run([os.environ.get("OPENSCAD_BIN", "openscad"), "--export-format", "binstl", "-D", "part=" + json.dumps(part),
                            "-o", str(path), str(folder / "model.scad")], check=True)
            meshes[part] = mesh_data(path)
    (folder / "meshes.json").write_text(json.dumps(meshes, separators=(",", ":"))+"\n")


if __name__ == "__main__":
    main()
