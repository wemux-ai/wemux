cmake_minimum_required(VERSION 3.22)

project(wemux_meeting_runtime_sidecar LANGUAGES C CXX)

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(FetchContent)
if(POLICY CMP0169)
  cmake_policy(SET CMP0169 OLD)
endif()

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
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_CPU_REPACK OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
  llama
  GIT_REPOSITORY https://github.com/ggml-org/llama.cpp.git
  GIT_TAG cb300598d5f90189cb69d2702f4930aaf99d32a2
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(llama)

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

add_executable(wemux-meeting-runtime main.cpp)
target_include_directories(wemux-meeting-runtime PRIVATE
  ${moss_SOURCE_DIR}/include
  ${moss_SOURCE_DIR}/src
  ${llama_SOURCE_DIR}/include
)
target_link_libraries(wemux-meeting-runtime PRIVATE wemux_moss llama)

if(MSVC)
  set_property(TARGET wemux-meeting-runtime PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
  target_compile_definitions(wemux-meeting-runtime PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()
