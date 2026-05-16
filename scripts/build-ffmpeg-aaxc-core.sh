#!/usr/bin/env bash
set -euo pipefail

# Build a minimal ffmpeg.wasm core for AAX/AAXC -> M4B stream-copy conversion.
#
# Produces a Module-compatible drop-in for @ffmpeg/ffmpeg 0.12.x:
#   build/out/esm/ffmpeg-core.js
#   build/out/esm/ffmpeg-core.wasm
#
# Layout expected on disk:
#   build/emsdk           emscripten SDK (3.1.40)
#   build/ffmpeg          FFmpeg n5.1.4 source
#   build/src/bind/ffmpeg bind.js + export.js + export-runtime.js
#   build/src/fftools     ffmpeg.c + helpers
#
# Validate against:
#   /home/joe/Downloads/A Christmas Carol [B08QSLYDNS].aax
#   /home/joe/Downloads/A Christmas Carol [B08QSLYDNS].libation-fixture.json

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT/build"
FFMPEG_DIR="$BUILD_DIR/ffmpeg"
BIND_DIR="$BUILD_DIR/src/bind/ffmpeg"
FFTOOLS_DIR="$BUILD_DIR/src/fftools"
OUT_DIR="$BUILD_DIR/out/esm"

if [[ ! -x "$BUILD_DIR/emsdk/upstream/emscripten/emcc" ]]; then
  echo "emsdk not found at $BUILD_DIR/emsdk" >&2
  exit 1
fi

# shellcheck disable=SC1091
source "$BUILD_DIR/emsdk/emsdk_env.sh"

mkdir -p "$OUT_DIR"
cd "$FFMPEG_DIR"

CFLAGS_COMMON="-Oz -flto"

# FFmpeg static-library build.
# --disable-everything removes every component; we then re-enable only what
# stream-copying AAX/AAXC -> M4B needs:
#   file protocol            (read/write inside MEMFS)
#   mov demuxer              (parses AAX/AAXC, handles audible_key/iv)
#   ipod + mp4 muxers        (write M4B; ipod auto-pulls mov_muxer +
#                             aac_adtstoasc_bsf via configure selects)
#   aac parser               (carry AAC packets through the muxer)
if [[ ! -f config.h ]] || [[ "${RECONFIGURE:-0}" = 1 ]]; then
  emconfigure ./configure \
    --cc=emcc \
    --cxx=em++ \
    --ar=emar \
    --ranlib=emranlib \
    --nm=emnm \
    --objcc=emcc \
    --dep-cc=emcc \
    --target-os=none \
    --arch=x86_32 \
    --enable-cross-compile \
    --disable-everything \
    --disable-asm \
    --disable-stripping \
    --disable-programs \
    --disable-doc \
    --disable-debug \
    --disable-autodetect \
    --disable-runtime-cpudetect \
    --disable-network \
    --disable-pthreads \
    --disable-w32threads \
    --disable-os2threads \
    --disable-bzlib \
    --disable-iconv \
    --disable-lzma \
    --disable-sdl2 \
    --disable-securetransport \
    --disable-xlib \
    --disable-zlib \
    --disable-avdevice \
    --disable-postproc \
    --disable-swscale \
    --enable-protocol=file \
    --enable-demuxer=mov \
    --enable-muxer=mp4 \
    --enable-muxer=ipod \
    --enable-parser=aac \
    --enable-small \
    --extra-cflags="$CFLAGS_COMMON" \
    --extra-cxxflags="$CFLAGS_COMMON"
fi

emmake make -j"$(nproc)"

# fftools/ffmpeg.c needs config-mapped symbols. They live in src/fftools
# Makefile in upstream ffmpeg.wasm, but ffmpeg.c only requires a small set
# of symbols from ffbuild's config_components.h / config.h that the FFmpeg
# build already produced. The link step pulls the rest from libav*.

EXPORTED_FUNCTIONS='["_ffmpeg","_abort","_malloc","_ffprobe"]'
EXPORTED_RUNTIME_METHODS='["FS","setValue","getValue","UTF8ToString","lengthBytesUTF8","stringToUTF8"]'

emcc \
  -Oz -flto \
  -I . \
  -I "$FFTOOLS_DIR" \
  -L libavcodec -L libavformat -L libavfilter -L libavutil -L libswresample \
  -Wno-deprecated-declarations \
  -sENVIRONMENT=worker \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createFFmpegCore \
  -sFORCE_FILESYSTEM=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=32MB \
  -sSTACK_SIZE=2MB \
  -sWASM_BIGINT \
  -sEXPORTED_FUNCTIONS="$EXPORTED_FUNCTIONS" \
  -sEXPORTED_RUNTIME_METHODS="$EXPORTED_RUNTIME_METHODS" \
  -lworkerfs.js \
  --pre-js "$BIND_DIR/bind.js" \
  "$FFTOOLS_DIR/cmdutils.c" \
  "$FFTOOLS_DIR/ffmpeg.c" \
  "$FFTOOLS_DIR/ffmpeg_filter.c" \
  "$FFTOOLS_DIR/ffmpeg_hw.c" \
  "$FFTOOLS_DIR/ffmpeg_mux.c" \
  "$FFTOOLS_DIR/ffmpeg_opt.c" \
  "$FFTOOLS_DIR/opt_common.c" \
  "$FFTOOLS_DIR/ffprobe.c" \
  -lavformat -lavcodec -lavfilter -lavutil -lswresample \
  -o "$OUT_DIR/ffmpeg-core.js"

ls -lh "$OUT_DIR"
echo
echo "Build complete:"
echo "  $OUT_DIR/ffmpeg-core.js"
echo "  $OUT_DIR/ffmpeg-core.wasm"
