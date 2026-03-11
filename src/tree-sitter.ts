import fs from "node:fs";
import {
	computeBodyHash as computeBodyHashShared,
	computeComplexity as computeComplexityShared,
	countParams as countParamsShared,
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
import {
	Parser,
	type SyntaxNode,
	tsLanguage,
	tsxLanguage,
} from "./wasm-init.js";

const tsParser = new Parser();
tsParser.setLanguage(tsLanguage);

const tsxParser = new Parser();
tsxParser.setLanguage(tsxLanguage);

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

/** File extensions that should use the TSX parser (supports JSX syntax). */
const JSX_EXTENSIONS = new Set([".tsx", ".jsx"]);

/** File extensions treated as JavaScript (parsed with TS grammar, which is a superset). */
const JS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);

/** Max length for extractable scalar constant values. */
const MAX_CONSTANT_VALUE_LENGTH = 128;

/**
 * Secret-like name suffix pattern — constants whose names end with these
 * segments (after `_` or as the full name) are skipped to prevent accidental
 * credential storage in the knowledge graph. Defense-in-depth measure.
 */
const SECRET_NAME_SUFFIX = /(?:^|_)(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)$/i;

/**
 * Extract top-level const declarations from the program root.
 * Only captures constants at module scope — not inside functions.
 * Skips constants whose names match secret-like patterns (defense-in-depth).
 */
