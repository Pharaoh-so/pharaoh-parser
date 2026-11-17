import fs from "node:fs";
import type { ScriptSource } from "./embedded-script.js";
import {
	type ComplexityRules,
	type FileComplexity,
	type OnTree,
	SECRET_NAME_SUFFIX,
	computeBodyHash as computeBodyHashShared,
	computeComplexity as computeComplexityShared,
	countParams as countParamsShared,
	fileComplexity,
	ownComplexity,
} from "./parser-shared.js";
import {
	type ParsedClass,
	type ParsedConstant,
	type ParsedExport,
	type ParsedFile,
	type ParsedFunction,
	type ParsedImport,
	type ParsedTemplateRef,
	computeClassMetrics,
} from "./types.js";
import {
	type MemberTargets,
	type OptionsApi,
	type OptionsMember,
	type TemplateScope,
	type VueSfc,
	componentNameFromPath,
	isClassComponentHook,
	readOptionsApi,
	readSetupBindings,
	readTemplateRefs,
	readVueSfc,
} from "./vue-sfc.js";
import {
	Parser,
	type SyntaxNode,
	jsLanguage,
	tsLanguage,
	tsxLanguage,
} from "./wasm-init.js";

const tsParser = new Parser();
tsParser.setLanguage(tsLanguage);

const tsxParser = new Parser();
tsxParser.setLanguage(tsxLanguage);

const jsParser = new Parser();
jsParser.setLanguage(jsLanguage);

// Complexity-contributing node types
const COMPLEXITY_TYPES = new Set([
	"if_statement",
	"else_clause",
	"switch_case",
	"for_statement",
	"for_in_statement",
	"while_statement",
	"do_statement",
	"catch_clause",
	"ternary_expression",
]);

// Binary expression operators that add complexity
const COMPLEXITY_OPERATORS = new Set(["&&", "||", "??"]);
const SHORT_CIRCUIT_ASSIGNMENTS = new Set(["&&=", "||=", "??="]);

/**
 * The shared complexity rule for TypeScript and JavaScript (docs/complexity.md):
 * `else` adds nothing, `default:` adds nothing, and each short-circuit operator
 * (`&&` `||` `??`, and their assignments) adds one. Every function form is
 * its own scope.
 */
const TS_COMPLEXITY: ComplexityRules = {
	decisions: new Set([
		"if_statement",
		"switch_case",
		"for_statement",
		"for_in_statement",
		"while_statement",
		"do_statement",
		"catch_clause",
		"ternary_expression",
	]),
	scopes: new Set([
		"function_declaration",
		"generator_function_declaration",
		"function_expression",
		"function",
		"generator_function",
		"arrow_function",
		"method_definition",
	]),
	tokens: {
		types: new Set([...COMPLEXITY_OPERATORS, ...SHORT_CIRCUIT_ASSIGNMENTS]),
		parents: new Set(["binary_expression", "augmented_assignment_expression"]),
	},
};

/**
 * The file being parsed: each scope's own complexity from one walk, set by
 * parseScript around extraction so each extracted function reads its `cc`
 * without walking its body again.
 */
let fileCc: FileComplexity | null = null;

/** A function's own complexity: from the file's walk, or its own walk outside one. */
function ccOf(node: SyntaxNode): number {
	return (
		fileCc?.ccAt.get(node.startIndex) ?? ownComplexity(node, TS_COMPLEXITY)
	);
}

/**
 * File extensions read with the plain TypeScript grammar. Only TypeScript's
 * own extensions can't hold JSX, and the TSX grammar would misread their
 * `<T>x` casts.
 */
const TS_ONLY_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);

/** File extensions treated as JavaScript (`language`). */
const JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);

/** Max length for extractable scalar constant values. */
const MAX_CONSTANT_VALUE_LENGTH = 128;

/**
 * Extract top-level const declarations from the program root.
 * Only captures constants at module scope — not inside functions.
 * Skips constants whose names match secret-like patterns (defense-in-depth).
 */
function extractConstants(rootNode: SyntaxNode): ParsedConstant[] {
	const constants: ParsedConstant[] = [];

	// Walk only top-level children (not recursive)
	for (const child of rootNode.children) {
		if (
			child.type === "lexical_declaration" ||
			child.type === "variable_declaration"
		) {
			readConstants(child, false, constants);
		} else if (child.type === "export_statement") {
			for (const inner of child.children) {
				if (
					inner.type === "lexical_declaration" ||
					inner.type === "variable_declaration"
				) {
					readConstants(inner, true, constants);
				}
			}
		}
	}

	return constants;
}

/** Push each constant a `const` declaration declares (not let/var) onto `constants`. */
function readConstants(
	node: SyntaxNode,
	isExported: boolean,
	constants: ParsedConstant[],
): void {
	// Only const declarations (not let/var)
	if (!node.children.some((c) => c.type === "const")) return;

	for (const declarator of node.children) {
		if (declarator.type !== "variable_declarator") continue;
		const constant = readConstant(declarator, node, isExported);
		if (constant) constants.push(constant);
	}
}

/**
 * One declarator of a `const` declaration `node` as a ParsedConstant, or null
 * for a destructuring pattern, a secret-like name or a function value.
 */
function readConstant(
	declarator: SyntaxNode,
	node: SyntaxNode,
	isExported: boolean,
): ParsedConstant | null {
	const nameNode = declarator.childForFieldName("name");
	if (!nameNode || nameNode.type !== "identifier") return null;

	// Skip constants with secret-like names (defense-in-depth)
	if (SECRET_NAME_SUFFIX.test(nameNode.text)) return null;

	const valueNode = declarator.childForFieldName("value");

	// Function-valued bindings are already handled as ParsedFunction.
	if (valueNode && FUNCTION_VALUE_TYPES.has(valueNode.type)) return null;

	const typeNode = declarator.childForFieldName("type");
	return {
		name: nameNode.text,
		value: scalarValue(valueNode),
		// type_annotation wraps `: Type` — strip the leading colon
		typeAnnotation: typeNode ? typeNode.text.replace(/^:\s*/, "") : null,
		isExported,
		lineStart: node.startPosition.row + 1,
		lineEnd: node.endPosition.row + 1,
	};
}

/**
 * A constant's scalar value, unwrapping `as const` / `satisfies Type`: a
 * string or template string without quotes, or a number, as written. Null
 * for anything else, or a value over MAX_CONSTANT_VALUE_LENGTH.
 */
function scalarValue(valueNode: SyntaxNode | null): string | null {
	let inner = valueNode;
	while (
		inner?.type === "as_expression" ||
		inner?.type === "satisfies_expression"
	) {
		inner = inner.children[0] ?? null;
	}
	if (!inner) return null;
	const text = scalarText(inner);
	return text !== null && text.length <= MAX_CONSTANT_VALUE_LENGTH
		? text
		: null;
}

