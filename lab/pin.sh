#!/usr/bin/env bash
# runs-in: host — fetches METADATA ONLY (no model bytes, nothing executed).
# Hugging Face publishes each LFS file's SHA-256 as lfs.oid, so the manifest can
# be pinned without downloading gigabytes. Re-run to re-pin; commit the result.
set -euo pipefail
cd "$(dirname "$0")"
python3 pin.py > registry.json
echo "wrote registry.json ($(grep -c '"sha256"' registry.json) pinned assets)"
