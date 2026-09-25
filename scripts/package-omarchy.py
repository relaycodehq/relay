#!/usr/bin/env python3
"""Wrap electron-builder's Linux directory in a user-installable Omarchy bundle."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import tempfile

root = Path(__file__).resolve().parent.parent
release = root / "release"
source = release / "linux-unpacked"
with (source / "relay-experimental").open("rb") as executable:
    header = executable.read(20)
if header[:6] != b"\x7fELF\x02\x01" or header[18:20] != b"\x3e\x00":
    raise SystemExit("Build the Linux x86_64 app before packaging for Omarchy.")
if not (source / "resources/app.asar").is_file():
    raise SystemExit("The packaged app.asar is missing.")

version = json.loads((root / "package.json").read_text())["version"]
name = "Relay-Omarchy-x86_64"
archive = release / f"Relay-{version}-omarchy-x86_64.tar.gz"
with tempfile.TemporaryDirectory(prefix=".omarchy-", dir=release) as temporary:
    bundle = Path(temporary) / name
    bundle.mkdir()
    shutil.copytree(source, bundle / "app", symlinks=True)
    shutil.copyfile(root / "assets/icon.svg", bundle / "app/relay-experimental.svg")
    (bundle / "app/VERSION").write_text(version + "\n")
    for filename in ("install.py", "README.txt"):
        shutil.copyfile(root / "packaging/omarchy" / filename, bundle / filename)
    for filename in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copyfile(root / filename, bundle / filename)

    def clean_metadata(info):
        info.uid = info.gid = 0
        info.uname = info.gname = "root"
        info.pax_headers = {}
        if info.name.endswith("/chrome-sandbox"):
            info.mode = 0o755  # User install uses user namespaces, never setuid.
        return info

    with tarfile.open(archive, "w:gz", compresslevel=6) as output:
        output.add(bundle, arcname=name, filter=clean_metadata)
digest = hashlib.sha256()
with archive.open("rb") as output:
    for chunk in iter(lambda: output.read(1024 * 1024), b""):
        digest.update(chunk)
(release / f"{archive.name}.sha256").write_text(f"{digest.hexdigest()}  {archive.name}\n")
print(f"Built {archive} ({archive.stat().st_size / 1024**2:.1f} MiB)")
