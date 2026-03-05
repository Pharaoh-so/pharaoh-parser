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

export interface ParsedFile {
	path: string;
	language: "typescript" | "tsx" | "python";
	loc: number;
	functions: ParsedFunction[];
	classes: ParsedClass[];
	imports: ParsedImport[];
	exports: ParsedExport[];
}
