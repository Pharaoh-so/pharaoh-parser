export interface ParsedFunction {
	name: string;
	signature: string;
	lineStart: number;
	lineEnd: number;
	loc: number;
	complexity: number;
	isExported: boolean;
	isAsync: boolean;
	className?: string;
	jsdoc?: string;
	bodyHash: string;
	paramCount: number;
	throws?: boolean;
	hasTryCatch?: boolean;
	/** Decorator strings (e.g. ["@staticmethod", "@app.route(\"/api\")"] for Python, ["@Get()", "@Cached({ttl: 60})"] for TypeScript). */
	decorators?: string[];
	/** Destructured parameter names (e.g. ["variant", "size", "onClick"] from `{ variant, size, onClick }: ButtonProps`). */
	destructuredParams?: string[];
	/** Type annotation of the first parameter (e.g. "ButtonProps" from `props: ButtonProps`). */
	propsType?: string;
	/** Curated intrinsic HTML elements found in JSX (e.g. ["button", "input"]). */
	jsxIntrinsics?: string[];
}

export interface ParsedClass {
	name: string;
	lineStart: number;
	lineEnd: number;
	loc: number;
	complexity: number;
	isExported: boolean;
	methods: string[];
	extends?: string;
	implements?: string[];
	decorators?: string[];
}

export interface ParsedImport {
	source: string;
	symbols: string[];
	isDefault: boolean;
	isNamespace: boolean;
	line: number;
	/** True when the entire import is type-only (`import type { X }`). */
	isTypeOnly?: boolean;
	/** Renamed imports: `import { Foo as Bar }` → `[{ local: "Bar", original: "Foo" }]`. */
	aliases?: { local: string; original: string }[];
}

export interface ParsedExport {
	name: string;
	kind: "function" | "class" | "variable" | "type" | "re-export";
	isDefault: boolean;
	/** For kind: "variable" with `new ClassName()` — the instantiated class name */
	className?: string;
}

/**
 * Compute aggregate class metrics from its methods.
 * loc = lineEnd - lineStart + 1, complexity = sum of method complexities.
 */
export function computeClassMetrics(
	className: string,
	lineStart: number,
	lineEnd: number,
	functions: ParsedFunction[],
): { loc: number; complexity: number } {
	const loc = lineEnd - lineStart + 1;
	let complexity = 0;
	for (const fn of functions) {
		if (fn.className === className) {
			complexity += fn.complexity;
		}
	}
	return { loc, complexity };
}

/** A top-level `const` declaration extracted from a file. */
export interface ParsedConstant {
	name: string;
	/** Scalar value if extractable (string/number/simple template literal ≤128 chars), null otherwise. */
	value: string | null;
	/** Type annotation if present (e.g. "string", "Record<string, string>"). */
	typeAnnotation: string | null;
	isExported: boolean;
	lineStart: number;
	lineEnd: number;
}

/**
 * What a Vue template reference points at: a script binding or import
 * (`name`), a member of one (`receiver.name`), or a function of the component
 * class (`className.name`, as on ParsedFunction). For an Options API computed
 * property `name` is its accessor: `get total` for a read, `set total` for a
 * write.
 */
export interface ParsedRefTarget {
	name: string;
	/** For `api.save()` or `<Form.Input>`: the script binding `name` is a member of. */
	receiver?: string;
	/** Set when `name` is a function of the component class. */
	className?: string;
}

/**
 * A script name a Vue component's template uses (`@click="save"`,
 * `<UserCard/>`, `{{ format(x) }}`), or a component function the Vue runtime
 * calls itself. The template is the component's render function, so read each
 * one as a call from the file's top level: without it, code used only from the
 * template has no caller. Every entry was read from the template's AST.
 */
export interface ParsedTemplateRef extends ParsedRefTarget {
	/**
	 * Where it is used: a component tag, an event handler (`v-on`), a bound
	 * attribute (`v-bind`), an interpolation (`{{ }}`), another directive
	 * (`v-if`, `v-for`, `v-model`, `v-show`, a custom one), or "runtime" for a
	 * component function Vue calls itself (lifecycle hooks, watchers, `data()`).
	 */
	kind:
		| "component"
		| "event"
		| "bind"
		| "interpolation"
		| "directive"
		| "runtime";
	/** 1-based line in the .vue file. */
	line: number;
}

/**
 * Part of a Vue template the parser could not read, and the script names it
 * may use. These are not references: draw no CALLS edge from them. A function
 * named in `candidates` may still be used from the template, so don't report
 * it Dead or unused on the strength of having no caller.
 */
export interface ParsedUnverifiedTemplateRefs {
	/**
	 * "template-lang": the template is written in another language (Pug);
	 * "template-src": the template lives in another file;
	 * "unparsed-expression": one template expression could not be parsed.
	 */
	reason: "template-lang" | "template-src" | "unparsed-expression";
	/** 1-based line in the .vue file: the template's first line, or the expression's. */
	line: number;
	/** "template-lang": the template's `lang` (e.g. "pug"). */
	lang?: string;
	/** "template-src": the template file, as the `src` attribute names it. */
	src?: string;
	/** "unparsed-expression": where the expression sits, as on ParsedTemplateRef. */
	kind?: ParsedTemplateRef["kind"];
	/**
	 * Script names it may use. For a whole template: everything a template can
	 * reach. For an expression: the identifiers in its text that resolve to the
	 * script. May be empty.
	 */
	candidates: ParsedRefTarget[];
}

export interface ParsedFile {
	path: string;
	language: "typescript" | "tsx" | "python" | "javascript" | "jsx" | "vue";
	loc: number;
	functions: ParsedFunction[];
	classes: ParsedClass[];
	imports: ParsedImport[];
	exports: ParsedExport[];
	constants?: ParsedConstant[];
	/** Vue only: script names the template uses (see ParsedTemplateRef). */
	templateRefs?: ParsedTemplateRef[];
	/** Vue only: template parts the parser could not read (see ParsedUnverifiedTemplateRefs). */
	unverifiedTemplateRefs?: ParsedUnverifiedTemplateRefs[];
}
