import type { ScriptSource } from "./embedded-script.js";
import { type OnTree } from "./parser-shared.js";
import { type ParsedFile } from "./types.js";
import { type SyntaxNode } from "./wasm-init.js";
/**
 * Parses a TypeScript, JavaScript or Vue (.vue) file into its structural metadata.
 * @param absolutePath - The file to read
 * @param relativePath - Its path in the repo, as recorded in the result
 * @param onTree - Optional: also receives the syntax tree before it is freed.
 *   For a .vue file it is the tree of toScriptSource's code, whose rows are
 *   the .vue file's rows.
 * @returns The file's functions, classes, imports, exports and constants
 */
export declare function parseFile(absolutePath: string, relativePath: string, onTree?: OnTree): ParsedFile;
/**
 * The code to parse for a file in place of its text, so a tree built
 * elsewhere (like Pharaoh's call tracer's) matches the one parseFile reads:
 * a .vue file's script blocks laid over blank text at their original
 * positions, and any other file unchanged.
 * @param relativePath - The file's path, whose extension says how to read it
 * @param source - The file's text
 * @returns The code, and the extension its script is written in (picks the grammar)
 */
export declare function toScriptSource(relativePath: string, source: string): ScriptSource;
export declare function computeBodyHash(node: SyntaxNode): string;
export declare function countParams(node: SyntaxNode): number;
//# sourceMappingURL=tree-sitter.d.ts.map