/** A scalar literal's text without its quotes, or null when `node` isn't one. */
function scalarText(node: SyntaxNode): string | null {
	if (node.type === "string") return node.text.replace(/^['"`]|['"`]$/g, "");
	if (node.type === "number") return node.text;
	// A template string with no `${}` is a plain string
	if (
		node.type === "template_string" &&
		!node.children.some((c) => c.type === "template_substitution")
	) {
		return node.text.replace(/^`|`$/g, "");
	}
	return null;
}

/**
 * Parses a TypeScript, JavaScript or Vue (.vue) file into its structural metadata.
 * @param absolutePath - The file to read
 * @param relativePath - Its path in the repo, as recorded in the result
 * @param onTree - Optional: also receives the syntax tree before it is freed.
 *   For a .vue file it is the tree of toScriptSource's code, whose rows are
 *   the .vue file's rows.
 * @returns The file's functions, classes, imports, exports and constants
 */
export function parseFile(
	absolutePath: string,
	relativePath: string,
	onTree?: OnTree,
): ParsedFile {
	const source = fs.readFileSync(absolutePath, "utf-8");
	const ext = extensionOf(relativePath);
	if (ext === ".vue") return parseVue(source, relativePath, onTree);
	return parseScript(source, relativePath, ext, onTree);
}

/**
 * The code to parse for a file in place of its text, so a tree built
 * elsewhere (like Pharaoh's call tracer's) matches the one parseFile reads:
 * a .vue file's script blocks laid over blank text at their original
 * positions, and any other file unchanged.
 * @param relativePath - The file's path, whose extension says how to read it
 * @param source - The file's text
 * @returns The code, and the extension its script is written in (picks the grammar)
 */
export function toScriptSource(
	relativePath: string,
	source: string,
): ScriptSource {
	const ext = extensionOf(relativePath);
	return ext === ".vue"
		? readVueSfc(source, relativePath).script
		: { code: source, ext };
}

function extensionOf(relativePath: string): string {
	return relativePath.slice(relativePath.lastIndexOf("."));
}

/**
 * Parses TypeScript or JavaScript source.
 * @param ext - The script's extension, which picks the grammar and `language`
 * @param extend - Adds to the result while the tree is alive, before onTree sees it
 */
function parseScript(
	source: string,
	relativePath: string,
	ext: string,
	onTree?: OnTree,
	extend?: OnTree,
): ParsedFile {
	const isJs = JS_EXTENSIONS.has(ext);
	// Keep JavaScript on the upstream grammar so comparisons stay comparisons.
	const parser = isJs
		? jsParser
		: TS_ONLY_EXTENSIONS.has(ext)
			? tsParser
			: tsxParser;
	const tree = parser.parse(source);
	if (!tree) throw new Error(`Failed to parse ${relativePath}`);

	// tree.delete() MUST be called to free WASM memory. Without it, each parsed
	// file leaks its full AST in the WASM heap — after ~800 files the heap
	// exhausts and Emscripten calls abort(), killing the worker process.
	try {
		const lines = source.split("\n");

		const functions: ParsedFunction[] = [];
		const classes: ParsedClass[] = [];
		const imports: ParsedImport[] = [];
		const exports: ParsedExport[] = [];

		const complexity = fileComplexity(tree.rootNode, TS_COMPLEXITY);
		fileCc = complexity;
		try {
			extractFromNode(
				tree.rootNode,
				source,
				functions,
				classes,
				imports,
				exports,
			);
		} finally {
			fileCc = null;
		}

		// Extract top-level constants (separate pass — only program scope)
		const constants = extractConstants(tree.rootNode);

		// Determine language from extension
		let language: ParsedFile["language"];
		if (isJs) {
			language = ext === ".jsx" ? "jsx" : "javascript";
		} else {
			language = ext === ".tsx" ? "tsx" : "typescript";
		}

		const parsed: ParsedFile = {
			path: relativePath,
			language,
			loc: lines.length,
			functions,
			excess: complexity.excess,
			classes,
			imports,
			exports,
			...(constants.length > 0 ? { constants } : {}),
		};
		extend?.(tree.rootNode, parsed);
		onTree?.(tree.rootNode, parsed);
		return parsed;
	} finally {
		tree.delete();
	}
}

/**
 * Parses a .vue file: its script blocks, read at their positions in the file
 * (see toScriptSource), plus the component and what its template uses.
 */
function parseVue(
	source: string,
	relativePath: string,
	onTree?: OnTree,
): ParsedFile {
	const sfc = readVueSfc(source, relativePath);
	return parseScript(
		sfc.script.code,
		relativePath,
		sfc.script.ext,
		onTree,
		(root, parsed) => addVueComponent(root, sfc, parsed),
	);
}

/**
 * Add what makes a parsed script a Vue component:
 * - the component, as a default-exported class named after the file (a class
 *   component, `export default class X extends Vue`, is already one), so a
 *   parent's `import UserCard from "./UserCard.vue"` and `<UserCard/>` resolve
 *   to it;
 * - Options API members (methods, computed, watchers, hooks) as its methods;
 * - `<script src>` as an import;
 * - templateRefs: the script names the template uses, and the Options API
 *   members the Vue runtime calls itself.
 */
function addVueComponent(
	root: SyntaxNode,
	sfc: VueSfc,
	parsed: ParsedFile,
): void {
	parsed.language = "vue";
	const classComponent = parsed.exports.find(
		(e) => e.isDefault && e.kind === "class",
	)?.name;
	const componentName = classComponent ?? componentNameFromPath(parsed.path);

	const options = readOptionsApi(root);
	const targets = addOptionsMembers(
		options,
		sfc.script.code,
		parsed,
		componentName,
	);
	// What a template name reaches on the class. A class component's own
	// methods first; Vue 3 then defines Options methods, then computed
	// properties, so a computed wins over a method of the same name.
	const members = new Map<string, MemberTargets>();
	if (classComponent) {
		addClassComponentMembers(
			parsed.functions,
			classComponent,
			members,
			targets.runtimeRefs,
		);
	} else {
		addComponentClass(parsed, componentName);
	}

	if (sfc.scriptSrc) {
		parsed.imports.push({
			source: sfc.scriptSrc.source,
			symbols: [],
			isDefault: false,
			isNamespace: false,
			line: sfc.scriptSrc.line,
		});
	}

	for (const [key, reached] of [...targets.methods, ...targets.computed]) {
		members.set(key, reached);
	}
	const { refs, unverified } = readTemplateRefs(
		sfc.descriptor,
		templateScope(root, sfc, options, members, componentName),
	);
	const templateRefs = [...refs, ...targets.runtimeRefs];
	if (templateRefs.length > 0) parsed.templateRefs = templateRefs;
	if (unverified.length > 0) parsed.unverifiedTemplateRefs = unverified;
}

/** What a component's Options API members add (see addVueComponent). */
interface OptionsTargets {
	/** Members and watchers the Vue runtime calls itself, in the order they are found. */
	runtimeRefs: ParsedTemplateRef[];
	/** What each Options method's key reaches. */
	methods: Map<string, MemberTargets>;
	/** What each computed property's key reaches: its getter and setter. */
	computed: Map<string, MemberTargets>;
}

/**
 * Extract the Options API members holding a function as methods of the
 * component class, each under a name the class doesn't have yet, and record
 * what each member's key reaches and which ones the Vue runtime calls,
 * watchers included.
 */
function addOptionsMembers(
	options: OptionsApi | null,
	source: string,
	parsed: ParsedFile,
	componentName: string,
): OptionsTargets {
	const targets: OptionsTargets = {
		runtimeRefs: [],
		methods: new Map(),
		computed: new Map(),
	};
	const taken = new Set(
		parsed.functions
			.filter((f) => f.className === componentName)
			.map((f) => f.name),
	);
	for (const member of options?.members ?? []) {
		const fn = extractOptionsMember(
			member,
			uniqueName(member.name, taken),
			source,
			parsed.functions,
			componentName,
		);
		if (!fn) continue;
		taken.add(fn.name);
		recordMember(targets, member, fn, componentName);
	}
	for (const { name, line, isMethod } of options?.watcherTargets ?? []) {
		targets.runtimeRefs.push(
			isMethod
				? {
						name: targets.methods.get(name)?.read ?? name,
						kind: "runtime",
						line,
						className: componentName,
					}
				: { name, kind: "runtime", line },
		);
	}
	return targets;
}

/** Record what an extracted Options member reaches: a runtime call, a computed's accessor, or a method. */
function recordMember(
	targets: OptionsTargets,
	member: OptionsMember,
	fn: ParsedFunction,
	componentName: string,
): void {
	if (member.reach === "runtime") {
		targets.runtimeRefs.push({
			name: fn.name,
			kind: "runtime",
			line: fn.lineStart,
			className: componentName,
		});
	} else if (member.role === "get" || member.role === "set") {
		const accessors = targets.computed.get(member.key) ?? {};
		if (member.role === "get") accessors.read = fn.name;
		else accessors.write = fn.name;
		targets.computed.set(member.key, accessors);
	} else {
		targets.methods.set(member.key, { read: fn.name });
	}
}

/** A class component's methods as what template names reach, and its lifecycle hooks as runtime calls. */
function addClassComponentMembers(
	functions: ParsedFunction[],
	classComponent: string,
	members: Map<string, MemberTargets>,
	runtimeRefs: ParsedTemplateRef[],
): void {
	for (const fn of functions) {
		if (fn.className !== classComponent) continue;
		members.set(fn.name, { read: fn.name });
		if (isClassComponentHook(fn.name, fn.decorators)) {
			runtimeRefs.push({
				name: fn.name,
				kind: "runtime",
				line: fn.lineStart,
				className: classComponent,
			});
		}
	}
}

/** Add the component as a default-exported class spanning the file, its methods the functions named on it. */
function addComponentClass(parsed: ParsedFile, componentName: string): void {
	const methods = parsed.functions
		.filter((f) => f.className === componentName)
		.map((f) => f.name);
	parsed.classes.push({
		name: componentName,
		lineStart: 1,
		lineEnd: parsed.loc,
		...computeClassMetrics(componentName, 1, parsed.loc, parsed.functions),
		isExported: true,
		methods: [...new Set(methods)],
	});
	// `export default { ... }` was recorded with the object's source as its name
	parsed.exports = [
		...parsed.exports.filter((e) => !e.isDefault),
		{ name: componentName, kind: "class", isDefault: true },
	];
}

/** What the component's template can name: `<script setup>` bindings, its members, and its registered aliases, components and directives. */
function templateScope(
	root: SyntaxNode,
	sfc: VueSfc,
	options: OptionsApi | null,
	members: Map<string, MemberTargets>,
	componentName: string,
): TemplateScope {
	return {
		setup: sfc.hasScriptSetup
			? readSetupBindings(root)
			: { names: new Set(), namespaces: new Set() },
		members,
		aliases: options?.aliases ?? new Map(),
		componentName,
		components: options?.components ?? new Map(),
		directives: options?.directives ?? new Map(),
	};
}

/** `name`, or `name#2`, `name#3`... when the class already has a function by that name. */
function uniqueName(name: string, taken: ReadonlySet<string>): string {
	if (!taken.has(name)) return name;
	let n = 2;
	while (taken.has(`${name}#${n}`)) n++;
	return `${name}#${n}`;
}

/**
 * Extract an Options API member holding a function (`save() {}`,
 * `save: function () {}`, a computed's `get() {}`, a function in a watcher
 * array) as a method of the component class, named `name`. Returns undefined
 * when its value is not a function.
 */
function extractOptionsMember(
	member: OptionsMember,
	name: string,
	source: string,
	functions: ParsedFunction[],
	className: string,
): ParsedFunction | undefined {
	const { node, role } = member;
	const value = node.type === "pair" ? node.childForFieldName("value") : node;
	const fnNode =
		node.type === "method_definition"
			? node
			: value && FUNCTION_VALUE_TYPES.has(value.type)
				? value
				: null;
	if (!fnNode) return undefined;
	// An accessor or watcher reads as its role: `get total()`, `watch draft(value)`
	const signature = buildSignature(
		fnNode,
		source,
		name,
		role ? "" : "function ",
	);
	if (node.type === "method_definition") {
		const fn = extractMethod(
			node,
			source,
			functions,
			className,
			undefined,
			name,
		);
		if (fn) fn.signature = signature;
		return fn;
	}
	return pushFunctionValue(node, name, fnNode, source, functions, className, {
		signature,
		decorators: [],
	});
}

function extractFromNode(
	node: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	classes: ParsedClass[],
	imports: ParsedImport[],
	exports: ParsedExport[],
	currentClassName?: string,
): void {
	switch (node.type) {
		case "function_declaration":
			extractFunction(node, source, functions, exports, currentClassName);
			break;

		case "class_declaration":
			extractClass(node, source, classes, functions, exports);
			return; // Don't recurse — extractClass handles children

		case "lexical_declaration":
		case "variable_declaration":
			extractVariableDeclaration(node, source, functions, exports);
			extractDynamicImports(node, imports);
			extractRequireCalls(node, imports);
			break;

		case "export_statement":
			extractExportStatement(
				node,
				source,
				functions,
				classes,
				imports,
				exports,
			);
			return; // Don't recurse — handled inside

		case "import_statement":
			extractImport(node, imports);
			break;

		case "method_definition":
			if (currentClassName) {
				extractMethod(node, source, functions, currentClassName);
			}
			break;

		case "enum_declaration":
			extractEnum(node, exports);
			break;
	}

	// Recurse into children (except for nodes handled above)
	for (const child of node.children) {
		extractFromNode(
			child,
			source,
			functions,
			classes,
			imports,
			exports,
			currentClassName,
		);
	}
}

function extractJSDoc(node: SyntaxNode): string | undefined {
	// Walk backward through siblings looking for a JSDoc comment
	let sibling = node.previousNamedSibling;
	// Also check the parent if this node is inside an export_statement
	const target = node.parent?.type === "export_statement" ? node.parent : node;
	if (!sibling) {
		sibling = target.previousNamedSibling;
	}

	while (sibling) {
		if (sibling.type === "comment" && sibling.text.startsWith("/**")) {
			let text = sibling.text;
			// Strip /** and */
			text = text.replace(/^\/\*\*\s*/, "").replace(/\s*\*\/\s*$/, "");
			// Strip leading * on each line
			text = text
				.split("\n")
				.map((line) => line.replace(/^\s*\*\s?/, ""))
				.join(" ")
				.trim();
			// Truncate to 200 chars
			if (text.length > 200) {
				text = `${text.slice(0, 197)}...`;
			}
			return text || undefined;
		}
		// Stop if we hit a non-comment node (there's code between us and the comment)
		if (sibling.type !== "comment") break;
		sibling = sibling.previousNamedSibling;
	}

	return undefined;
}

export function computeBodyHash(node: SyntaxNode): string {
	return computeBodyHashShared(node, ["{}"]);
}

const TS_PARAM_TYPES = [
	"required_parameter",
	"optional_parameter",
	"rest_parameter",
];

export function countParams(node: SyntaxNode): number {
	return countParamsShared(node, TS_PARAM_TYPES);
}

/** Curated intrinsic HTML elements commonly wrapped by design system components. */
const JSX_INTRINSIC_SET = new Set([
	"button",
	"input",
	"select",
	"textarea",
	"a",
	"img",
	"table",
	"form",
	"dialog",
]);

/**
 * Extract destructured parameter names from a function's parameter list.
 * e.g. `({ variant, size, onClick }: ButtonProps)` → ["variant", "size", "onClick"]
 */
function extractDestructuredParams(node: SyntaxNode): string[] | undefined {
	const paramsNode = node.childForFieldName("parameters");
	if (!paramsNode) return undefined;

	for (const param of paramsNode.children) {
		if (
			param.type !== "required_parameter" &&
			param.type !== "optional_parameter"
		)
			continue;

		const pattern = param.childForFieldName("pattern");
		if (pattern?.type !== "object_pattern") continue;

		const names: string[] = [];
		for (const child of pattern.children) {
			if (child.type === "shorthand_property_identifier_pattern") {
				names.push(child.text);
			} else if (child.type === "pair_pattern") {
				const key = child.childForFieldName("key");
				if (key) names.push(key.text);
			} else if (child.type === "object_assignment_pattern") {
				// Destructured param with default value: `{ variant = "primary" }`
				const left = child.childForFieldName("left");
				if (left) names.push(left.text);
			} else if (child.type === "rest_pattern") {
				// Rest element: `{ ...rest }`
				const ident = child.children.find((c) => c.type === "identifier");
				if (ident) names.push(ident.text);
			}
		}
		return names.length > 0 ? names : undefined;
	}
	return undefined;
}

/**
 * Extract the type annotation name from the first parameter.
 * e.g. `(props: ButtonProps)` → "ButtonProps", `({ x }: Opts)` → "Opts"
 */
function extractPropsType(node: SyntaxNode): string | undefined {
	const paramsNode = node.childForFieldName("parameters");
	if (!paramsNode) return undefined;

	for (const param of paramsNode.children) {
		if (
			param.type !== "required_parameter" &&
			param.type !== "optional_parameter"
		)
			continue;

		const typeNode = param.childForFieldName("type");
		if (!typeNode) return undefined;

		// type_annotation wraps `: TypeName` — find the type identifier inside
		for (const child of typeNode.children) {
			if (child.type === "type_identifier" || child.type === "generic_type") {
				return child.text;
			}
		}
		return undefined;
	}
	return undefined;
}

/**
 * Walk a function body and collect curated intrinsic JSX elements.
 * Returns deduplicated array of lowercase tag names from JSX_INTRINSIC_SET, or undefined.
 */
function extractJsxIntrinsics(node: SyntaxNode): string[] | undefined {
	const bodyNode = node.childForFieldName("body");
	if (!bodyNode) return undefined;

	const found = new Set<string>();

	function walk(n: SyntaxNode): void {
		if (
			n.type === "jsx_opening_element" ||
			n.type === "jsx_self_closing_element"
		) {
			const tagNode = n.childForFieldName("name");
			if (tagNode?.type === "identifier") {
				const tag = tagNode.text;
				if (JSX_INTRINSIC_SET.has(tag)) {
					found.add(tag);
				}
			}
		}
		for (const child of n.children) {
			walk(child);
		}
	}

	walk(bodyNode);
	return found.size > 0 ? [...found] : undefined;
}

/** Build optional props metadata (destructuredParams, propsType, jsxIntrinsics) for a function node. */
function buildPropsMetadata(
	node: SyntaxNode,
): Pick<ParsedFunction, "destructuredParams" | "propsType" | "jsxIntrinsics"> {
	const destructuredParams = extractDestructuredParams(node);
	const propsType = extractPropsType(node);
	const jsxIntrinsics = extractJsxIntrinsics(node);
	return {
		...(destructuredParams ? { destructuredParams } : {}),
		...(propsType ? { propsType } : {}),
		...(jsxIntrinsics ? { jsxIntrinsics } : {}),
	};
}

/** Compute shared metadata fields for a function or method node. */
function buildFunctionMetadata(
	node: SyntaxNode,
	source: string,
	name?: string,
) {
	const signature = buildSignature(node, source, name);
	const bodyHash = computeBodyHash(node);
	const complexity = computeComplexity(node);
	const cc = ccOf(node);
	const paramCount = countParams(node);
	const errorFlow = detectErrorFlow(node);
	const jsdoc = extractJSDoc(node);
	const isAsync = source
		.slice(node.startIndex, node.endIndex)
		.startsWith("async");
	return {
		signature,
		sourceStart: node.startIndex,
		sourceEnd: node.endIndex,
		lineStart: node.startPosition.row + 1,
		lineEnd: node.endPosition.row + 1,
		loc: node.endPosition.row - node.startPosition.row + 1,
		complexity,
		isAsync,
		jsdoc,
		bodyHash,
		paramCount,
		cc,
		throws: errorFlow.throws || undefined,
		hasTryCatch: errorFlow.hasTryCatch || undefined,
	};
}

function extractFunction(
	node: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	exports: ParsedExport[],
	className?: string,
): void {
	const nameNode = node.childForFieldName("name");
	if (!nameNode) return;

	const name = nameNode.text;
	const isExported = node.parent?.type === "export_statement";

	functions.push({
		name,
		...buildFunctionMetadata(node, source),
		...buildPropsMetadata(node),
		isExported,
		className,
	});

	if (isExported) {
		exports.push({
			name,
			kind: "function",
			isDefault: isDefaultExportDeclaration(node),
		});
	}
}

/** Whether a declaration is the module's default export (`export default function X`). */
function isDefaultExportDeclaration(node: SyntaxNode): boolean {
	return (
		node.parent?.type === "export_statement" &&
		node.parent.children.some((c) => c.type === "default")
	);
}

/**
 * Extract a method as a function of `className`.
 * @param name - Overrides the method's own name (a computed property's getter is named after the property)
 */
function extractMethod(
	node: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	className: string,
	decorators?: string[],
	name = node.childForFieldName("name")?.text,
): ParsedFunction | undefined {
	if (!name) return undefined;

	const fn: ParsedFunction = {
		name,
		...buildFunctionMetadata(node, source, name),
		...buildPropsMetadata(node),
		isExported: false,
		className,
		...(decorators ? { decorators } : {}),
	};
	functions.push(fn);
	return fn;
}

/** Syntax node types for functions assigned to bindings, fields, and properties. */
const FUNCTION_VALUE_TYPES = new Set([
	"arrow_function",
	"function_expression",
	"function",
]);

/**
 * Extract a class field whose value is a function as a method of the class.
 * Express and DI-style classes bind handlers this way
 * (`createUser = async (req, res) => { ... }`). Decorators may be children of
 * the field (TypeScript) or preceding siblings (passed in). Returns the field
 * name when it held a function, otherwise undefined (data fields are skipped).
 */
function extractFieldFunction(
	field: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	className: string,
	siblingDecorators: string[],
): string | undefined {
	const nameNode =
		field.childForFieldName("name") ?? field.childForFieldName("property");
	const valueNode = field.childForFieldName("value");
	if (!nameNode || !valueNode || !FUNCTION_VALUE_TYPES.has(valueNode.type)) {
		return undefined;
	}

	const decorators = [...siblingDecorators];
	for (const child of field.children) {
		if (child.type === "decorator") decorators.push(decoratorText(child));
	}

	const name = nameNode.text;
	const isAsync = source
		.slice(valueNode.startIndex, valueNode.endIndex)
		.startsWith("async");
	const paramsNode = valueNode.childForFieldName("parameters");
	const returnTypeNode = valueNode.childForFieldName("return_type");
	const signature = `${isAsync ? "async " : ""}${name} = ${paramsNode?.text ?? "()"}${
		returnTypeNode ? `: ${returnTypeNode.text.replace(/^:\s*/, "")}` : ""
	} => ...`;

	pushFunctionValue(field, name, valueNode, source, functions, className, {
		signature,
		decorators,
	});
	return name;
}

/**
 * Push a function held as a value (a class field's or an object member's) as
 * a method of `className`. It spans from its holder (the field or pair, where
 * a decorator or doc comment sits) to the end of the value.
 */
function pushFunctionValue(
	holder: SyntaxNode,
	name: string,
	valueNode: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	className: string,
	{ signature, decorators }: { signature: string; decorators: string[] },
): ParsedFunction {
	const fn: ParsedFunction = {
		name,
		signature,
		sourceStart: holder.startIndex,
		sourceEnd: valueNode.endIndex,
		lineStart: holder.startPosition.row + 1,
		lineEnd: valueNode.endPosition.row + 1,
		loc: valueNode.endPosition.row - holder.startPosition.row + 1,
		complexity: computeComplexity(valueNode),
		isExported: false,
		isAsync: source
			.slice(valueNode.startIndex, valueNode.endIndex)
			.startsWith("async"),
		jsdoc: extractJSDoc(holder),
		bodyHash: computeBodyHash(valueNode),
		paramCount: countParams(valueNode),
		cc: ccOf(valueNode),
		...buildPropsMetadata(valueNode),
		className,
		...(decorators.length > 0 ? { decorators } : {}),
	};
	functions.push(fn);
	return fn;
}

function extractClass(
	node: SyntaxNode,
	source: string,
	classes: ParsedClass[],
	functions: ParsedFunction[],
	exports: ParsedExport[],
	parentDecorators?: string[],
): void {
	const nameNode = node.childForFieldName("name");
	if (!nameNode) return;

	const name = nameNode.text;
	const isExported = node.parent?.type === "export_statement";
	const head = readClassHead(node, parentDecorators);
	// Find class body and extract methods (with decorator accumulation)
	const bodyNode = node.childForFieldName("body");
	const methods = bodyNode
		? readClassBody(bodyNode, source, functions, name)
		: [];

	const lineStart = node.startPosition.row + 1;
	const lineEnd = node.endPosition.row + 1;
	const { loc, complexity } = computeClassMetrics(
		name,
		lineStart,
		lineEnd,
		functions,
	);

	classes.push({
		name,
		lineStart,
		lineEnd,
		loc,
		complexity,
		isExported,
		methods,
		extends: head.extendsName,
		implements:
			head.implementsNames.length > 0 ? head.implementsNames : undefined,
		decorators: head.decorators.length > 0 ? head.decorators : undefined,
	});

	if (isExported) {
		exports.push({
			name,
			kind: "class",
			isDefault: isDefaultExportDeclaration(node),
		});
	}
}

/** A decorator's text, trimmed and cut to 500 characters. */
function decoratorText(decorator: SyntaxNode): string {
	const text = decorator.text.trim();
	return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

/** What a class declaration says before its body (see readClassHead). */
interface ClassHead {
	/** The class it extends, as written. */
	extendsName?: string;
	/** The types it implements, as written. */
	implementsNames: string[];
	/** Its decorators: the export statement's first, then its own. */
	decorators: string[];
}

/** Read a class's heritage (extends / implements) and class-level decorators. */
function readClassHead(
	node: SyntaxNode,
	parentDecorators: string[] | undefined,
): ClassHead {
	const head: ClassHead = {
		implementsNames: [],
		decorators: parentDecorators ? [...parentDecorators] : [],
	};
	for (const child of node.children) {
		if (child.type === "decorator") head.decorators.push(decoratorText(child));
		else if (child.type === "class_heritage") readHeritage(child, head);
	}
	return head;
}

/** Read a `class_heritage` node's extends and implements clauses into `head`. */
function readHeritage(heritage: SyntaxNode, head: ClassHead): void {
	for (const clause of heritage.children) {
		if (clause.type === "extends_clause") {
			const valueNode = clause.child(1);
			if (valueNode) head.extendsName = valueNode.text;
		} else if (clause.type === "implements_clause") {
			for (const typeNode of clause.children) {
				if (
					typeNode.type === "type_identifier" ||
					typeNode.type === "generic_type"
				) {
					head.implementsNames.push(typeNode.text);
				}
			}
		}
	}
}

/**
 * Extract a class body's methods and function-valued fields as functions of
 * `className`, each with the decorators just above it, and return their names.
 */
function readClassBody(
	bodyNode: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	className: string,
): string[] {
	const methods: string[] = [];
	let pendingDecorators: string[] = [];
	for (const child of bodyNode.children) {
		if (child.type === "decorator") {
			pendingDecorators.push(decoratorText(child));
		} else if (child.type === "method_definition") {
			const methodName = child.childForFieldName("name");
			if (methodName) {
				methods.push(methodName.text);
				extractMethod(
					child,
					source,
					functions,
					className,
					pendingDecorators.length > 0 ? pendingDecorators : undefined,
				);
			}
			pendingDecorators = [];
		} else if (
			child.type === "public_field_definition" ||
			child.type === "field_definition"
		) {
			const fieldName = extractFieldFunction(
				child,
				source,
				functions,
				className,
				pendingDecorators,
			);
			if (fieldName) methods.push(fieldName);
			pendingDecorators = [];
		}
	}
	return methods;
}

/**
 * Extract enum declarations as type exports.
 * Handles both `enum Foo { ... }` and `const enum Foo { ... }`.
 */
function extractEnum(node: SyntaxNode, exports: ParsedExport[]): void {
	const nameNode = node.childForFieldName("name");
	if (!nameNode) return;

	const isExported = node.parent?.type === "export_statement";
	if (isExported) {
		exports.push({ name: nameNode.text, kind: "type", isDefault: false });
	}
}

function extractVariableDeclaration(
	node: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	exports: ParsedExport[],
): void {
	for (const declarator of node.children) {
		if (declarator.type !== "variable_declarator") continue;

		const nameNode = declarator.childForFieldName("name");
		const valueNode = declarator.childForFieldName("value");

		if (!nameNode || !valueNode) continue;

		const isExported = node.parent?.type === "export_statement";

		if (
			nameNode.type === "identifier" &&
			FUNCTION_VALUE_TYPES.has(valueNode.type)
		) {
			// A function is identified by its file and name, which can't tell two
			// nested bindings of one name apart: a function expression is kept at
			// module scope only (arrows everywhere, as before).
			const scope = isExported ? node.parent?.parent : node.parent;
			if (valueNode.type !== "arrow_function" && scope?.type !== "program")
				continue;
			const name = nameNode.text;
			const isAsync = source
				.slice(valueNode.startIndex, valueNode.endIndex)
				.startsWith("async");
			const jsdoc = extractJSDoc(node);

			functions.push({
				name,
				signature: buildArrowSignature(nameNode, valueNode, source),
				sourceStart: declarator.startIndex,
				sourceEnd: valueNode.endIndex,
				lineStart: declarator.startPosition.row + 1,
				lineEnd: valueNode.endPosition.row + 1,
				loc: valueNode.endPosition.row - declarator.startPosition.row + 1,
				complexity: computeComplexity(valueNode),
				isExported,
				isAsync,
				jsdoc,
				bodyHash: computeBodyHash(valueNode),
				paramCount: countParams(valueNode),
				cc: ccOf(valueNode),
				...buildPropsMetadata(valueNode),
			});

			if (isExported) {
				exports.push({ name, kind: "function", isDefault: false });
			}
		} else if (isExported) {
			// Exported variables (e.g., `export const foo = new Foo()`)
			// Record in exports so downstream consumers (auto-vision, search) can see them.
			const name = nameNode.text;
			exports.push({
				name,
				kind: "variable",
				isDefault: false,
				className:
					valueNode.type === "new_expression"
						? (valueNode.childForFieldName("constructor")?.text ?? undefined)
						: undefined,
			});
		}
	}
}

/**
 * Extract CommonJS require() calls as imports.
 * Handles: `const x = require("./foo")` (namespace)
 * and `const { a, b } = require("./foo")` (destructured).
 * Only static string arguments are handled — dynamic require() is skipped.
 */
function extractRequireCalls(node: SyntaxNode, imports: ParsedImport[]): void {
	for (const declarator of node.children) {
		if (declarator.type !== "variable_declarator") continue;

		const nameNode = declarator.childForFieldName("name");
		const source = requiredSource(declarator.childForFieldName("value"));
		if (!nameNode || source === null) continue;

		// Extract symbols from the binding pattern
		const { symbols, isNamespace } = requireBindings(nameNode);
		if (symbols.length === 0) continue;

		imports.push({
			source,
			symbols,
			isDefault: false,
			isNamespace,
			line: node.startPosition.row + 1,
		});
	}
}

/** The path `require("./foo")` loads, when `value` is that call with a string; null otherwise. */
function requiredSource(value: SyntaxNode | null): string | null {
	// value must be a call_expression where function is `require`
	if (value?.type !== "call_expression") return null;
	const funcNode = value.childForFieldName("function");
	if (
		!funcNode ||
		funcNode.type !== "identifier" ||
		funcNode.text !== "require"
	) {
		return null;
	}
	return stringArgument(value);
}

/**
 * A call's first string literal argument without its quotes, or null when it
 * has none: a template string or a variable is skipped.
 */
function stringArgument(call: SyntaxNode): string | null {
	const argsNode = call.childForFieldName("arguments");
	const stringNode = argsNode?.children.find((c) => c.type === "string");
	return stringNode ? stringNode.text.replace(/['"]/g, "") : null;
}

/** The names a `require()` binds: `const x =` (the namespace) or `const { a, b: c } =` (its keys, `a` and `b`). */
function requireBindings(nameNode: SyntaxNode): {
	symbols: string[];
	isNamespace: boolean;
} {
	// const x = require("./foo")
	if (nameNode.type === "identifier") {
		return { symbols: [nameNode.text], isNamespace: true };
	}
	const symbols: string[] = [];
	if (nameNode.type !== "object_pattern")
		return { symbols, isNamespace: false };
	// const { a, b } = require("./foo")
	for (const child of nameNode.children) {
		if (child.type === "shorthand_property_identifier_pattern") {
			symbols.push(child.text);
		} else if (child.type === "pair_pattern") {
			const keyNode = child.childForFieldName("key");
			if (keyNode) symbols.push(keyNode.text);
		}
	}
	return { symbols, isNamespace: false };
}

function extractExportStatement(
	node: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	classes: ParsedClass[],
	imports: ParsedImport[],
	exports: ParsedExport[],
): void {
	// Check for default export
	const isDefault = node.children.some((c) => c.type === "default");
	const sourceNode = node.children.find(
		(c) => c.type === "string" || c.type === "string_fragment",
	);
	const exportClause = node.children.find((c) => c.type === "export_clause");
	if (
		sourceNode &&
		extractReExport(node, sourceNode, exportClause, imports, exports)
	) {
		return;
	}

	// Collect decorators from the export_statement (for exported decorated classes)
	const decorators = exportDecorators(node);
	// Handle exported declarations — recurse into the declaration
	for (const child of node.children) {
		extractExportedDeclaration(
			child,
			source,
			functions,
			classes,
			exports,
			isDefault,
			decorators,
		);
	}

	// Handle: export default <expression>
	if (isDefault && !exportClause) extractDefaultExpression(node, exports);
}

/**
 * Extract an export statement that re-exports from another module, and say
 * whether it was one:
 * - `export * from './foo'`: an import edge with the namespace wildcard;
 * - `export * as ns from './foo'`: an export named ns, and the import edge
 *   `import * as ns from './foo'` records;
 * - `export { X } from './foo'`: an export per name, and an import edge.
 */
function extractReExport(
	node: SyntaxNode,
	sourceNode: SyntaxNode,
	exportClause: SyntaxNode | undefined,
	imports: ParsedImport[],
	exports: ParsedExport[],
): boolean {
	const sourceText = sourceNode.text.replace(/['"]/g, "");
	if (node.children.some((c) => c.type === "*")) {
		imports.push({
			source: sourceText,
			symbols: ["*"],
			isDefault: false,
			isNamespace: true,
			line: node.startPosition.row + 1,
		});
		return true;
	}
	// The `*` of `export * as ns` sits inside namespace_export, not on the statement.
	const namespace = node.children.find((c) => c.type === "namespace_export")
		?.namedChildren[0]?.text;
	if (namespace) {
		exports.push({ name: namespace, kind: "re-export", isDefault: false });
		imports.push({
			source: sourceText,
			symbols: [namespace],
			isDefault: false,
			isNamespace: true,
			line: node.startPosition.row + 1,
		});
		return true;
	}
	if (!exportClause) return false;
	const symbols = reExportSymbols(exportClause, exports);
	// Create an import edge so the resolver can trace through re-exports
	if (symbols.length > 0) {
		imports.push({
			source: sourceText,
			symbols,
			isDefault: false,
			isNamespace: false,
			line: node.startPosition.row + 1,
		});
	}
	return true;
}

/**
 * Export each name an `export { ... } from` clause re-exports, under the name
 * the file exports it as, and return the original names for the import edge:
 * `export { default as Button } from './Button'` exports Button and imports default.
 */
function reExportSymbols(
	exportClause: SyntaxNode,
	exports: ParsedExport[],
): string[] {
	const symbols: string[] = [];
	for (const spec of exportClause.children) {
		if (spec.type !== "export_specifier") continue;
		const original = spec.childForFieldName("name");
		if (!original) continue;
		const exported = spec.childForFieldName("alias") ?? original;
		exports.push({ name: exported.text, kind: "re-export", isDefault: false });
		symbols.push(original.text);
	}
	return symbols;
}

/** An export statement's own decorators (`@Injectable() export class X`), or undefined when it has none. */
function exportDecorators(node: SyntaxNode): string[] | undefined {
	const decorators = node.children
		.filter((c) => c.type === "decorator")
		.map((c) => decoratorText(c));
	return decorators.length > 0 ? decorators : undefined;
}

/** Extract one declaration an export statement exports: a function, class, variables, type, interface or enum. */
function extractExportedDeclaration(
	child: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	classes: ParsedClass[],
	exports: ParsedExport[],
	isDefault: boolean,
	decorators: string[] | undefined,
): void {
	switch (child.type) {
		case "function_declaration":
			extractFunction(child, source, functions, exports);
			break;
		case "class_declaration":
			extractClass(child, source, classes, functions, exports, decorators);
			break;
		case "lexical_declaration":
		case "variable_declaration":
			extractVariableDeclaration(child, source, functions, exports);
			break;
		case "type_alias_declaration":
		case "interface_declaration": {
			const nameNode = child.childForFieldName("name");
			if (nameNode) {
				exports.push({ name: nameNode.text, kind: "type", isDefault });
			}
			break;
		}
		case "enum_declaration":
			extractEnum(child, exports);
			break;
	}
}

/** `export default app`: a default export of an expression, named by its text. */
function extractDefaultExpression(
	node: SyntaxNode,
	exports: ParsedExport[],
): void {
	const hasDecl = node.children.some(
		(c) =>
			c.type === "function_declaration" ||
			c.type === "class_declaration" ||
			c.type === "lexical_declaration",
	);
	if (hasDecl) return;
	const exprNode = node.children.find(
		(c) => c.type !== "export" && c.type !== "default" && c.type !== ";",
	);
	exports.push({
		name: exprNode?.text ?? "default",
		kind: "variable",
		isDefault: true,
	});
}

function extractImport(node: SyntaxNode, imports: ParsedImport[]): void {
	const sourceNode = node.childForFieldName("source");
	if (!sourceNode) return;

	const source = sourceNode.text.replace(/['"]/g, "");
	const symbols: string[] = [];
	let isDefault = false;
	let isNamespace = false;
	const aliases: { local: string; original: string }[] = [];

	// Declaration-level type-only: `import type { X } from '...'`
	const isTypeOnly = node.children.some((c) => c.type === "type");

	for (const child of node.children) {
		if (child.type === "import_clause") {
			for (const clauseChild of child.children) {
				if (clauseChild.type === "identifier") {
					// Default import
					isDefault = true;
					symbols.push(clauseChild.text);
				} else if (clauseChild.type === "named_imports") {
					for (const spec of clauseChild.children) {
						if (spec.type === "import_specifier") {
							const nameNode = spec.childForFieldName("name");
							const aliasNode = spec.childForFieldName("alias");
							if (aliasNode && nameNode) {
								// Renamed: `import { Foo as Bar }` → symbol is "Bar" (local name)
								symbols.push(aliasNode.text);
								aliases.push({
									local: aliasNode.text,
									original: nameNode.text,
								});
							} else if (nameNode) {
								symbols.push(nameNode.text);
							}
						}
					}
				} else if (clauseChild.type === "namespace_import") {
					isNamespace = true;
					const aliasNode = clauseChild.children.find(
						(c) => c.type === "identifier",
					);
					if (aliasNode) symbols.push(aliasNode.text);
				}
			}
		}
	}

	imports.push({
		source,
		symbols,
		isDefault,
		isNamespace,
		line: node.startPosition.row + 1,
		...(isTypeOnly ? { isTypeOnly } : {}),
		...(aliases.length > 0 ? { aliases } : {}),
	});
}

/**
 * Extract dynamic `await import("...")` expressions from variable declarations.
 * Handles: `const { a, b } = await import("./path")` (destructured)
 * and `const mod = await import("./path")` (namespace).
 * Bare `await import(...)` without assignment produces no ParsedImport (no symbols to match).
 */
function extractDynamicImports(
	node: SyntaxNode,
	imports: ParsedImport[],
): void {
	for (const declarator of node.children) {
		if (declarator.type !== "variable_declarator") continue;

		const nameNode = declarator.childForFieldName("name");
		const source = importedSource(declarator.childForFieldName("value"));
		if (!nameNode || source === null) continue;

		// Extract symbols from the binding pattern
		const { symbols, isNamespace, aliases } = dynamicImportBindings(nameNode);
		if (symbols.length === 0) continue;

		imports.push({
			source,
			symbols,
			isDefault: false,
			isNamespace,
			line: node.startPosition.row + 1,
			...(aliases.length > 0 ? { aliases } : {}),
		});
	}
}

/** The path `await import("./path")` loads, when `value` is that expression with a string; null otherwise. */
function importedSource(value: SyntaxNode | null): string | null {
	// value must be: await_expression → call_expression where function is `import`
	if (value?.type !== "await_expression") return null;
	const callExpr = value.children.find((c) => c.type === "call_expression");
	const funcNode = callExpr?.childForFieldName("function");
	if (!callExpr || funcNode?.type !== "import") return null;
	// Only handle static string literals — skip template strings with interpolation
	return stringArgument(callExpr);
}

/** What `await import()` binds (see dynamicImportBindings). */
interface ImportBindings {
	/** Local names. */
	symbols: string[];
	/** Whether the module is bound whole: `const mod =`. */
	isNamespace: boolean;
	/** Renamed bindings: `{ Foo: bar }`. */
	aliases: { local: string; original: string }[];
}

/** The names an `await import()` binds: `const mod =` (the namespace) or `const { a, Foo: bar } =` (local names, with aliases). */
function dynamicImportBindings(nameNode: SyntaxNode): ImportBindings {
	// const mod = await import("...")
	if (nameNode.type === "identifier") {
		return { symbols: [nameNode.text], isNamespace: true, aliases: [] };
	}
	const bindings: ImportBindings = {
		symbols: [],
		isNamespace: false,
		aliases: [],
	};
	if (nameNode.type !== "object_pattern") return bindings;
	// const { a, b } = await import("...")
	for (const child of nameNode.children) {
		if (child.type === "shorthand_property_identifier_pattern") {
			bindings.symbols.push(child.text);
		} else if (child.type === "pair_pattern") {
			// const { Foo: bar } = await import("...")
			const keyNode = child.childForFieldName("key");
			const valNode = child.childForFieldName("value");
			if (keyNode && valNode) {
				bindings.symbols.push(valNode.text);
				bindings.aliases.push({ local: valNode.text, original: keyNode.text });
			}
		}
	}
	return bindings;
}

/**
 * `async function name(params): ReturnType`.
 * @param name - Overrides the node's own name (for a function held by an object key)
 * @param keyword - What precedes the name: "function ", or "" when the name carries its role (`get total`)
 */
function buildSignature(
	node: SyntaxNode,
	source: string,
	name = node.childForFieldName("name")?.text ?? "anonymous",
	keyword = "function ",
): string {
	const paramsNode = node.childForFieldName("parameters");
	const returnTypeNode = node.childForFieldName("return_type");
	const isAsync = source
		.slice(node.startIndex, node.endIndex)
		.startsWith("async");

	let sig = "";
	if (isAsync) sig += "async ";
	sig += `${keyword}${name}`;
	sig += paramsNode?.text ?? "()";
	if (returnTypeNode) sig += `: ${returnTypeNode.text.replace(/^:\s*/, "")}`;

	return sig;
}

function buildArrowSignature(
	nameNode: SyntaxNode,
	arrowNode: SyntaxNode,
	source: string,
): string {
	const paramsNode = arrowNode.childForFieldName("parameters");
	const returnTypeNode = arrowNode.childForFieldName("return_type");
	const isAsync = source
		.slice(arrowNode.startIndex, arrowNode.endIndex)
		.startsWith("async");

	// `const f = function (a) {}` keeps its keyword: only an arrow gets `=> ...`.
	const arrow = arrowNode.type === "arrow_function";
	let sig = "";
	if (isAsync) sig += "async ";
	sig += `const ${nameNode.text} = ${arrow ? "" : "function "}`;
	sig += paramsNode?.text ?? "()";
	if (returnTypeNode) sig += `: ${returnTypeNode.text.replace(/^:\s*/, "")}`;
	if (arrow) sig += " => ...";

	return sig;
}

function computeComplexity(node: SyntaxNode): number {
	return computeComplexityShared(node, COMPLEXITY_TYPES, (n) => {
		if (n.type !== "binary_expression") return false;
		const op = n.childForFieldName("operator");
		return op ? COMPLEXITY_OPERATORS.has(op.text) : false;
	});
}

/** Detect whether a function throws or has try-catch blocks. */
function detectErrorFlow(node: SyntaxNode): {
	throws: boolean;
	hasTryCatch: boolean;
} {
	let throws = false;
	let hasTryCatch = false;

	function walk(n: SyntaxNode): void {
		if (n.type === "throw_statement" || n.type === "raise_statement") {
			throws = true;
		}
		if (n.type === "try_statement") {
			hasTryCatch = true;
		}
		for (const child of n.children) {
			walk(child);
		}
	}

	walk(node);
	return { throws, hasTryCatch };
}
