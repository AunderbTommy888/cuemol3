#!/bin/bash
#
# Build a CueMol3 tree whose 3D view works on Linux from a released .deb.
#
# usage: apply.sh --deb <CueMol3-X-Linux-x64.deb> [--prefix DIR] [--force]
#                 [--install-launcher]
#   --prefix            where to put the patched tree (default ~/.local/opt/CueMol3)
#   --force             replace an existing --prefix
#   --install-launcher  copy ./cuemol3 to ~/.local/bin/cuemol3
#   env TAG             release tag of the .deb, for the shader sources
#                       (default v3.0.0.554)
#
# Steps (the original .deb / AppImage is not modified):
#   1. extract the .deb payload (opt/CueMol3) into --prefix
#   2. build cuemol_bindpeer_shim.node next to cuemol_internal.node
#   3. patch @cuemol/core/src/index.cjs to graft the shim's bindPeer on
#   4. generate share/data/shaders from the $TAG sources
# Needs: dpkg-deb, patch, g++, cpp, curl.
#
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DEB=""
PREFIX="$HOME/.local/opt/CueMol3"
FORCE=0
INSTALL_LAUNCHER=0

while [ $# -gt 0 ]; do
  case "$1" in
    --deb) DEB=$2; shift 2 ;;
    --prefix) PREFIX=$2; shift 2 ;;
    --force) FORCE=1; shift ;;
    --install-launcher) INSTALL_LAUNCHER=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -n "$DEB" ] || { echo "error: --deb is required" >&2; exit 2; }
[ -f "$DEB" ] || { echo "error: no such file: $DEB" >&2; exit 1; }

if [ -e "$PREFIX" ]; then
  if [ "$FORCE" -eq 1 ]; then
    rm -rf "$PREFIX"
  else
    echo "error: $PREFIX exists (use --force to replace it)" >&2
    exit 1
  fi
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "[1/4] extracting $DEB"
dpkg-deb -x "$DEB" "$WORK/deb"
[ -d "$WORK/deb/opt/CueMol3" ] || { echo "error: opt/CueMol3 not in the .deb" >&2; exit 1; }
mkdir -p "$(dirname "$PREFIX")"
mv "$WORK/deb/opt/CueMol3" "$PREFIX"

CORE="$PREFIX/resources/app/node_modules/@cuemol/core"

echo "[2/4] building the bindPeer shim"
bash "$HERE/bindpeer_shim/build.sh" "$CORE"

echo "[3/4] patching @cuemol/core/src/index.cjs"
patch -p1 --forward -d "$CORE" < "$HERE/index.cjs.patch"

echo "[4/4] generating shaders (${TAG:-v3.0.0.554})"
bash "$HERE/build_shaders.sh" "$WORK/shader-src" "$PREFIX/resources/cuemol2/share/data/shaders"

if [ "$INSTALL_LAUNCHER" -eq 1 ]; then
  mkdir -p "$HOME/.local/bin"
  install -m 755 "$HERE/cuemol3" "$HOME/.local/bin/cuemol3"
  echo "installed launcher: $HOME/.local/bin/cuemol3"
fi

echo
echo "done: $PREFIX"
if [ "$PREFIX" != "$HOME/.local/opt/CueMol3" ]; then
  echo "start with: CUEMOL3_APPDIR=$PREFIX cuemol3"
else
  echo "start with: cuemol3"
fi
