#!/usr/bin/env bash
# runs-in: host — downloads to files and hashes them. Executes nothing.
#
# Populates lab/vendor/ from the pins in vendor.hash. The blobs are not committed
# because GitHub secret-scanning rejects the push: transformers.web.min.js embeds
# the URL https://gist.github.com/hollance/42e32852f24243b748ae6bc1f985b13a in a
# Whisper warning string, and that 32-hex gist id matches Mistral's API-key
# pattern. It is a false positive, present verbatim in the upstream npm tarball
# and in every build variant, minified or not.
#
# The security property is unchanged: vendor.hash is committed, so these bytes
# are pinned exactly as if they were in the repo, and verify-vendor.sh fails
# loudly if what you fetched does not match.
set -euo pipefail
cd "$(dirname "$0")/vendor"
ORT=1.27.0 ; TFJS=4.2.0
base_ort="https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT}/dist"
base_tf="https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TFJS}/dist"
curl -fsSL -o transformers.web.min.js          "$base_tf/transformers.web.min.js"
curl -fsSL -o ort-wasm-simd-threaded.jsep.mjs  "$base_tf/ort-wasm-simd-threaded.jsep.mjs"
curl -fsSL -o ort.wasm.min.mjs                 "$base_ort/ort.wasm.min.mjs"
curl -fsSL -o ort-wasm-simd-threaded.mjs       "$base_ort/ort-wasm-simd-threaded.mjs"
sha256sum -c vendor.hash
echo "vendor populated and verified"
