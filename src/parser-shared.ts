/**
 * Language-agnostic parser utilities shared between tree-sitter parsers.
 * Each language provides its grammar-specific constants via parameters.
 */

import { createHash } from "node:crypto";
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
export function computeBodyHash(
	node: SyntaxNode,
	emptyBodies: string[],
): string {
	const body = node.childForFieldName("body");
	if (!body || body.text.length === 0) return "";

	const normalized = body.text.replace(/\s+/g, " ").trim();
	if (normalized === "" || emptyBodies.includes(normalized)) return "";

	return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Count the number of meaningful parameters on a function node.
 * @param node - AST node containing a "parameters" child field.
 * @param paramTypes - Grammar-specific node types that count as parameters.
 * @param exclude - Optional predicate to exclude specific nodes (e.g. Python's `self`/`cls`).
 * @returns Number of parameters.
 */
export function countParams(
	node: SyntaxNode,
	paramTypes: string[],
	exclude?: (child: SyntaxNode) => boolean,
): number {
	const paramsNode = node.childForFieldName("parameters");
	if (!paramsNode) return 0;

	return paramsNode.namedChildren.filter((c) => {
		if (exclude?.(c)) return false;
		return paramTypes.includes(c.type);
	}).length;
}

/**
 * Compute cyclomatic complexity by walking the AST.
 * @param node - Root AST node of the function body.
 * @param complexityTypes - Grammar-specific node types that add a branch (e.g. "if_statement", "for_statement").
 * @param detectOperator - Grammar-specific callback to detect logical operators that add complexity.
 * @returns Cyclomatic complexity score (base 1).
 */
export function computeComplexity(
	node: SyntaxNode,
	complexityTypes: Set<string>,
	detectOperator: (n: SyntaxNode) => boolean,
): number {
	let complexity = 1;

	function walk(n: SyntaxNode): void {
		if (complexityTypes.has(n.type)) {
			complexity++;
		}
		if (detectOperator(n)) {
			complexity++;
		}
		for (const child of n.children) {
			walk(child);
		}
	}

	walk(node);
	return complexity;
}
