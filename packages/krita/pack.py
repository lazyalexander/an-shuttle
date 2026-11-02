"""Compatibility entry for callers packaging an already-rendered scene."""
import json
from pathlib import Path
import sys

# Node resolves optional peer packages for the public adapter. Direct CLI callers
# use the standard npm workspace layout.
ora = (Path(sys.argv[2]) if len(sys.argv) > 2 else
       Path(__file__).resolve().parents[2] / "node_modules/@an-loom/cad-paint-spool/silk/ora.py")
sys.path.insert(0, str(ora.resolve(strict=True).parent))
from ora import pack

folder = Path(sys.argv[1])
pack(folder, json.loads((folder / "scene.json").read_text()))
