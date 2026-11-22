"""Derive and validate the Firefox Manifest V3 configuration from extension/manifest.json."""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

FIREFOX_ADDON_ID = "bilibili-ls-helper@2050juyia.github.io"
FIREFOX_MIN_VERSION = "140.0"


def build_firefox_manifest(chromium_manifest: dict) -> dict:
    """Return a Firefox/AMO-compliant manifest without Chromium-only keys."""
    result: dict = {}
    inserted_gecko = False
    gecko_settings = {
        "gecko": {
            "id": FIREFOX_ADDON_ID,
            "strict_min_version": FIREFOX_MIN_VERSION,
            "data_collection_permissions": {
                "required": ["none"],
            },
        }
    }
    for key, value in chromium_manifest.items():
        if key == "minimum_chrome_version":
            continue
        result[key] = value
        if key == "description":
            result["browser_specific_settings"] = gecko_settings
            inserted_gecko = True
    if not inserted_gecko:
        result["browser_specific_settings"] = gecko_settings
    validate_firefox_manifest(result)
    return result


def validate_firefox_manifest(manifest: dict) -> None:
    """Verify AMO Manifest V3 requirements and absence of Chromium-only keys."""
    if manifest.get("manifest_version") != 3:
        raise ValueError("Firefox package requires manifest_version 3")
    if "minimum_chrome_version" in manifest:
        raise ValueError("Firefox manifest must not contain minimum_chrome_version")
    gecko = manifest.get("browser_specific_settings", {}).get("gecko", {})
    addon_id = gecko.get("id", "")
    if not re.match(r"^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$", addon_id):
        raise ValueError(f"Invalid Firefox add-on ID: {addon_id!r}")
    min_version = gecko.get("strict_min_version", "")
    major = int(min_version.split(".", 1)[0]) if min_version and min_version.split(".", 1)[0].isdigit() else 0
    if major < 140:
        raise ValueError("data_collection_permissions requires Firefox strict_min_version >= 140.0")
    dcp = gecko.get("data_collection_permissions")
    if dcp != {"required": ["none"]}:
        raise ValueError("Firefox manifest must declare data_collection_permissions.required = ['none']")
    scripts = manifest.get("content_scripts", [])
    if not any(block.get("world") == "MAIN" for block in scripts):
        raise ValueError("Firefox manifest is missing MAIN world content_scripts")
    if not any("world" not in block for block in scripts):
        raise ValueError("Firefox manifest is missing ISOLATED world content_scripts")


def serialize_firefox_manifest(chromium_manifest: dict) -> bytes:
    """Serialize the derived Firefox manifest with stable UTF-8 formatting."""
    derived = build_firefox_manifest(chromium_manifest)
    return (json.dumps(derived, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    source_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "extension" / "manifest.json"
    source_manifest = json.loads(source_path.read_text(encoding="utf-8"))
    sys.stdout.buffer.write(serialize_firefox_manifest(source_manifest))
