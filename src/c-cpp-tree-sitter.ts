/**
 * C and C++ extraction on the upstream tree-sitter-c and tree-sitter-cpp
 * grammars. Definitions are found with each grammar's own `tags.scm` query
 * (plus the few declarator forms it leaves out), then read into the same
 * ParsedFile shape as every other language.
 *
 * The grammars parse the text as written: nothing is preprocessed, so both
 * branches of an `#if` are read and a macro call is an ordinary call. A file
 * the grammar could not fully read still returns what it found; the tree's
 * `hasError` (see onTree) says so.
 *
 * The grammars load when this module is first imported, not with the rest of
 * the parser: only callers that map C or C++ pay for them.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Language, Query, type Tree } from "web-tree-sitter";
import { blankMacros, firstBranches } from "./c-cpp-macros.js";

export { collectAttributeMacros } from "./c-cpp-macros.js";
import {
	type OnTree,
	SECRET_NAME_SUFFIX,
	computeBodyHash,
	computeComplexity,
	countParams,
} from "./parser-shared.js";
import {
	type ParsedClass,
	type ParsedConstant,
	type ParsedExport,
	type ParsedFile,
	type ParsedFunction,
	type ParsedImport,
	computeClassMetrics,
} from "./types.js";
import { Parser, type SyntaxNode } from "./wasm-init.js";

export { C_CPP_EXTENSIONS } from "./file-walker.js";

const require = createRequire(import.meta.url);

/** Declarator forms upstream tags.scm leaves out: destructors, operators, nested scopes, `f<T>`. */
const EXTRA_TAGS: Record<"c" | "cpp", string> = {
	c: "",
	cpp: `
(function_declarator declarator: (destructor_name)) @definition.method
(function_declarator declarator: (operator_name)) @definition.function
(function_declarator declarator: (template_function)) @definition.function
(function_declarator declarator: (qualified_identifier)) @definition.method
(union_specifier name: (type_identifier) body: (_)) @definition.class`,
};

async function loadDialect(dialect: "c" | "cpp") {
	const dir = path.dirname(
		require.resolve(`tree-sitter-${dialect}/package.json`),
	);
	const language = await Language.load(`${dir}/tree-sitter-${dialect}.wasm`);
	const tags = fs.readFileSync(`${dir}/queries/tags.scm`, "utf-8");
	const parser = new Parser();
	parser.setLanguage(language);
	return {
		parser,
		query: new Query(language, tags + EXTRA_TAGS[dialect]),
	};
}

const DIALECTS = { c: await loadDialect("c"), cpp: await loadDialect("cpp") };

/** Words only C++ has: a `.h` that uses one is read with the C++ grammar. */
const CPP_ONLY =
	/\b(?:class|namespace|template|typename|constexpr|nullptr|public|private|protected|virtual|operator)\b|::/;

/**
 * The grammar a file is read with. `.c` is C and the `.cc`/`.cpp` family is
 * C++. A `.h` header is C++ when its text uses a C++-only word, otherwise C.
 */
function dialectOf(relativePath: string, source: string): "c" | "cpp" {
	const ext = path.extname(relativePath).toLowerCase();
	if (ext === ".c") return "c";
	if (ext !== ".h") return "cpp";
	return CPP_ONLY.test(source) ? "cpp" : "c";
}

const COMPLEXITY_TYPES = new Set([
	"if_statement",
	"for_statement",
	"for_range_loop",
	"while_statement",
	"do_statement",
	"case_statement",
	"catch_clause",
	"conditional_expression",
]);

const isLogicalOperator = (node: SyntaxNode): boolean =>
	node.type === "&&" || node.type === "||";

const PARAMETER_TYPES = [
	"parameter_declaration",
	"optional_parameter_declaration",
	"variadic_parameter_declaration",
	"variadic_parameter",
];

const CLASS_TYPES = new Set([
	"class_specifier",
	"struct_specifier",
	"union_specifier",
]);

