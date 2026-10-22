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
/**
 * A script name a Vue component's template uses (`@click="save"`,
 * `<UserCard/>`, `{{ format(x) }}`), or an Options API member the Vue runtime
 * calls itself. The template is the component's render function, so read each
 * one as a call from the file's top level: without it, code used only from the
 * template has no caller.
 */
export interface ParsedTemplateRef {
    /** The name used: a script binding or import, the member after `receiver`, or a method of `className`. */
    name: string;
    /**
     * Where it is used: a component tag, an event handler (`v-on`), a bound
     * attribute (`v-bind`), an interpolation (`{{ }}`), another directive
     * (`v-if`, `v-for`, `v-model`, `v-show`, a custom one), "runtime" for a
     * member Vue calls itself (lifecycle hooks, watchers, `data()`), or
     * "template" for every name a template the parser can't read
     * (`lang="pug"`, `src`) could use.
     */
    kind: "component" | "event" | "bind" | "interpolation" | "directive" | "runtime" | "template";
    /** 1-based line in the .vue file. */
    line: number;
    /** For `api.save()` or `<Form.Input>`: the script binding that `name` is a member of. */
    receiver?: string;
    /** Set when `name` is a method of the component class (Options API), as on ParsedFunction. */
    className?: string;
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
}
//# sourceMappingURL=types.d.ts.map