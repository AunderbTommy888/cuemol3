#!/bin/bash
#
# Generate share/data/shaders for an installed CueMol3 Linux package.
#
# usage: build_shaders.sh <work dir> <dest .../resources/cuemol2/share/data/shaders>
#   env TAG (default v3.0.0.554) -- must match the installed release, because
#   the C++ side and the shader sources change together.
#
# Released Linux packages ship no shaders: they are built in the CLI
# configuration (BUILD_OPENGL_SYSDEP=FALSE) and every GLSL_PREPROC call is
# behind that switch. The upstream fix is
# ../upstream-patches/0002-build-install-glsl-shaders-in-cli-configuration.patch.
#
# This replays src/glsl.cmake by hand: fetch the sources at $TAG and run
#     cpp -P -C -w -undef -ffreestanding [-I<SHADER_INCLUDE_DIRS>] <src>
# into <dest>/<basename>. -undef -ffreestanding stop glibc's cpp from
# prepending the stdc-predef.h licence comment (as in patch 0002).
# The lists below are copied from src/sysdep, src/modules/molvis and
# src/modules/xtal CMakeLists.txt at v3.0.0.554.
#
set -euo pipefail

TAG=${TAG:-v3.0.0.554}
BASE="https://raw.githubusercontent.com/CueMol/cuemol3/$TAG/src"
WORK=${1:?usage: build_shaders.sh <work dir> <dest dir>}
DEST=${2:?usage: build_shaders.sh <work dir> <dest dir>}

OGL=sysdep/ogl_core
MOLVIS=modules/molvis
XTAL=modules/xtal

SYSDEP_SRCS=(trig_vert trig_frag trigedge_vert trigedge_frag pixdraw_vert
  pixdraw_frag linew_vert linew2_vert linew2idx_vert linevalidx_vert linew_frag
  trig_pick_vert trig_pick_frag linew2_pick_vert linew_pick_frag
  linew2idx_pick_vert linevalidx_pick_vert postproc_vert depthvis_frag
  ao_composite_frag gtao_frag ao_denoise_frag fxaa_frag smaa_edges_frag
  smaa_weights_frag smaa_blend_frag jitter_compose_frag hover_mask_frag
  hover_blur_frag hover_hl_frag)
OGL_INCS=(lighting_inc fog_inc matrices_inc linew_inc lib_atoms pick_inc)
MOLVIS_SRCS=(sphere_frag sphere2_vertex sphere2idx_vertex cylinder_vertex
  cylinder_idx_vertex cylinder_frag sphere2idx_pick_vertex sphere_pick_frag
  cylinder_idx_pick_vertex cylinder_pick_frag sphere2_pick_vertex
  cylinder_pick_vertex)
MOLVIS_INCS=(sphere2_body_vert cylinder_body_vert sphere_body_frag
  cylinder_body_frag)
XTAL_SRCS=(mapmesh_vertex mapmesh_frag mapmesh_geom mapmesh2_vert)

fetch() {  # fetch <subdir> <name...>
  local sub=$1; shift
  mkdir -p "$WORK/$sub"
  for n in "$@"; do
    curl -sSL --fail -o "$WORK/$sub/$n.glsl" "$BASE/$sub/$n.glsl"
  done
}

pp() {  # pp <src> <include dir...>
  local src=$1; shift
  local incs=()
  for d in "$@"; do incs+=("-I$d"); done
  cpp -P -C -w -undef -ffreestanding "${incs[@]}" "$src" > "$DEST/$(basename "$src")"
}

fetch "$OGL"    "${SYSDEP_SRCS[@]}" "${OGL_INCS[@]}"
fetch "$MOLVIS" "${MOLVIS_SRCS[@]}" "${MOLVIS_INCS[@]}"
fetch "$XTAL"   "${XTAL_SRCS[@]}"

mkdir -p "$DEST"
# sysdep sets no SHADER_INCLUDE_DIRS: "..." includes resolve next to the source
for n in "${SYSDEP_SRCS[@]}"; do pp "$WORK/$OGL/$n.glsl"; done
# molvis: SHADER_INCLUDE_DIRS = sysdep/ogl_core, molvis
for n in "${MOLVIS_SRCS[@]}"; do pp "$WORK/$MOLVIS/$n.glsl" "$WORK/$OGL" "$WORK/$MOLVIS"; done
# xtal: SHADER_INCLUDE_DIRS = sysdep/ogl_core
for n in "${XTAL_SRCS[@]}"; do pp "$WORK/$XTAL/$n.glsl" "$WORK/$OGL"; done

echo "installed $(ls "$DEST" | wc -l) shaders into $DEST"
