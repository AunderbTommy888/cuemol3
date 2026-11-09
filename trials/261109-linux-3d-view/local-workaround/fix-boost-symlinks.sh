#!/bin/bash
#
# OPTIONAL. Make the unpatched AppImage find Boost 1.84 without LD_LIBRARY_PATH,
# by symlinking the nine libboost_*.so.1.84.0 that CueMol3 needs into
# /lib/x86_64-linux-gnu. Not needed when starting the app via the cuemol3
# launcher, which sets LD_LIBRARY_PATH instead. Prefer the launcher: these
# links are system-wide and point into a user-owned directory.
#
# usage: sudo fix-boost-symlinks.sh <dir with libboost_*.so.1.84.0>
#        sudo fix-boost-symlinks.sh --remove
#   e.g. <dir> = ~/.local/opt/CueMol3/resources/app/node_modules/@cuemol/core/build/lib
#
# Refuses to touch a regular file (it may belong to a package); only creates,
# replaces or removes symlinks. Typical wrong state this repairs: links named
# *.so.1.84.0 pointing at the system's ABI-incompatible 1.74 libraries, which
# give "undefined symbol: ...path_algorithms21find_parent_path_size...".
#
set -euo pipefail

LIB_DIR=/lib/x86_64-linux-gnu
LIBS=(
  libboost_atomic.so.1.84.0
  libboost_chrono.so.1.84.0
  libboost_date_time.so.1.84.0
  libboost_filesystem.so.1.84.0
  libboost_iostreams.so.1.84.0
  libboost_program_options.so.1.84.0
  libboost_system.so.1.84.0
  libboost_thread.so.1.84.0
  libboost_timer.so.1.84.0
)

if [ "$(id -u)" -ne 0 ]; then
  echo "error: must run as root (sudo $0 ...)" >&2
  exit 1
fi

ARG=${1:?usage: fix-boost-symlinks.sh <boost dir> | --remove}

# never clobber a real distribution library
for lib in "${LIBS[@]}"; do
  dest="$LIB_DIR/$lib"
  if [ -e "$dest" ] && [ ! -L "$dest" ]; then
    echo "error: $dest is a regular file, not a symlink; refusing. No changes made." >&2
    exit 1
  fi
done

if [ "$ARG" = "--remove" ]; then
  for lib in "${LIBS[@]}"; do
    if [ -L "$LIB_DIR/$lib" ]; then rm -f "$LIB_DIR/$lib"; echo "removed $LIB_DIR/$lib"; fi
  done
  ldconfig
  exit 0
fi

SRC_DIR=$(cd "$ARG" && pwd)
for lib in "${LIBS[@]}"; do
  if [ ! -f "$SRC_DIR/$lib" ]; then
    echo "error: missing $SRC_DIR/$lib" >&2
    exit 1
  fi
done

for lib in "${LIBS[@]}"; do
  ln -sfn "$SRC_DIR/$lib" "$LIB_DIR/$lib"
  echo "$LIB_DIR/$lib -> $SRC_DIR/$lib"
done
ldconfig

# Verify. Capture nm's output first: "nm | grep -q" under pipefail reports
# failure when grep exits early and nm dies of SIGPIPE.
syms=$(nm -D --defined-only "$LIB_DIR/libboost_filesystem.so.1.84.0")
if grep -q find_parent_path_size <<<"$syms"; then
  echo "OK: libboost_filesystem.so.1.84.0 exports find_parent_path_size"
else
  echo "FAILED: find_parent_path_size still missing" >&2
  exit 1
fi
