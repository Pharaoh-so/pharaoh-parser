import { type OnTree } from "./parser-shared.js";
import { type ParsedFile } from "./types.js";
/**
 * Parses a Python file into its structural metadata.
 * @param absolutePath - The file to read
 * @param relativePath - Its path in the repo, as recorded in the result
 * @param onTree - Optional: also receives the syntax tree before it is freed
 * @returns The file's functions, classes, imports and exports
 */
export declare function parseFile(absolutePath: string, relativePath: string, onTree?: OnTree): ParsedFile;
//# sourceMappingURL=python-tree-sitter.d.ts.map