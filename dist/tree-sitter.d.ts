import { type ParsedFile } from "./types.js";
import { type SyntaxNode } from "./wasm-init.js";
export declare function parseFile(absolutePath: string, relativePath: string): ParsedFile;
export declare function computeBodyHash(node: SyntaxNode): string;
export declare function countParams(node: SyntaxNode): number;
//# sourceMappingURL=tree-sitter.d.ts.map