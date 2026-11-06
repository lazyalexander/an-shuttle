"""Build the zip that Krita's Tools → Scripts → Import Python Plugin from File accepts.

Krita's importer needs an explicit ``an_shuttle_live/`` directory entry beside
``__init__.py``; without it the import reports that no plugins were found.
Usage: python3 -B packages/krita/plugin/pack.py OUTPUT.zip
"""
import os
import sys
import zipfile

here = os.path.dirname(os.path.abspath(__file__))
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as archive:
    archive.write(os.path.join(here, "an_shuttle_live.desktop"), "an_shuttle_live.desktop")
    archive.writestr(zipfile.ZipInfo("an_shuttle_live/"), "")
    for name in sorted(os.listdir(os.path.join(here, "an_shuttle_live"))):
        if name.endswith(".py"):
            archive.write(os.path.join(here, "an_shuttle_live", name), "an_shuttle_live/" + name)
