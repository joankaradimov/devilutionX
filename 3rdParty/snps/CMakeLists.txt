include(functions/FetchContent_ExcludeFromAll_backport)

# Only the transport core. The SNP modules are StarCraft's side of the project
# and build for 32-bit Windows only.
set(SNP_BUILD_PROVIDERS OFF)
set(SNP_BUILD_TESTS OFF)

# The web build uses pthreads (SDL2 is built with USE_PTHREADS=1), and a
# shared-memory module can only link objects that were compiled for one.
if(EMSCRIPTEN)
  string(APPEND CMAKE_C_FLAGS " -pthread")
  string(APPEND CMAKE_CXX_FLAGS " -pthread")
endif()

# TODO: Pin to a commit. Nothing has been pushed yet, so for now configure with
# -DFETCHCONTENT_SOURCE_DIR_SNPS=<path to a local checkout>.
include(FetchContent)
FetchContent_Declare_ExcludeFromAll(snps
  GIT_REPOSITORY https://github.com/joankaradimov/snps.git
  GIT_TAG main)
FetchContent_MakeAvailable_ExcludeFromAll(snps)

# lwIP, which ZeroTier links in, has a udp_sendto() of its own. The one in
# libjuice, libdatachannel's ICE library, is internal to it, so rename that one.
if(TARGET juice-static)
  target_compile_definitions(juice-static PRIVATE udp_sendto=juice_udp_sendto)
endif()