/** Declarators that wrap a function's own: `int *f()`, `T &f()`. */
const WRAPPING_DECLARATORS = new Set([
	"pointer_declarator",
	"reference_declarator",
]);

const MAX_SIGNATURE_LENGTH = 300;
const MAX_CONSTANT_LENGTH = 128;

/** One-line text: whitespace runs collapsed. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** A declared function's own name and, for `A::f`, the class it names. */
function declaredName(
	declarator: SyntaxNode,
): { name: string; scope?: string } | null {
	let node = declarator.childForFieldName("declarator");
	let scope: string | undefined;
	// `ns::A::f` nests to the right: each level's scope is one step closer to `f`
	while (node?.type === "qualified_identifier") {
		const part = node.childForFieldName("scope");
		// `Box<T>::set` belongs to `Box`
		const named =
			part?.type === "template_type" ? part.childForFieldName("name") : part;
		scope = named?.text ?? scope;
		node = node.childForFieldName("name");
	}
	if (node?.type === "template_function") node = node.childForFieldName("name");
	if (!node) return null;
	if (
		node.type !== "identifier" &&
		node.type !== "field_identifier" &&
		node.type !== "destructor_name" &&
		node.type !== "operator_name"
	) {
		return null;
	}
	return {
		name: oneLine(node.text).replace(/^operator\s+(?=\W)/, "operator"),
		scope,
	};
}

/** The class a node sits in the body of, and whether an unnamed namespace hides it. */
function enclosing(node: SyntaxNode): {
	className?: string;
	internal: boolean;
} {
	let className: string | undefined;
	let internal = false;
	for (let n = node.parent; n; n = n.parent) {
		if (!className && CLASS_TYPES.has(n.type)) {
			className = n.childForFieldName("name")?.text;
		}
		if (n.type === "namespace_definition" && !n.childForFieldName("name")) {
			internal = true;
		}
	}
	return { className, internal };
}

/** Whether a node sits in a function's body: what it declares is local. */
function insideBody(node: SyntaxNode): boolean {
	for (let n = node.parent; n; n = n.parent) {
		if (n.type === "compound_statement") return true;
	}
	return false;
}

const isStatic = (node: SyntaxNode): boolean =>
	node.children.some(
		(c) => c?.type === "storage_class_specifier" && c.text === "static",
	);

/** The names a class's base clause lists, without access words or template arguments. */
function baseNames(classNode: SyntaxNode): string[] {
	const clause = classNode.children.find(
		(c) => c?.type === "base_class_clause",
	);
	return (clause?.namedChildren ?? [])
		.filter((c) => c !== null && c.type !== "access_specifier")
		.map((c) =>
			c?.type === "template_type"
				? (c.childForFieldName("name")?.text ?? c.text)
				: (c?.text ?? ""),
		)
		.filter((name) => name !== "" && name !== "virtual");
}

