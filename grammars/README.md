# TypeScript and TSX grammars

These ABI 14 WASM modules are generated from [tree-sitter-typescript v0.23.2](https://github.com/tree-sitter/tree-sitter-typescript/tree/v0.23.2).
The patch adds arrays of imported types, typed tagged templates and calls with
`typeof import(...)` type arguments. It keeps both parses of a call after
`typeof` available until the following tokens distinguish a generic call from
a runtime comparison. It also preserves the callee inside awaited generic calls.

The tagged template and type-query changes build on upstream discussions
[#342](https://github.com/tree-sitter/tree-sitter-typescript/pull/342) and
[#375](https://github.com/tree-sitter/tree-sitter-typescript/pull/375).

Run `./scripts/rebuild-typescript-grammars.sh` from a checkout with Git,
Node.js, npm and Docker. Use `--check` to compare a fresh build with the
committed modules byte for byte. The script pins the upstream revision, the
Tree-sitter CLI and JavaScript grammar versions, and the Emscripten image digest.
