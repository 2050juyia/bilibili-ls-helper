"""Package committed extension files with public installation and license documents.

Reads the committed HEAD, not uncommitted working files. Run from this repository.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
destination = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "dist"
destination.mkdir(parents=True, exist_ok=True)


def git(*args):
    return subprocess.check_output(["git", "-C", str(root), *args])


commit = git("rev-parse", "HEAD").decode().strip()
tracked = set(git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines())
files = sorted(name for name in tracked if name.startswith("extension/"))
if not files:
    raise SystemExit("No committed extension files")

required_documents = {
    "INSTALL.zh-CN.md": "安装说明.md",
    "LICENSE": "LICENSE",
    "THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md",
}
missing = sorted(set(required_documents) - tracked)
if missing:
    raise SystemExit("Commit the public release documents first: " + ", ".join(missing))

manifest = json.loads(git("show", "HEAD:extension/manifest.json"))
version = manifest["version"]
archive = destination / ("bilibili-danmaku-assistant-v" + version + ".zip")
prefix = "bilibili-fixed-danmaku/"
payload = {}
for name in files:
    relative = name.removeprefix("extension/")
    payload[relative] = git("show", "HEAD:" + name)
for source, packaged in required_documents.items():
    payload[packaged] = git("show", "HEAD:" + source)
payload["VERSION.txt"] = ("Version: " + version + "\nGit commit: " + commit + "\n").encode("utf-8")

hashes = {name: hashlib.sha256(content).hexdigest() for name, content in payload.items()}
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
    for name, content in payload.items():
        bundle.writestr(prefix + name, content)

(destination / "安装说明.md").write_bytes(payload["安装说明.md"])
release = {
    "version": version,
    "commit": commit,
    "archive": archive.name,
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "files": hashes,
}
(destination / "release-manifest.json").write_text(
    json.dumps(release, ensure_ascii=False, indent=2), encoding="utf-8")

with zipfile.ZipFile(archive) as bundle:
    if bundle.testzip() is not None:
        raise SystemExit("ZIP integrity check failed")
    names = set(bundle.namelist())
    if names != {prefix + name for name in payload}:
        raise SystemExit("ZIP file allowlist mismatch")
    packaged_manifest = json.loads(bundle.read(prefix + "manifest.json"))
    if packaged_manifest["version"] != version:
        raise SystemExit("Packaged manifest version mismatch")
    for block in packaged_manifest["content_scripts"]:
        for name in block["js"]:
            if prefix + name not in names:
                raise SystemExit("Packaged content script is missing: " + name)
    for name, expected in hashes.items():
        if hashlib.sha256(bundle.read(prefix + name)).hexdigest() != expected:
            raise SystemExit("Packaged file hash mismatch: " + name)

print(json.dumps({"archive": str(archive), "commit": commit,
                  "sha256": release["sha256"], "bytes": archive.stat().st_size},
                 ensure_ascii=False))