/** Read one syntax tree of a file (as written, or rewritten) into a ParsedFile. */
function read(
	root: SyntaxNode,
	source: string,
	relativePath: string,
	language: "c" | "cpp",
): ParsedFile {
	const { query } = DIALECTS[language];
	const functions: ParsedFunction[] = [];
	const classes: ParsedClass[] = [];
	const exports: ParsedExport[] = [];
	const methodsOf = new Map<string, Set<string>>();
	const classNodes: SyntaxNode[] = [];
	const seen = new Set<number>();
	const exported = new Set<string>();
	const exportOnce = (name: string, kind: ParsedExport["kind"]): void => {
		if (exported.has(`${kind}:${name}`)) return;
		exported.add(`${kind}:${name}`);
		exports.push({ name, kind, isDefault: false });
	};

	for (const { name: tag, node } of query.captures(root)) {
		if (seen.has(node.id)) continue;
		if (tag === "definition.class" && CLASS_TYPES.has(node.type)) {
			seen.add(node.id);
			if (node.childForFieldName("body")) classNodes.push(node);
			continue;
		}
		if (node.type !== "function_declarator") continue;
		seen.add(node.id);

		const declared = declaredName(node);
		let owner = node.parent;
		while (owner && WRAPPING_DECLARATORS.has(owner.type)) owner = owner.parent;
		if (!declared || !owner) continue;
		// `Foo a(b);` in a body reads as a prototype but declares a variable
		if (owner.type !== "function_definition" && insideBody(owner)) continue;
		const where = enclosing(owner);
		const className = declared.scope ?? where.className;
		if (className) {
			const methods = methodsOf.get(className) ?? new Set<string>();
			methodsOf.set(className, methods.add(declared.name));
		}
		const isExported = !where.internal && (!!className || !isStatic(owner));

		if (owner.type !== "function_definition") {
			// A prototype: the header's promise of a function defined elsewhere
			const prototype =
				owner.type === "declaration" || owner.type === "field_declaration";
			if (prototype && !className && isExported) {
				exportOnce(declared.name, "function");
			}
			continue;
		}
		const body = owner.childForFieldName("body");
		// Up to the body, or to a constructor's `: member(value)` list before it
		const head = owner.children.find(
			(c) => c?.type === "field_initializer_list" || c?.id === body?.id,
		);
		const signature = oneLine(
			source.slice(owner.startIndex, head?.startIndex ?? owner.endIndex),
		).slice(0, MAX_SIGNATURE_LENGTH);
		functions.push({
			name: declared.name,
			signature,
			lineStart: owner.startPosition.row + 1,
			lineEnd: owner.endPosition.row + 1,
			loc: owner.endPosition.row - owner.startPosition.row + 1,
			complexity: computeComplexity(
				body ?? owner,
				COMPLEXITY_TYPES,
				isLogicalOperator,
			),
			isExported,
			isAsync: false,
			...(className ? { className } : {}),
			bodyHash: computeBodyHash(owner, ["{}", "{ }"]),
			// `f(void)` takes nothing
			paramCount: countParams(node, PARAMETER_TYPES, (p) => p.text === "void"),
		});
		if (!className && isExported) exportOnce(declared.name, "function");
	}

	for (const node of classNodes) {
		const name = node.childForFieldName("name")?.text;
		if (!name) continue;
		const lineStart = node.startPosition.row + 1;
		const lineEnd = node.endPosition.row + 1;
		const [base, ...otherBases] = baseNames(node);
		const isExported = !enclosing(node).internal;
		classes.push({
			name,
			lineStart,
			lineEnd,
			...computeClassMetrics(name, lineStart, lineEnd, functions),
			isExported,
			methods: [...(methodsOf.get(name) ?? [])],
			...(base ? { extends: base } : {}),
			...(otherBases.length > 0 ? { implements: otherBases } : {}),
		});
		if (isExported) exportOnce(name, "class");
	}

	const parsed: ParsedFile = {
		path: relativePath,
		language,
		loc: source.split("\n").length,
		functions,
		classes,
		imports: includes(root),
		exports,
		constants: scalarMacros(root),
	};
	return parsed;
}

/**
 * Parses a C or C++ file into its structural metadata.
 *
 * Functions are definitions (a body): free functions, methods defined in their
 * class and `A::f` defined outside it, each with `className` set to the class.
 * Overloads are separate functions with the same name. A prototype defines
 * nothing: outside a class it is an export of the header, inside one it is a
 * name in the class's `methods`. An `#include` is an import whose source is
 * the path as written, in angle brackets for a system header. A function is
 * exported unless it is `static` at file scope or inside an unnamed namespace.
 *
 * @param absolutePath - The file to read
 * @param relativePath - Its path in the repo, as recorded in the result
 * A file the grammar cannot read as written (an unknown attribute macro, an
 * `#if` whose branches each hold half a statement) is read again through
 * rewrites that blank macros (see recover); what that read finds is marked
 * `recovered`, and onTree then receives its tree.
 *
 * @param onTree - Optional: also receives the syntax tree before it is freed
 * @param options - Optional: the repo's attribute macros, and the recovery budget
 * @returns The file's functions, classes, includes, exports and scalar macros
 */
