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
 * Count a function body's tokens: tree-sitter's leaf nodes under its `body`
 * field, comments excluded. Language-neutral and formatting-insensitive, so
 * `{ super(code); }` is 7 tokens however it is laid out. Clone detection uses
 * it to tell a trivial body from a real duplicate.
 * @param node - AST node containing a "body" child field.
 * @returns The body's token count, or 0 when the node has no body.
 */
export declare function countBodyTokens(node: SyntaxNode): number;
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
export declare const COMPLEXITY_THRESHOLD = 10;
/**
 * A function's own cyclomatic complexity: 1 plus the decisions in its own
 * control flow. A function nested inside it (named or not) is its own scope,
 * so its decisions are never counted twice.
 * @param scope - The function's node (one of `rules.scopes`)
 * @param rules - The language's rules
 * @returns 1 or more
 */
export declare function ownComplexity(scope: SyntaxNode, rules: ComplexityRules): number;
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
export declare function fileComplexity(root: SyntaxNode, rules: ComplexityRules): FileComplexity;
/**
 * Secret-like name suffix pattern — constants whose names end with these
 * segments (after `_` or as the full name) are skipped to prevent accidental
 * credential storage in the knowledge graph. Defense-in-depth measure.
 */
export declare const SECRET_NAME_SUFFIX: RegExp;
//# sourceMappingURL=parser-shared.d.ts.map