function extractConstants(rootNode: SyntaxNode): ParsedConstant[] {
	const constants: ParsedConstant[] = [];

	function processDeclaration(node: SyntaxNode, isExported: boolean): void {
		// Only const declarations (not let/var)
		if (!node.children.some((c) => c.type === "const")) return;

		for (const declarator of node.children) {
			if (declarator.type !== "variable_declarator") continue;

			const nameNode = declarator.childForFieldName("name");
			if (!nameNode || nameNode.type !== "identifier") continue;

			// Skip constants with secret-like names (defense-in-depth)
			if (SECRET_NAME_SUFFIX.test(nameNode.text)) continue;

			const valueNode = declarator.childForFieldName("value");

			// Skip arrow functions — already handled as ParsedFunction
			if (valueNode?.type === "arrow_function") continue;

			// Extract scalar value
			// Unwrap `as const` / `satisfies Type` to reach the inner scalar
			let value: string | null = null;
			let inner = valueNode;
			while (
				inner?.type === "as_expression" ||
				inner?.type === "satisfies_expression"
			) {
				inner = inner.children[0] ?? null;
			}
			if (inner) {
				if (inner.type === "string" || inner.type === "number") {
					const stripped =
						inner.type === "string"
							? inner.text.replace(/^['"`]|['"`]$/g, "")
							: inner.text;
					if (stripped.length <= MAX_CONSTANT_VALUE_LENGTH) {
						value = stripped;
					}
				} else if (
					inner.type === "template_string" &&
					!inner.children.some((c) => c.type === "template_substitution")
				) {
					const stripped = inner.text.replace(/^`|`$/g, "");
					if (stripped.length <= MAX_CONSTANT_VALUE_LENGTH) {
						value = stripped;
					}
				}
			}

			// Extract type annotation
			let typeAnnotation: string | null = null;
			const typeNode = declarator.childForFieldName("type");
			if (typeNode) {
				// type_annotation wraps `: Type` — strip the leading colon
				typeAnnotation = typeNode.text.replace(/^:\s*/, "");
			}

			constants.push({
				name: nameNode.text,
				value,
				typeAnnotation,
				isExported,
				lineStart: node.startPosition.row + 1,
				lineEnd: node.endPosition.row + 1,
			});
		}
	}

	// Walk only top-level children (not recursive)
	for (const child of rootNode.children) {
		if (
			child.type === "lexical_declaration" ||
			child.type === "variable_declaration"
		) {
			processDeclaration(child, false);
		} else if (child.type === "export_statement") {
			for (const inner of child.children) {
				if (
					inner.type === "lexical_declaration" ||
					inner.type === "variable_declaration"
				) {
					processDeclaration(inner, true);
				}
			}
		}
	}

	return constants;
}

export function parseFile(
	absolutePath: string,
	relativePath: string,
): ParsedFile {
	const source = fs.readFileSync(absolutePath, "utf-8");
	const ext = relativePath.slice(relativePath.lastIndexOf("."));
	const useJsx = JSX_EXTENSIONS.has(ext);
	const parser = useJsx ? tsxParser : tsParser;
	const tree = parser.parse(source);
	if (!tree) throw new Error(`Failed to parse ${relativePath}`);
	const lines = source.split("\n");

	const functions: ParsedFunction[] = [];
	const classes: ParsedClass[] = [];
	const imports: ParsedImport[] = [];
	const exports: ParsedExport[] = [];

	extractFromNode(tree.rootNode, source, functions, classes, imports, exports);

	// Extract top-level constants (separate pass — only program scope)
	const constants = extractConstants(tree.rootNode);

	// Determine language from extension
	const isJs = JS_EXTENSIONS.has(ext);
	let language: ParsedFile["language"];
	if (isJs) {
		language = ext === ".jsx" ? "jsx" : "javascript";
	} else {
		language = ext === ".tsx" ? "tsx" : "typescript";
	}

	return {
		path: relativePath,
		language,
		loc: lines.length,
		functions,
		classes,
		imports,
		exports,
		...(constants.length > 0 ? { constants } : {}),
	};
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
function buildFunctionMetadata(node: SyntaxNode, source: string) {
	const signature = buildSignature(node, source);
	const bodyHash = computeBodyHash(node);
	const complexity = computeComplexity(node);
	const paramCount = countParams(node);
	const errorFlow = detectErrorFlow(node);
	const jsdoc = extractJSDoc(node);
	const isAsync = source
		.slice(node.startIndex, node.endIndex)
		.startsWith("async");
	return {
		signature,
		lineStart: node.startPosition.row + 1,
		lineEnd: node.endPosition.row + 1,
		loc: node.endPosition.row - node.startPosition.row + 1,
		complexity,
		isAsync,
		jsdoc,
		bodyHash,
		paramCount,
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
		exports.push({ name, kind: "function", isDefault: false });
	}
}

function extractMethod(
	node: SyntaxNode,
	source: string,
	functions: ParsedFunction[],
	className: string,
	decorators?: string[],
): void {
	const nameNode = node.childForFieldName("name");
	if (!nameNode) return;

	const name = nameNode.text;

	functions.push({
		name,
		...buildFunctionMetadata(node, source),
		...buildPropsMetadata(node),
		isExported: false,
		className,
		...(decorators ? { decorators } : {}),
	});
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
	const methods: string[] = [];

	// Extract class heritage (extends / implements) and class-level decorators
	let extendsName: string | undefined;
	const implementsNames: string[] = [];
	const classDecorators: string[] = parentDecorators
		? [...parentDecorators]
		: [];
	for (const child of node.children) {
		if (child.type === "decorator") {
			let text = child.text.trim();
			if (text.length > 500) text = `${text.slice(0, 497)}...`;
			classDecorators.push(text);
		} else if (child.type === "class_heritage") {
			for (const clause of child.children) {
				if (clause.type === "extends_clause") {
					const valueNode = clause.child(1);
					if (valueNode) extendsName = valueNode.text;
				} else if (clause.type === "implements_clause") {
					for (const typeNode of clause.children) {
						if (
							typeNode.type === "type_identifier" ||
							typeNode.type === "generic_type"
						) {
							implementsNames.push(typeNode.text);
						}
					}
				}
			}
		}
	}

	// Find class body and extract methods (with decorator accumulation)
	const bodyNode = node.childForFieldName("body");
	if (bodyNode) {
		let pendingDecorators: string[] = [];
		for (const child of bodyNode.children) {
			if (child.type === "decorator") {
				let text = child.text.trim();
				if (text.length > 500) text = `${text.slice(0, 497)}...`;
				pendingDecorators.push(text);
			} else if (child.type === "method_definition") {
				const methodName = child.childForFieldName("name");
				if (methodName) {
					methods.push(methodName.text);
					extractMethod(
						child,
						source,
						functions,
						name,
						pendingDecorators.length > 0 ? pendingDecorators : undefined,
					);
				}
				pendingDecorators = [];
			}
		}
	}

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
		extends: extendsName,
		implements: implementsNames.length > 0 ? implementsNames : undefined,
		decorators: classDecorators.length > 0 ? classDecorators : undefined,
	});

	if (isExported) {
		exports.push({ name, kind: "class", isDefault: false });
	}
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

		if (valueNode.type === "arrow_function") {
			// Arrow functions assigned to const/let/var → treat as functions
			const name = nameNode.text;
			const isAsync = source
				.slice(valueNode.startIndex, valueNode.endIndex)
				.startsWith("async");
			const jsdoc = extractJSDoc(node);

			functions.push({
				name,
				signature: buildArrowSignature(nameNode, valueNode, source),
				lineStart: node.startPosition.row + 1,
				lineEnd: valueNode.endPosition.row + 1,
				loc: valueNode.endPosition.row - node.startPosition.row + 1,
				complexity: computeComplexity(valueNode),
				isExported,
				isAsync,
				jsdoc,
				bodyHash: computeBodyHash(valueNode),
				paramCount: countParams(valueNode),
				...buildPropsMetadata(valueNode),
			});

			if (isExported) {
				exports.push({ name, kind: "function", isDefault: false });
			}
		} else if (isExported) {
			// Exported non-arrow-function variables (e.g., `export const foo = new Foo()`)
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
		const valueNode = declarator.childForFieldName("value");
		if (!nameNode || !valueNode) continue;

		// value must be a call_expression where function is `require`
		if (valueNode.type !== "call_expression") continue;

		const funcNode = valueNode.childForFieldName("function");
		if (
			!funcNode ||
			funcNode.type !== "identifier" ||
			funcNode.text !== "require"
		)
			continue;

		// Extract the source path from arguments
		const argsNode = valueNode.childForFieldName("arguments");
		if (!argsNode) continue;

		const stringNode = argsNode.children.find((c) => c.type === "string");
		if (!stringNode) continue;

		const source = stringNode.text.replace(/['"]/g, "");

		// Extract symbols from the binding pattern
		const symbols: string[] = [];
		let isNamespace = false;

		if (nameNode.type === "object_pattern") {
			// const { a, b } = require("./foo")
			for (const child of nameNode.children) {
				if (child.type === "shorthand_property_identifier_pattern") {
					symbols.push(child.text);
				} else if (child.type === "pair_pattern") {
					const keyNode = child.childForFieldName("key");
					if (keyNode) symbols.push(keyNode.text);
				}
			}
		} else if (nameNode.type === "identifier") {
			// const x = require("./foo")
			isNamespace = true;
			symbols.push(nameNode.text);
		}

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

	// Handle: export * from './foo' (star re-export → import edge with namespace wildcard)
	const sourceNode = node.children.find(
		(c) => c.type === "string" || c.type === "string_fragment",
	);
	const hasStar = node.children.some((c) => c.type === "*");
	if (hasStar && sourceNode) {
		const sourceText = sourceNode.text.replace(/['"]/g, "");
		imports.push({
			source: sourceText,
			symbols: ["*"],
			isDefault: false,
			isNamespace: true,
			line: node.startPosition.row + 1,
		});
		return;
	}

	// Handle: export { X } from './foo' (named re-export → export + import edge)
	const exportClause = node.children.find((c) => c.type === "export_clause");

	if (exportClause && sourceNode) {
		const sourceText = sourceNode.text.replace(/['"]/g, "");
		const reExportSymbols: string[] = [];

		for (const spec of exportClause.children) {
			if (spec.type === "export_specifier") {
				const nameNode =
					spec.childForFieldName("name") ?? spec.childForFieldName("alias");
				if (nameNode) {
					exports.push({
						name: nameNode.text,
						kind: "re-export",
						isDefault: false,
					});
					// Use the original name (not alias) for the import edge
					const originalName = spec.childForFieldName("name");
					reExportSymbols.push(
						originalName ? originalName.text : nameNode.text,
					);
				}
			}
		}

		// Create an import edge so the resolver can trace through re-exports
		if (reExportSymbols.length > 0) {
			imports.push({
				source: sourceText,
				symbols: reExportSymbols,
				isDefault: false,
				isNamespace: false,
				line: node.startPosition.row + 1,
			});
		}
		return;
	}

	// Collect decorators from the export_statement (for exported decorated classes)
	const exportDecorators: string[] = [];
	for (const child of node.children) {
		if (child.type === "decorator") {
			let text = child.text.trim();
			if (text.length > 500) text = `${text.slice(0, 497)}...`;
			exportDecorators.push(text);
		}
	}

	// Handle exported declarations — recurse into the declaration
	for (const child of node.children) {
		switch (child.type) {
			case "function_declaration":
				extractFunction(child, source, functions, exports);
				break;
			case "class_declaration":
				extractClass(
					child,
					source,
					classes,
					functions,
					exports,
					exportDecorators.length > 0 ? exportDecorators : undefined,
				);
				break;
			case "lexical_declaration":
			case "variable_declaration":
				extractVariableDeclaration(child, source, functions, exports);
				break;
			case "type_alias_declaration": {
				const typeNameNode = child.childForFieldName("name");
				if (typeNameNode) {
					exports.push({
						name: typeNameNode.text,
						kind: "type",
						isDefault,
					});
				}
				break;
			}
			case "interface_declaration": {
				const ifaceNameNode = child.childForFieldName("name");
				if (ifaceNameNode) {
					exports.push({
						name: ifaceNameNode.text,
						kind: "type",
						isDefault,
					});
				}
				break;
			}
			case "enum_declaration":
				extractEnum(child, exports);
				break;
		}
	}

	// Handle: export default <expression>
	if (isDefault && !exportClause) {
		const hasDecl = node.children.some(
			(c) =>
				c.type === "function_declaration" ||
				c.type === "class_declaration" ||
				c.type === "lexical_declaration",
		);
		if (!hasDecl) {
			// Default export of an expression (e.g. export default app)
			const exprNode = node.children.find(
				(c) => c.type !== "export" && c.type !== "default" && c.type !== ";",
			);
			exports.push({
				name: exprNode?.text ?? "default",
				kind: "variable",
				isDefault: true,
			});
		}
	}
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
		const valueNode = declarator.childForFieldName("value");
		if (!nameNode || !valueNode) continue;

		// value must be: await_expression → call_expression where function is `import`
		if (valueNode.type !== "await_expression") continue;

		const callExpr = valueNode.children.find(
			(c) => c.type === "call_expression",
		);
		if (!callExpr) continue;

		const funcNode = callExpr.childForFieldName("function");
		if (!funcNode || funcNode.type !== "import") continue;

		// Extract the import source path from arguments
		const argsNode = callExpr.childForFieldName("arguments");
		if (!argsNode) continue;

		// Only handle static string literals — skip template strings with interpolation
		const stringNode = argsNode.children.find((c) => c.type === "string");
		if (!stringNode) continue;

		const source = stringNode.text.replace(/['"]/g, "");

		// Extract symbols from the binding pattern
		const symbols: string[] = [];
		let isNamespace = false;
		const aliases: { local: string; original: string }[] = [];

		if (nameNode.type === "object_pattern") {
			// const { a, b } = await import("...")
			for (const child of nameNode.children) {
				if (child.type === "shorthand_property_identifier_pattern") {
					symbols.push(child.text);
				} else if (child.type === "pair_pattern") {
					// const { Foo: bar } = await import("...")
					const keyNode = child.childForFieldName("key");
					const valNode = child.childForFieldName("value");
					if (keyNode && valNode) {
						symbols.push(valNode.text);
						aliases.push({ local: valNode.text, original: keyNode.text });
					}
				}
			}
		} else if (nameNode.type === "identifier") {
			// const mod = await import("...")
			isNamespace = true;
			symbols.push(nameNode.text);
		}

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

function buildSignature(node: SyntaxNode, source: string): string {
	const nameNode = node.childForFieldName("name");
	const paramsNode = node.childForFieldName("parameters");
	const returnTypeNode = node.childForFieldName("return_type");
	const isAsync = source
		.slice(node.startIndex, node.endIndex)
		.startsWith("async");

	let sig = "";
	if (isAsync) sig += "async ";
	sig += `function ${nameNode?.text ?? "anonymous"}`;
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

	let sig = "";
	if (isAsync) sig += "async ";
	sig += `const ${nameNode.text} = `;
	sig += paramsNode?.text ?? "()";
	if (returnTypeNode) sig += `: ${returnTypeNode.text.replace(/^:\s*/, "")}`;
	sig += " => ...";

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