export function parseFile(
	absolutePath: string,
	relativePath: string,
	onTree?: OnTree,
	options: CppParseOptions = {},
): ParsedFile {
	const source = fs.readFileSync(absolutePath, "utf-8");
	const language = dialectOf(relativePath, source);
	const { parser } = DIALECTS[language];
	const tree = parser.parse(source);
	if (!tree) throw new Error(`Failed to parse ${relativePath}`);
	// Trees live in WASM memory until they are deleted (see python-tree-sitter.ts).
	let rewritten: Rewritten | null = null;
	try {
		const parsed = read(tree.rootNode, source, relativePath, language);
		if (tree.rootNode.hasError)
			rewritten = recover(tree.rootNode, source, language, options);
		if (!rewritten) {
			onTree?.(tree.rootNode, parsed);
			return parsed;
		}
		const merged = merge(
			parsed,
			read(rewritten.tree.rootNode, rewritten.text, relativePath, language),
			errorSpans(tree.rootNode),
		);
		onTree?.(rewritten.tree.rootNode, merged);
		return merged;
	} finally {
		tree.delete();
		rewritten?.tree.delete();
	}
}

/** A rewritten text and its tree, which the caller deletes. */
interface Rewritten {
	text: string;
	tree: Tree;
}

/** Rounds that blank every error's lines at once, each on what the last left. */
const MAX_ROUNDS = 3;

/** Reparses one file's recovery may spend, however small the file. */
const MAX_REPARSES = 40;

/**
 * Text one file's recovery may reparse in all. A 100 KB file gets 10
 * reparses, a 1 MB file one; the worst single file in curl, redis and fmt
 * took 0.4-1.4 s on a loaded machine. On the corpus, a larger budget read no
 * more files cleanly.
 */
export const RECOVERY_BYTES = 1_000_000;

/**
 * How many times recovery may reparse a file of `size` characters: the budget
 * in bytes over the file's size, at most MAX_REPARSES. Bytes, not
 * milliseconds, so the same file gets the same reads on any machine.
 *
 * @param size - The file's length
 * @param recoveryBytes - The text recovery may reparse in all
 * @returns The number of reparses allowed (0: no recovery)
 */
export function recoveryReparses(
	size: number,
	recoveryBytes = RECOVERY_BYTES,
): number {
	return Math.min(MAX_REPARSES, Math.floor(recoveryBytes / Math.max(size, 1)));
}

/** What parseFile may be told about the repo, and how much recovery may cost. */
export interface CppParseOptions {
	/** The repo's attribute macros (collectAttributeMacros), blanked where an attribute sits. */
	repoMacros?: ReadonlySet<string>;
	/** Bytes recovery may reparse for this file (RECOVERY_BYTES unless set); 0 turns it off. */
	recoveryBytes?: number;
}

/** Rewrites in a row that read no more of the file before the search stops. */
const MAX_MISSES = 6;

/** Lines past an error's start that its rewrite covers: a long ERROR node is a cascade from its top. */
const MAX_REGION_ROWS = 4;

/** The top-level error regions of a tree: ERROR nodes and missing tokens. */
function errorNodes(root: SyntaxNode): SyntaxNode[] {
	const found: SyntaxNode[] = [];
	const visit = (node: SyntaxNode): void => {
		if (node.isError || node.isMissing) {
			found.push(node);
			return;
		}
		for (const child of node.children) if (child?.hasError) visit(child);
	};
	visit(root);
	return found;
}

/** How much of a tree is in error: bytes inside ERROR nodes, one per missing token. */
const errorSize = (root: SyntaxNode): number =>
	errorNodes(root).reduce(
		(size, node) => size + Math.max(1, node.endIndex - node.startIndex),
		0,
	);

/** One-based line spans of a tree's error regions. */
const errorSpans = (root: SyntaxNode): [number, number][] =>
	errorNodes(root).map((node) => [
		node.startPosition.row + 1,
		node.endPosition.row + 1,
	]);

/**
 * Zero-based rows to rewrite for one error: back to the last line with text
 * before it, where the macro that caused it often sits (`TEST_END`, a blank
 * line, then the `static void` the error starts at), through its first few
 * lines and its last.
 */
