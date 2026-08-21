#!/usr/bin/env bash
# runs-in: host — reads and hashes local files. Fetches nothing, executes nothing.
# Run before serving or deploying: a vendored blob that no longer matches its
# pin is the whole failure mode vendoring exists to catch.
set -euo pipefail
cd "$(dirname "$0")/vendor"
sha256sum -c vendor.hash
echo "vendor OK ($(wc -l < vendor.hash) files)"
