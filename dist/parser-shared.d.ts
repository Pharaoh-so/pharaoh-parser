/**
 * Language-agnostic parser utilities shared between tree-sitter parsers.
 * Each language provides its grammar-specific constants via parameters.
 */
import type { ParsedFile } from "./types.js";
import type { SyntaxNode } from "./wasm-init.js";
/**
 * Receives a file's syntax tree, and the ParsedFile parseFile returns, while
 * the tree is still alive, so a caller can read more from it without parsing
 * the file again. parseFile frees the tree when this returns: keep no node.
 */
export type OnTree = (rootNode: SyntaxNode, parsed: ParsedFile) => void;
/**
 * Compute a normalized SHA-256 body hash for deduplication.
 * Whitespace-insensitive: tabs vs spaces, CRLF vs LF all produce the same hash.
 * @param node - AST node containing a "body" child field.
 * @param emptyBodies - Language-specific strings that represent empty bodies (e.g. "{}" for TS, "pass" for Python).
 * @returns 16-char hex hash, or "" for empty/trivial bodies.
 */
export declare function computeBodyHash(node: SyntaxNode, emptyBodies: string[]): string;
/**
 * Count the number of meaningful parameters on a function node.
 * @param node - AST node containing a "parameters" child field.
 * @param paramTypes - Grammar-specific node types that count as parameters.
 * @param exclude - Optional predicate to exclude specific nodes (e.g. Python's `self`/`cls`).
 * @returns Number of parameters.
 */
export declare function countParams(node: SyntaxNode, paramTypes: string[], exclude?: (child: SyntaxNode) => boolean): number;
/**
 * Compute cyclomatic complexity by walking the AST.
 * @param node - Root AST node of the function body.
 * @param complexityTypes - Grammar-specific node types that add a branch (e.g. "if_statement", "for_statement").
 * @param detectOperator - Grammar-specific callback to detect logical operators that add complexity.
 * @returns Cyclomatic complexity score (base 1).
 */
export declare function computeComplexity(node: SyntaxNode, complexityTypes: Set<string>, detectOperator: (n: SyntaxNode) => boolean): number;
//# sourceMappingURL=parser-shared.d.ts.map