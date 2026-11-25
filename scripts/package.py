"""Package committed extension files into Chromium and Firefox/AMO archives.

Default mode reads committed HEAD (not uncommitted working files) and builds:
  - dist/bilibili-danmaku-assistant-v<version>.zip          (Chromium folder layout)
  - dist/bilibili-danmaku-assistant-v<version>-firefox.zip  (Firefox/AMO root layout)

Development mode (`--firefox-unpacked <dir>`) builds an unpacked Firefox folder
and matching `<dir>.zip` from the current working tree for local testing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

from firefox_manifest import serialize_firefox_manifest, validate_firefox_manifest

root = Path(__file__).resolve().parents[1]


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(root), *args])


def verify_zip(archive: Path, expected_hashes: dict[str, str], prefix: str, expect_firefox: bool) -> None:
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise SystemExit(f"ZIP integrity check failed: {archive.name}")
        names = set(bundle.namelist())
        expected_names = {prefix + name for name in expected_hashes}
        if names != expected_names:
            raise SystemExit(f"ZIP file allowlist mismatch in {archive.name}")
        packaged_manifest = json.loads(bundle.read(prefix + "manifest.json"))
        if expect_firefox:
            if prefix != "":
                raise SystemExit("Firefox ZIP must place manifest.json at archive root")
            validate_firefox_manifest(packaged_manifest)
        else:
            if "browser_specific_settings" in packaged_manifest:
                raise SystemExit("Chromium manifest must not contain browser_specific_settings")
            if "minimum_chrome_version" not in packaged_manifest:
                raise SystemExit("Chromium manifest is missing minimum_chrome_version")
        for block in packaged_manifest["content_scripts"]:
            for script_name in block["js"]:
                if prefix + script_name not in names:
                    raise SystemExit(f"Packaged content script is missing in {archive.name}: {script_name}")
        for icon_path in packaged_manifest.get("icons", {}).values():
            if prefix + icon_path not in names:
                raise SystemExit(f"Packaged icon is missing in {archive.name}: {icon_path}")
        for name, expected in expected_hashes.items():
            actual = hashlib.sha256(bundle.read(prefix + name)).hexdigest()
            if actual != expected:
                raise SystemExit(f"Packaged file hash mismatch in {archive.name}: {name}")


def build_firefox_working_tree(target_dir: Path) -> dict:
    ext_dir = root / "extension"
    source_manifest = json.loads((ext_dir / "manifest.json").read_text(encoding="utf-8"))
    firefox_manifest_bytes = serialize_firefox_manifest(source_manifest)
    payload: dict[str, bytes] = {}
    for file_path in sorted(p for p in ext_dir.rglob("*") if p.is_file()):
        rel = file_path.relative_to(ext_dir).as_posix()
        payload[rel] = firefox_manifest_bytes if rel == "manifest.json" else file_path.read_bytes()
    for doc_name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        doc_path = root / doc_name
        if doc_path.is_file():
            payload[doc_name] = doc_path.read_bytes()

    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    for rel, content in payload.items():
        out_file = target_dir / rel
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_bytes(content)

    zip_path = target_dir.with_suffix(".zip")
    hashes = {name: hashlib.sha256(content).hexdigest() for name, content in payload.items()}
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as bundle:
        for name, content in payload.items():
            bundle.writestr(name, content)
    verify_zip(zip_path, hashes, prefix="", expect_firefox=True)
    return {
        "mode": "firefox-unpacked",
        "version": source_manifest["version"],
        "directory": str(target_dir),
        "archive": str(zip_path),
        "sha256": hashlib.sha256(zip_path.read_bytes()).hexdigest(),
    }


def build_committed_release(destination: Path, from_working_tree: bool = False) -> dict:
    destination.mkdir(parents=True, exist_ok=True)
    commit = git("rev-parse", "HEAD").decode().strip()
    required_documents = {
        "INSTALL.zh-CN.md": "安装说明.md",
        "LICENSE": "LICENSE",
        "THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md",
    }

    chromium_payload: dict[str, bytes] = {}
    if from_working_tree:
        ext_dir = root / "extension"
        ext_files = sorted(p for p in ext_dir.rglob("*") if p.is_file())
        if not ext_files:
            raise SystemExit("No working-tree extension files")
        missing = sorted(src for src in required_documents if not (root / src).is_file())
        if missing:
            raise SystemExit("Missing public release documents in working tree: " + ", ".join(missing))
        manifest = json.loads((ext_dir / "manifest.json").read_text(encoding="utf-8"))
        dirty = bool(git("status", "--porcelain", "--", "extension", *required_documents.keys()).strip())
        commit_ref = f"{commit}-working-tree" if dirty else commit
        files = ["extension/" + p.relative_to(ext_dir).as_posix() for p in ext_files]
        for p in ext_files:
            relative = p.relative_to(ext_dir).as_posix()
            chromium_payload[relative] = p.read_bytes()
        for source, packaged in required_documents.items():
            chromium_payload[packaged] = (root / source).read_bytes()
    else:
        tracked = set(git("ls-tree", "-r", "--name-only", "HEAD").decode().splitlines())
        files = sorted(name for name in tracked if name.startswith("extension/"))
        if not files:
            raise SystemExit("No committed extension files")
        missing = sorted(set(required_documents) - tracked)
        if missing:
            raise SystemExit("Commit the public release documents first: " + ", ".join(missing))
        manifest = json.loads(git("show", "HEAD:extension/manifest.json"))
        commit_ref = commit
        for name in files:
            relative = name.removeprefix("extension/")
            chromium_payload[relative] = git("show", "HEAD:" + name)
        for source, packaged in required_documents.items():
            chromium_payload[packaged] = git("show", "HEAD:" + source)

    version = manifest["version"]
    version_banner = ("Version: " + version + "\nGit commit: " + commit_ref + "\n").encode("utf-8")

    # 1. Chromium / Edge / Chrome archive (preserves bilibili-fixed-danmaku/ prefix)
    chromium_archive = destination / f"bilibili-danmaku-assistant-v{version}.zip"
    chromium_prefix = "bilibili-fixed-danmaku/"
    chromium_payload["VERSION.txt"] = version_banner
    chromium_hashes = {name: hashlib.sha256(content).hexdigest() for name, content in chromium_payload.items()}

    with zipfile.ZipFile(chromium_archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for name, content in chromium_payload.items():
            bundle.writestr(chromium_prefix + name, content)
    verify_zip(chromium_archive, chromium_hashes, prefix=chromium_prefix, expect_firefox=False)

    # 2. Firefox / AMO archive (manifest.json directly at archive root, zero warnings)
    firefox_archive = destination / f"bilibili-danmaku-assistant-v{version}-firefox.zip"
    firefox_manifest_bytes = serialize_firefox_manifest(manifest)
    firefox_payload: dict[str, bytes] = {}
    for name in files:
        relative = name.removeprefix("extension/")
        firefox_payload[relative] = (
            firefox_manifest_bytes if relative == "manifest.json" else chromium_payload[relative]
        )
    firefox_payload["LICENSE"] = chromium_payload["LICENSE"]
    firefox_payload["THIRD_PARTY_NOTICES.md"] = chromium_payload["THIRD_PARTY_NOTICES.md"]
    firefox_hashes = {name: hashlib.sha256(content).hexdigest() for name, content in firefox_payload.items()}

    with zipfile.ZipFile(firefox_archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for name, content in firefox_payload.items():
            bundle.writestr(name, content)
    verify_zip(firefox_archive, firefox_hashes, prefix="", expect_firefox=True)

    (destination / "安装说明.md").write_bytes(chromium_payload["安装说明.md"])
    chromium_sha256 = hashlib.sha256(chromium_archive.read_bytes()).hexdigest()
    firefox_sha256 = hashlib.sha256(firefox_archive.read_bytes()).hexdigest()
    checksums = (
        f"{chromium_sha256}  {chromium_archive.name}\n"
        f"{firefox_sha256}  {firefox_archive.name}\n"
    )
    (destination / "SHA256SUMS.txt").write_text(checksums, encoding="utf-8")

    release = {
        "version": version,
        "commit": commit_ref,
        "archive": chromium_archive.name,
        "sha256": chromium_sha256,
        "files": chromium_hashes,
        "firefox": {
            "archive": firefox_archive.name,
            "sha256": firefox_sha256,
            "addonId": json.loads(firefox_manifest_bytes)["browser_specific_settings"]["gecko"]["id"],
            "strictMinVersion": json.loads(firefox_manifest_bytes)["browser_specific_settings"]["gecko"]["strict_min_version"],
            "files": firefox_hashes,
        },
    }
    (destination / "release-manifest.json").write_text(
        json.dumps(release, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    return {
        "archive": str(chromium_archive),
        "sha256": chromium_sha256,
        "bytes": chromium_archive.stat().st_size,
        "firefoxArchive": str(firefox_archive),
        "firefoxSha256": firefox_sha256,
        "firefoxBytes": firefox_archive.stat().st_size,
        "commit": commit_ref,
    }


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", nargs="?", type=Path, default=root / "dist")
    parser.add_argument(
        "--firefox-unpacked",
        type=Path,
        help="Write a working-tree unpacked Firefox build and .zip to the given path",
    )
    parser.add_argument(
        "--working-tree",
        action="store_true",
        help="Build release archives into destination from the current working tree instead of committed HEAD",
    )
    args = parser.parse_args(argv)
    if args.firefox_unpacked:
        target = args.firefox_unpacked if args.firefox_unpacked.is_absolute() else root / args.firefox_unpacked
        result = build_firefox_working_tree(target)
    else:
        dest = args.destination if args.destination.is_absolute() else root / args.destination
        result = build_committed_release(dest, from_working_tree=args.working_tree)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
