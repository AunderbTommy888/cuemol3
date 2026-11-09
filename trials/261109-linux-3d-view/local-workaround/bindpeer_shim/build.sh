#!/bin/bash
#
# Build cuemol_bindpeer_shim.node into an installed @cuemol/core package.
#
# usage: build.sh <path to .../resources/app/node_modules/@cuemol/core> [cache dir]
#
# Needs g++ and curl. Fetches header-only node-addon-api and the Node C
# headers once into the cache dir. N-API is ABI-stable, so the Node header
# version only has to provide the N-API version used here; v24.19.0 is the
# Node bundled with the Electron of CueMol3 3.0.0.554.
#
set -euo pipefail

CORE_DIR=${1:?usage: build.sh <@cuemol/core dir> [cache dir]}
CACHE_DIR=${2:-${XDG_CACHE_HOME:-$HOME/.cache}/cuemol3-bindpeer-shim}

NODE_ADDON_API_VERSION=${NODE_ADDON_API_VERSION:-8.9.2}
NODE_HEADERS_VERSION=${NODE_HEADERS_VERSION:-v24.19.0}

HERE=$(cd "$(dirname "$0")" && pwd)
RELEASE_DIR="$CORE_DIR/build/Release"

if [ ! -f "$RELEASE_DIR/cuemol_internal.node" ]; then
  echo "error: $RELEASE_DIR/cuemol_internal.node not found" >&2
  exit 1
fi

# --- headers (cached) --------------------------------------------------------
NAPI_DIR="$CACHE_DIR/node-addon-api-$NODE_ADDON_API_VERSION"
NODE_INC="$CACHE_DIR/node-$NODE_HEADERS_VERSION/include/node"
mkdir -p "$CACHE_DIR"

if [ ! -f "$NAPI_DIR/napi.h" ]; then
  tmp=$(mktemp -d)
  curl -sSL --fail -o "$tmp/nan.tgz" \
    "https://registry.npmjs.org/node-addon-api/-/node-addon-api-$NODE_ADDON_API_VERSION.tgz"
  tar xzf "$tmp/nan.tgz" -C "$tmp"
  rm -rf "$NAPI_DIR"
  mv "$tmp/package" "$NAPI_DIR"
  rm -rf "$tmp"
fi

if [ ! -f "$NODE_INC/node_api.h" ]; then
  curl -sSL --fail \
    "https://nodejs.org/download/release/$NODE_HEADERS_VERSION/node-$NODE_HEADERS_VERSION-headers.tar.gz" \
    | tar xz -C "$CACHE_DIR"
fi

# --- build -------------------------------------------------------------------
# -l:cuemol_internal.node records DT_NEEDED "cuemol_internal.node" (its
# SONAME); RUNPATH $ORIGIN resolves it to the copy next to the shim.
g++ -shared -fPIC -std=c++17 -O2 \
  -I"$NODE_INC" -I"$NAPI_DIR" \
  -DNAPI_CPP_EXCEPTIONS -DNAPI_VERSION=9 \
  "$HERE/bindpeer_shim.cpp" \
  -L"$RELEASE_DIR" -l:cuemol_internal.node \
  -Wl,-rpath,'$ORIGIN' \
  -o "$RELEASE_DIR/cuemol_bindpeer_shim.node"

echo "built $RELEASE_DIR/cuemol_bindpeer_shim.node"
