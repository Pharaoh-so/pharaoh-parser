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
import { Language, Query } from "web-tree-sitter";
import { computeBodyHash, computeComplexity, countParams, } from "./parser-shared.js";
import { computeClassMetrics, } from "./types.js";
import { Parser } from "./wasm-init.js";
export { C_CPP_EXTENSIONS } from "./file-walker.js";
const require = createRequire(import.meta.url);
/** Declarator forms upstream tags.scm leaves out: destructors, operators, nested scopes, `f<T>`. */
const EXTRA_TAGS = {
    c: "",
    cpp: `
(function_declarator declarator: (destructor_name)) @definition.method
(function_declarator declarator: (operator_name)) @definition.function
(function_declarator declarator: (template_function)) @definition.function
(function_declarator declarator: (qualified_identifier)) @definition.method
(union_specifier name: (type_identifier) body: (_)) @definition.class`,
};
async function loadDialect(dialect) {
    const dir = path.dirname(require.resolve(`tree-sitter-${dialect}/package.json`));
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
const CPP_ONLY = /\b(?:class|namespace|template|typename|constexpr|nullptr|public|private|protected|virtual|operator)\b|::/;
/**
 * The grammar a file is read with. `.c` is C and the `.cc`/`.cpp` family is
 * C++. A `.h` header is C++ when its text uses a C++-only word, otherwise C.
 */
function dialectOf(relativePath, source) {
    const ext = path.extname(relativePath).toLowerCase();
    if (ext === ".c")
        return "c";
    if (ext !== ".h")
        return "cpp";
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
const isLogicalOperator = (node) => node.type === "&&" || node.type === "||";
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
const oneLine = (text) => text.replace(/\s+/g, " ").trim();
/** A declared function's own name and, for `A::f`, the class it names. */
function declaredName(declarator) {
    let node = declarator.childForFieldName("declarator");
    let scope;
    // `ns::A::f` nests to the right: each level's scope is one step closer to `f`
    while (node?.type === "qualified_identifier") {
        scope = node.childForFieldName("scope")?.text ?? scope;
        node = node.childForFieldName("name");
    }
    if (node?.type === "template_function")
        node = node.childForFieldName("name");
    if (!node)
        return null;
    if (node.type !== "identifier" &&
        node.type !== "field_identifier" &&
        node.type !== "destructor_name" &&
        node.type !== "operator_name") {
        return null;
    }
    return {
        name: oneLine(node.text).replace(/^operator\s+(?=\W)/, "operator"),
        scope,
    };
}
/** The class a node sits in the body of, and whether an unnamed namespace hides it. */
function enclosing(node) {
    let className;
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
const isStatic = (node) => node.children.some((c) => c?.type === "storage_class_specifier" && c.text === "static");
/** The names a class's base clause lists, without access words or template arguments. */
function baseNames(classNode) {
    const clause = classNode.children.find((c) => c?.type === "base_class_clause");
    return (clause?.namedChildren ?? [])
        .filter((c) => c !== null && c.type !== "access_specifier")
        .map((c) => c?.type === "template_type"
        ? (c.childForFieldName("name")?.text ?? c.text)
        : (c?.text ?? ""))
        .filter((name) => name !== "" && name !== "virtual");
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
 * @param onTree - Optional: also receives the syntax tree before it is freed
 * @returns The file's functions, classes, includes, exports and scalar macros
 */
export function parseFile(absolutePath, relativePath, onTree) {
    const source = fs.readFileSync(absolutePath, "utf-8");
    const language = dialectOf(relativePath, source);
    const { parser, query } = DIALECTS[language];
    const tree = parser.parse(source);
    if (!tree)
        throw new Error(`Failed to parse ${relativePath}`);
    // The tree lives in WASM memory until it is deleted (see python-tree-sitter.ts).
    try {
        const functions = [];
        const classes = [];
        const exports = [];
        const methodsOf = new Map();
        const classNodes = [];
        const seen = new Set();
        const exported = new Set();
        const exportOnce = (name, kind) => {
            if (exported.has(`${kind}:${name}`))
                return;
            exported.add(`${kind}:${name}`);
            exports.push({ name, kind, isDefault: false });
        };
        for (const { name: tag, node } of query.captures(tree.rootNode)) {
            if (seen.has(node.id))
                continue;
            if (tag === "definition.class" && CLASS_TYPES.has(node.type)) {
                seen.add(node.id);
                if (node.childForFieldName("body"))
                    classNodes.push(node);
                continue;
            }
            if (node.type !== "function_declarator")
                continue;
            seen.add(node.id);
            const declared = declaredName(node);
            let owner = node.parent;
            while (owner && WRAPPING_DECLARATORS.has(owner.type))
                owner = owner.parent;
            if (!declared || !owner)
                continue;
            const where = enclosing(owner);
            const className = declared.scope ?? where.className;
            if (className) {
                const methods = methodsOf.get(className) ?? new Set();
                methodsOf.set(className, methods.add(declared.name));
            }
            const isExported = !where.internal && (!!className || !isStatic(owner));
            if (owner.type !== "function_definition") {
                // A prototype: the header's promise of a function defined elsewhere
                const prototype = owner.type === "declaration" || owner.type === "field_declaration";
                if (prototype && !className && isExported) {
                    exportOnce(declared.name, "function");
                }
                continue;
            }
            const body = owner.childForFieldName("body");
            // Up to the body, or to a constructor's `: member(value)` list before it
            const head = owner.children.find((c) => c?.type === "field_initializer_list" || c?.id === body?.id);
            const signature = oneLine(source.slice(owner.startIndex, head?.startIndex ?? owner.endIndex)).slice(0, MAX_SIGNATURE_LENGTH);
            functions.push({
                name: declared.name,
                signature,
                lineStart: owner.startPosition.row + 1,
                lineEnd: owner.endPosition.row + 1,
                loc: owner.endPosition.row - owner.startPosition.row + 1,
                complexity: computeComplexity(body ?? owner, COMPLEXITY_TYPES, isLogicalOperator),
                isExported,
                isAsync: false,
                ...(className ? { className } : {}),
                bodyHash: computeBodyHash(owner, ["{}", "{ }"]),
                // `f(void)` takes nothing
                paramCount: countParams(node, PARAMETER_TYPES, (p) => p.text === "void"),
            });
            if (!className && isExported)
                exportOnce(declared.name, "function");
        }
        for (const node of classNodes) {
            const name = node.childForFieldName("name")?.text;
            if (!name)
                continue;
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
            if (isExported)
                exportOnce(name, "class");
        }
        const parsed = {
            path: relativePath,
            language,
            loc: source.split("\n").length,
            functions,
            classes,
            imports: includes(tree.rootNode),
            exports,
            constants: scalarMacros(tree.rootNode),
        };
        onTree?.(tree.rootNode, parsed);
        return parsed;
    }
    finally {
        tree.delete();
    }
}
/** Every `#include`, wherever an `#if` puts it: `"util.h"` as `util.h`, `<cmath>` as written. */
function includes(root) {
    const imports = [];
    for (const node of root.descendantsOfType("preproc_include")) {
        const target = node?.childForFieldName("path");
        if (!node || !target)
            continue;
        imports.push({
            source: target.type === "string_literal"
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
/** Object-like macros with a short value (`#define MAX_POINTS 64`): the file's constants. */
function scalarMacros(root) {
    const constants = [];
    for (const node of root.descendantsOfType("preproc_def")) {
        const name = node?.childForFieldName("name")?.text;
        const value = node?.childForFieldName("value")?.text.trim();
        if (!node || !name || !value || value.length > MAX_CONSTANT_LENGTH)
            continue;
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
//# sourceMappingURL=c-cpp-tree-sitter.js.map