function regionRows(
	node: SyntaxNode,
	lines: string[],
	span = MAX_REGION_ROWS,
): number[] {
	let first = node.startPosition.row - 1;
	while (first > 0 && lines[first].trim() === "") first--;
	const last = node.endPosition.row;
	const rows: number[] = [];
	for (
		let r = Math.max(first, 0);
		r <= Math.min(last, node.startPosition.row + span);
		r++
	) {
		rows.push(r);
	}
	if (rows.at(-1) !== last) rows.push(last);
	return rows;
}

/**
 * Read a file the grammar could not read as written. Each rewrite is kept only
 * if less of the file is then in error, so a guess that breaks code elsewhere
 * is dropped: first the annotations that are safe to blank anywhere, then the
 * macros at each error, one error at a time (blankMacros), then one branch of
 * each conditional (firstBranches) and each error again. Every rewrite keeps
 * lines and columns.
 *
 * @returns The best rewrite, or null when none reads more of the file
 */
function recover(
	root: SyntaxNode,
	source: string,
	language: "c" | "cpp",
	{ repoMacros, recoveryBytes = RECOVERY_BYTES }: CppParseOptions,
): Rewritten | null {
	const { parser } = DIALECTS[language];
	const maxReparses = recoveryReparses(source.length, recoveryBytes);
	let best: Rewritten | null = null;
	let bestText = source;
	let bestRoot = root;
	let bestSize = errorSize(root);
	let reparses = 0;
	const keepIfBetter = (text: string): boolean => {
		if (text === bestText || reparses >= maxReparses) return false;
		reparses++;
		const tree = parser.parse(text);
		if (!tree) return false;
		const size = errorSize(tree.rootNode);
		if (size >= bestSize) {
			tree.delete();
			return false;
		}
		best?.tree.delete();
		best = { text, tree };
		bestText = text;
		bestRoot = tree.rootNode;
		bestSize = size;
		return true;
	};
	const eachError = (): void => {
		const tried = new Set<string>();
		let improved = true;
		let misses = 0;
		while (improved && bestSize > 0 && reparses < maxReparses) {
			improved = false;
			const lines = bestText.split("\n");
			for (const node of errorNodes(bestRoot)) {
				if (misses >= MAX_MISSES) return;
				const rows = regionRows(node, lines);
				const key = rows.map((r) => lines[r]).join("\n");
				if (tried.has(key)) continue;
				tried.add(key);
				const next = blankMacros(bestText, rows, false, repoMacros);
				if (next === bestText) continue;
				// A kept rewrite changes the tree: list its errors again
				if (keepIfBetter(next)) {
					improved = true;
					misses = 0;
					break;
				}
				misses++;
			}
		}
	};
	// Every error's lines at once: one parse for what is usually most of the fix
	const everyError = (): Set<number> => {
		const lines = bestText.split("\n");
		const rows = new Set<number>();
		for (const node of errorNodes(bestRoot)) {
			for (const row of regionRows(node, lines, Number.POSITIVE_INFINITY)) {
				rows.add(row);
			}
		}
		return rows;
	};
	const pass = (): void => {
		for (let round = 0; round < MAX_ROUNDS && bestSize > 0; round++) {
			if (!keepIfBetter(blankMacros(bestText, everyError(), false, repoMacros)))
				break;
		}
		eachError();
	};
	try {
		keepIfBetter(blankMacros(source, "all", true, repoMacros));
		pass();
		if (bestSize > 0) {
			const branches = firstBranches(bestText, language);
			if (
				keepIfBetter(branches) ||
				keepIfBetter(blankMacros(branches, everyError(), false, repoMacros))
			) {
				pass();
			}
		}
		return best;
	} catch (err) {
		(best as Rewritten | null)?.tree.delete();
		throw err;
	}
}

