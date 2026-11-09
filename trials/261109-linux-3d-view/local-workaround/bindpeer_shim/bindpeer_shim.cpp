// bindpeer_shim.cpp
//
// Local workaround for released Linux builds (up to v3.0.0.554) whose
// cuemol_internal.node does not export "bindPeer". The upstream fix is
// ../../upstream-patches/0001-tritium-core-register-bindPeer-on-linux.patch;
// this shim is only for running an already-released package.
//
// Background: tritium/core/cxx_src/init_cuemol.cpp registers bindPeer inside
// "#if defined(__APPLE__) || defined(_WIN32)", a guard left over from
// 5bd98514 after 49d6298c re-enabled the Electron GUI sources on Linux. The
// implementation is still compiled into the Linux addon and exported as the
// dynamic symbol
//     _ZN9node_jsbr8bindPeerERKN4Napi12CallbackInfoE
// so only the exports.Set(...) line is missing.
//
// This shim is a second N-API addon that links against cuemol_internal.node,
// resolves that symbol and registers it under the name the renderer worker's
// GfxManager calls (this.cuemol.bindPeer(view, gfxManager)).
//
// Why this is ABI-safe:
//
//  * node_jsbr::bindPeer really returns Napi::Value (services.hpp). It is
//    declared void here: the Itanium ABI does not mangle return types of free
//    functions, so the declaration binds to the same symbol, and ignoring a
//    returned 16-byte trivially-copyable struct is safe under SysV AMD64 (the
//    caller just does not read rax/rdx). The JS caller discards it as well.
//
//  * We hand our own Napi::CallbackInfo to code built against node-addon-api
//    8.x. The layout was checked against the shipped binary's disassembly:
//    _staticArgCount at +0x00, _env at +0x08, _argc at +0x20, _argv at +0x28
//    (bindPeer does "cmpq $0x2,0x20(%rbx)" for its argument-count check).
//    Build with the same node-addon-api major version (see build.sh).
//
//  * The shipped addon is built with C++ exceptions (it defines
//    _ZTIN4Napi5ErrorE and imports __cxa_throw), so this is built with
//    NAPI_CPP_EXCEPTIONS and lets Napi::Error propagate the same way.
//
//  * The shim's RUNPATH is $ORIGIN and it sits next to cuemol_internal.node,
//    so ld.so resolves the DT_NEEDED entry to the very object Node already
//    loaded (same inode) and both share one set of globals.

#include <napi.h>

namespace node_jsbr {
// Provided by cuemol_internal.node. See the note above on the return type.
void bindPeer(const Napi::CallbackInfo& info);
}  // namespace node_jsbr

static Napi::Value BindPeerShim(const Napi::CallbackInfo& info) {
  node_jsbr::bindPeer(info);
  return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("bindPeer", Napi::Function::New(env, BindPeerShim, "bindPeer"));
  return exports;
}

NODE_API_MODULE(cuemol_bindpeer_shim, Init)
