This release runs C and C++ code blocks and fixes MATLAB fences that define a function before calling it.

## What's New

- Run `c`, `cpp`, and `c++` code blocks: CodeSuite compiles them with `gcc` / `g++`, then runs the program with live output, interactive stdin, Stop, and the execution timeout (#86, thanks @AnYellowKing)
  - Input typed while the program is still compiling is delivered when it starts.

## Bug Fixes

- MATLAB fences that define a function and then call it now run as scripts instead of being registered as a function file (#84, #85, thanks @RarityBrown)
- Programs that exit before reading their input no longer raise an unhandled pipe error.

## Upgrade Notes

- No manual migration is required. Existing settings are preserved.
- C and C++ blocks need `gcc` / `g++` on your PATH (on Windows, for example, MinGW-w64). Function-first MATLAB scripts require MATLAB R2024a or later.
- The minimum supported Obsidian version remains 1.6.6.
