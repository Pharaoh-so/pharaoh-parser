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
 * Count a function body's tokens: tree-sitter's leaf nodes under its `body`
 * field, comments excluded. Language-neutral and formatting-insensitive, so
 * `{ super(code); }` is 7 tokens however it is laid out. Clone detection uses
 * it to tell a trivial body from a real duplicate.
 * @param node - AST node containing a "body" child field.
 * @returns The body's token count, or 0 when the node has no body.
 */
export function countBodyTokens(node: SyntaxNode): number {
	const body = node.childForFieldName("body");
	if (!body) return 0;
	let tokens = 0;
	const stack: SyntaxNode[] = [body];
	for (let current = stack.pop(); current; current = stack.pop()) {
		if (current.type === "comment" || current.type.endsWith("_comment")) continue;
		if (current.childCount === 0) {
			tokens++;
			continue;
		}
		for (let i = 0; i < current.childCount; i++) {
			const child = current.child(i);
			if (child) stack.push(child);
		}
	}
	return tokens;
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

/**
 * How one language counts complexity under the shared rule (docs/complexity.md):
 * 1, plus 1 per decision point, plus 1 per short-circuit operator, counted in
 * a function's own control flow and never in a function nested inside it.
 */
export interface ComplexityRules {
	/** Node types that each add one decision (a loop, an `if`, a handler, a conditional expression). */
	decisions: ReadonlySet<string>;
	/** Node types that open their own function scope: what's inside counts for them, not for the function around them. */
	scopes: ReadonlySet<string>;
	/** Operator and keyword tokens that each add one (`&&`, `??`, C's `case`). */
	tokens?: {
		/** The token types. */
		types: ReadonlySet<string>;
		/** The node types a counted token must sit directly in (a binary expression, not C++'s `int&& x`). */
		parents: ReadonlySet<string>;
	};
}

/** A function scope over this complexity is over by the difference (its excess). */
export const COMPLEXITY_THRESHOLD = 10;

/**
 * Walk `root` and everything under it once with a tree cursor, which makes no
 * node objects: types alone decide what counts. Each function scope
 * opened under `root` keeps its own count, and `close` receives it as the walk
 * leaves the scope, so no decision is counted for two scopes.
 * @returns The count for `root` itself: 1 plus the decisions outside every scope nested in it
 */
function walkScopes(
	root: SyntaxNode,
	rules: ComplexityRules,
	close?: (cc: number, startIndex: number) => void,
): number {
	const cursor = root.walk();
	const counts = [1];
	// The depth and start of each open nested scope, innermost last.
	const opened: number[] = [];
	const starts: number[] = [];
	// The types of the nodes above the cursor, for a token's parent.
	const above: string[] = [];
	let depth = 0;
	try {
		for (;;) {
			const type = cursor.nodeType;
			if (depth === 0) {
				// The root is the scope being counted (or a file).
			} else if (cursor.nodeIsNamed) {
				// Named nodes only: a keyword token can share a scope's type name (`function`).
				if (rules.scopes.has(type)) {
					counts.push(1);
					opened.push(depth);
					starts.push(cursor.startIndex);
				} else if (rules.decisions.has(type)) {
					counts[counts.length - 1]++;
				}
			} else if (
				rules.tokens?.types.has(type) &&
				rules.tokens.parents.has(above[above.length - 1])
			) {
				counts[counts.length - 1]++;
			}
			if (cursor.gotoFirstChild()) {
				above.push(type);
				depth++;
				continue;
			}
			// Leave nodes until one has a next sibling, closing scopes on the way out.
			for (;;) {
				if (opened.length > 0 && opened[opened.length - 1] === depth) {
					opened.pop();
					const cc = counts.pop() as number;
					close?.(cc, starts.pop() as number);
				}
				if (depth === 0) return counts[0];
				if (cursor.gotoNextSibling()) break;
				cursor.gotoParent();
				above.pop();
				depth--;
			}
		}
	} finally {
		cursor.delete();
	}
}

/**
 * A function's own cyclomatic complexity: 1 plus the decisions in its own
 * control flow. A function nested inside it (named or not) is its own scope,
 * so its decisions are never counted twice.
 * @param scope - The function's node (one of `rules.scopes`)
 * @param rules - The language's rules
 * @returns 1 or more
 */
export function ownComplexity(
	scope: SyntaxNode,
	rules: ComplexityRules,
): number {
	return walkScopes(scope, rules);
}

/** A file's complexity from one walk (docs/complexity.md). */
export interface FileComplexity {
	/** Each function scope's own complexity, by the byte offset its node starts at. */
	ccAt: ReadonlyMap<number, number>;
	/**
	 * How far the file's scopes are over COMPLEXITY_THRESHOLD, summed: every
	 * scope counts, named or anonymous, extracted as a function or not, so
	 * naming an inline callback or adding small functions leaves it unchanged,
	 * while splitting a complex function lowers it.
	 */
	excess: number;
}

/**
 * Every function scope's own complexity in a file, and the file's excess,
 * from one walk of its tree.
 * @param root - The file's root node
 * @param rules - The language's rules
 */
export function fileComplexity(
	root: SyntaxNode,
	rules: ComplexityRules,
): FileComplexity {
	const ccAt = new Map<number, number>();
	let excess = 0;
	walkScopes(root, rules, (cc, startIndex) => {
		ccAt.set(startIndex, cc);
		excess += Math.max(0, cc - COMPLEXITY_THRESHOLD);
	});
	return { ccAt, excess };
}

/**
 * Secret-like name suffix pattern — constants whose names end with these
 * segments (after `_` or as the full name) are skipped to prevent accidental
 * credential storage in the knowledge graph. Defense-in-depth measure.
 */
export const SECRET_NAME_SUFFIX =
	/(?:^|_)(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)$/i;
