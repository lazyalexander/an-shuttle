"""Compatibility entry for callers packaging an already-rendered scene."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "spools/cad-paint/silk"))
from ora import pack

folder = Path(sys.argv[1])
pack(folder, json.loads((folder / "scene.json").read_text()))
