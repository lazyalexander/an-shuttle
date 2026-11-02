"""Bind an explicitly selected Python environment for the native paint host."""
import argparse
from hashlib import file_digest, sha256
import json
from pathlib import Path
import site
import sys
import tomllib


def digest(path):
    with path.open("rb") as stream:
        return file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="installed native-spool.toml")
    parser.add_argument("output", type=Path, help="new operator runtime JSON file")
    args = parser.parse_args()
    executable = Path(sys.executable).resolve(strict=True)
    packages = Path(site.getsitepackages()[0]).resolve(strict=True)
    files = {p.relative_to(packages).as_posix(): digest(p) for p in packages.rglob("*") if p.is_file()}
    runtime = {
        "schema": "an-native-python-runtime-v1",
        "executable": str(executable), "executable_sha256": digest(executable),
        "stdlib": str(Path(sys.base_prefix).resolve(strict=True)), "site": str(packages),
        "site_sha256": sha256(json.dumps(files, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest(),
        "dependencies": tomllib.loads(args.manifest.read_text())["dependencies"],
    }
    with args.output.open("x") as target:
        json.dump(runtime, target)


if __name__ == "__main__":
    main()
