import { type OnTree } from "./parser-shared.js";
import { type ParsedFile } from "./types.js";
import { type SyntaxNode } from "./wasm-init.js";
/**
 * Parses a TypeScript or JavaScript file into its structural metadata.
 * @param absolutePath - The file to read
 * @param relativePath - Its path in the repo, as recorded in the result
 * @param onTree - Optional: also receives the syntax tree before it is freed
 * @returns The file's functions, classes, imports, exports and constants
 */
export declare function parseFile(absolutePath: string, relativePath: string, onTree?: OnTree): ParsedFile;
export declare function computeBodyHash(node: SyntaxNode): string;
export declare function countParams(node: SyntaxNode): number;
//# sourceMappingURL=tree-sitter.d.ts.map