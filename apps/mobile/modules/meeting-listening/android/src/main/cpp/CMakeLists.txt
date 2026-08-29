cmake_minimum_required(VERSION 3.22)

project(wemux_meeting_runtime LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Keep the exact upstream revisions in the build graph. Both projects are
# Apache/MIT licensed and are compiled into the app's private JNI library.
include(FetchContent)

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_APP OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_UI OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(LLAMA_SUBPROCESS OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_VULKAN OFF CACHE BOOL "" FORCE)
set(GGML_CPU_REPACK OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
  llama
  GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
  GIT_TAG cb300598d5f90189cb69d2702f4930aaf99d32a2
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(llama)

# moss-transcribe.cpp has its own ggml submodule. We intentionally do not add
# its top-level CMake project: its model sources compile cleanly against the
# single llama.cpp ggml target above, avoiding duplicate ggml symbols in one
# Android shared library.
FetchContent_Declare(
  moss
  GIT_REPOSITORY https://github.com/localai-org/moss-transcribe.cpp.git
  GIT_TAG 190a569c13b4b247450f2fb3b2a431244e84833e
  GIT_SHALLOW TRUE
  GIT_SUBMODULES ""
)
FetchContent_Populate(moss)

set(MOSS_SOURCES
  ${moss_SOURCE_DIR}/src/common.cpp
  ${moss_SOURCE_DIR}/src/backend.cpp
  ${moss_SOURCE_DIR}/src/model_loader.cpp
  ${moss_SOURCE_DIR}/src/audio_io.cpp
  ${moss_SOURCE_DIR}/src/fft.cpp
  ${moss_SOURCE_DIR}/src/mel.cpp
  ${moss_SOURCE_DIR}/src/whisper_encoder.cpp
  ${moss_SOURCE_DIR}/src/audio_adaptor.cpp
  ${moss_SOURCE_DIR}/src/tokenizer.cpp
  ${moss_SOURCE_DIR}/src/audio_span.cpp
  ${moss_SOURCE_DIR}/src/qwen3.cpp
  ${moss_SOURCE_DIR}/src/qwen3_decoder.cpp
  ${moss_SOURCE_DIR}/src/generate.cpp
  ${moss_SOURCE_DIR}/src/audio_encoder.cpp
  ${moss_SOURCE_DIR}/src/transcribe.cpp
  ${moss_SOURCE_DIR}/src/transcript_parser.cpp
  ${moss_SOURCE_DIR}/src/subtitle.cpp
  ${moss_SOURCE_DIR}/src/moss_transcribe_capi.cpp
)

add_library(wemux_moss STATIC ${MOSS_SOURCES})
target_include_directories(wemux_moss PUBLIC
  ${moss_SOURCE_DIR}/include
  PRIVATE ${moss_SOURCE_DIR}/src ${moss_SOURCE_DIR}/third_party
)
target_link_libraries(wemux_moss PUBLIC ggml)

add_library(wemux_meeting_runtime SHARED wemux_meeting_runtime.cpp)
target_include_directories(wemux_meeting_runtime PRIVATE
  ${moss_SOURCE_DIR}/include
  ${moss_SOURCE_DIR}/src
  ${llama_SOURCE_DIR}/include
)
target_link_libraries(wemux_meeting_runtime PRIVATE
  wemux_moss
  llama
  android
  log
)

target_compile_options(wemux_meeting_runtime PRIVATE -fvisibility=hidden)
