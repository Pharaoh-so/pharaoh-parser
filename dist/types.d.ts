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
    /** Decorator strings for Python functions (e.g. ["@staticmethod", "@app.route(\"/api\")"]) */
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
    aliases?: {
        local: string;
        original: string;
    }[];
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
export declare function computeClassMetrics(className: string, lineStart: number, lineEnd: number, functions: ParsedFunction[]): {
    loc: number;
    complexity: number;
};
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
export interface ParsedFile {
    path: string;
    language: "typescript" | "tsx" | "python" | "javascript" | "jsx";
    loc: number;
    functions: ParsedFunction[];
    classes: ParsedClass[];
    imports: ParsedImport[];
    exports: ParsedExport[];
    constants?: ParsedConstant[];
}
//# sourceMappingURL=types.d.ts.map