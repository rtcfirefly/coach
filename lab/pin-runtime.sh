#!/usr/bin/env bash
# runs-in: container — extracts a downloaded tarball, so it must not run on the host.
#
# Pins onnxruntime-web's browser-loaded files. The CDN is unreachable from some
# environments, so the trust path goes through npm instead: npm publishes a
# sha512 integrity for the tarball, we verify that, then hash the individual
# files the browser will actually fetch.
#
#   npm integrity (sha512)  ->  extract in container  ->  per-file sha256  ->  registry
#
# Run:  podman run --rm -v "$PWD:/out" -w /out docker.io/library/alpine:3 sh pin-runtime.sh
set -euo pipefail
VER="${1:-1.27.0}"
PKG="onnxruntime-web"
command -v curl >/dev/null || apk add --no-cache curl jq coreutils >/dev/null

META=$(curl -fsSL "https://registry.npmjs.org/$PKG/$VER")
TARBALL=$(echo "$META" | jq -r .dist.tarball)
INTEGRITY=$(echo "$META" | jq -r .dist.integrity)

curl -fsSL -o pkg.tgz "$TARBALL"
GOT="sha512-$(sha512sum pkg.tgz | cut -d' ' -f1 | xxd -r -p | base64 -w0)"
[ "$GOT" = "$INTEGRITY" ] || { echo "TARBALL INTEGRITY MISMATCH"; echo " want $INTEGRITY"; echo " got  $GOT"; exit 1; }
echo "tarball integrity ok: $INTEGRITY"

# Reject members that are not regular files/dirs, or that escape the root.
tar -tzf pkg.tgz | grep -E '(^/|\.\.)' && { echo "unsafe archive member"; exit 1; } || true
mkdir -p x && tar -xzf pkg.tgz -C x --no-same-owner

for f in package/dist/ort.wasm.min.mjs package/dist/ort-wasm-simd-threaded.wasm; do
  [ -f "x/$f" ] || { echo "MISSING $f — dist layout changed, update this script"; continue; }
  printf '%s  %s  %s bytes\n' "$(sha256sum "x/$f" | cut -d' ' -f1)" "${f#package/dist/}" "$(stat -c %s "x/$f")"
done
rm -rf x pkg.tgz