/**
 * The facts of a rewritten read, plus what the read as written found outside
 * its error regions that the rewrite lost (a function in an `#else` branch the
 * rewrite blanked). Includes and constants come from the text as written.
 *
 * @param written - The read of the file as written
 * @param rewritten - The read of the best rewrite
 * @param errors - One-based line spans of the errors in the read as written
 */
function merge(
	written: ParsedFile,
	rewritten: ParsedFile,
	errors: [number, number][],
): ParsedFile {
	const sound = (item: { lineStart: number; lineEnd: number }): boolean =>
		!errors.some(([from, to]) => item.lineStart >= from && item.lineEnd <= to);
	const fnKey = (f: ParsedFunction) =>
		`${f.className ?? ""}::${f.name}@${f.lineStart}`;
	const classKey = (c: ParsedClass) => `${c.name}@${c.lineStart}`;
	const haveFns = new Set(rewritten.functions.map(fnKey));
	const haveClasses = new Set(rewritten.classes.map(classKey));
	const extraFns = written.functions.filter(
		(f) => !haveFns.has(fnKey(f)) && sound(f),
	);
	const extraClasses = written.classes.filter(
		(c) => !haveClasses.has(classKey(c)) && sound(c),
	);
	// An export the rewrite lost is kept only with the definition it names
	const kept = new Set([
		...extraFns.filter((f) => !f.className).map((f) => `function:${f.name}`),
		...extraClasses.map((c) => `class:${c.name}`),
	]);
	const haveExports = new Set(
		rewritten.exports.map((e) => `${e.kind}:${e.name}`),
	);
	const byLine = <T extends { lineStart: number }>(a: T, b: T) =>
		a.lineStart - b.lineStart;
	return {
		...rewritten,
		functions: [...rewritten.functions, ...extraFns].sort(byLine),
		classes: [...rewritten.classes, ...extraClasses].sort(byLine),
		exports: [
			...rewritten.exports,
			...written.exports.filter(
				(e) =>
					kept.has(`${e.kind}:${e.name}`) &&
					!haveExports.has(`${e.kind}:${e.name}`),
			),
		],
		imports: written.imports,
		constants: written.constants,
		recovered: true,
	};
}

/** Every `#include`, wherever an `#if` puts it: `"util.h"` as `util.h`, `<cmath>` as written. */
function includes(root: SyntaxNode): ParsedImport[] {
	const imports: ParsedImport[] = [];
	for (const node of root.descendantsOfType("preproc_include")) {
		const target = node?.childForFieldName("path");
		if (!node || !target) continue;
		imports.push({
			source:
				target.type === "string_literal"
					? target.text.slice(1, -1)
					: target.text,
			symbols: [],
			isDefault: false,
			isNamespace: true,
			line: node.startPosition.row + 1,
		});
	}
	return imports;
}

/** A macro value kept as a constant: one number, string or character literal. */
const LITERAL = /^(?:[-+]?\.?\d[\w.']*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;

/**
 * Object-like macros whose value is one literal (`#define MAX_POINTS 64`): the
 * file's constants. A macro holding code or an expression is left out, as is
 * one named like a secret (see SECRET_NAME_SUFFIX); a trailing comment is not
 * part of the value.
 */
function scalarMacros(root: SyntaxNode): ParsedConstant[] {
	const constants: ParsedConstant[] = [];
	for (const node of root.descendantsOfType("preproc_def")) {
		const name = node?.childForFieldName("name")?.text;
		const raw = node?.childForFieldName("value")?.text.trim();
		// A string holding `//` is a literal as written; otherwise drop a trailing comment
		const value =
			raw && !LITERAL.test(raw)
				? raw.replace(/\/\/.*$|\/\*.*?\*\/\s*$/s, "").trim()
				: raw;
		if (!node || !name || !value || SECRET_NAME_SUFFIX.test(name)) continue;
		if (value.length > MAX_CONSTANT_LENGTH || !LITERAL.test(value)) continue;
		constants.push({
			name,
			value,
			typeAnnotation: null,
			isExported: true,
			lineStart: node.startPosition.row + 1,
			lineEnd: node.startPosition.row + 1,
		});
	}
	return constants;
}
