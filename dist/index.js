/**
 * pharaoh-parser — Open-source AST parser for TypeScript and Python.
 *
 * Extracts structural metadata (function names, signatures, imports, exports,
 * complexity scores) without capturing source code. This is the exact parser
 * used by Pharaoh (https://pharaoh.so) to build codebase knowledge graphs.
 */
export { parseFile as parseTypeScriptFile } from "./tree-sitter.js";
export { parseFile as parsePythonFile } from "./python-tree-sitter.js";
export { walkFiles, isTestFile } from "./file-walker.js";
export { detectModules } from "./module-detector.js";
export { computeBodyHash, computeComplexity, countParams } from "./parser-shared.js";
export { computeClassMetrics, } from "./types.js";
export { Parser, tsLanguage, tsxLanguage, pyLanguage } from "./wasm-init.js";
//# sourceMappingURL=index.js.map