import fs from "node:fs";
import { computeBodyHash as computeBodyHashShared, computeComplexity as computeComplexityShared, countParams as countParamsShared, } from "./parser-shared.js";
import { computeClassMetrics, } from "./types.js";
import { Parser, pyLanguage } from "./wasm-init.js";
const pyParser = new Parser();
pyParser.setLanguage(pyLanguage);
// Python complexity-contributing node types (cyclomatic)
const COMPLEXITY_TYPES = new Set([
    "if_statement",
    "elif_clause",
    "for_statement",
    "while_statement",
    "try_statement",
    "except_clause",
    "with_statement",
    "match_statement",
    "case_clause",
]);
// Boolean operators that add complexity branches
const COMPLEXITY_OPERATORS = new Set(["and", "or"]);
export function parseFile(absolutePath, relativePath) {
    const source = fs.readFileSync(absolutePath, "utf-8");
    const tree = pyParser.parse(source);
    if (!tree)
        throw new Error(`Failed to parse ${relativePath}`);
    const lines = source.split("\n");
    const functions = [];
    const classes = [];
    const imports = [];
    const exports = [];
    // Extract __all__ for export detection
    const allNames = extractDunderAll(tree.rootNode);
    extractFromNode(tree.rootNode, source, functions, classes, imports, exports, allNames);
    return {
        path: relativePath,
        language: "python",
        loc: lines.length,
        functions,
        classes,
        imports,
        exports,
    };
}
/**
 * Extract names from `__all__ = ["name1", "name2"]` at module level.
 * Returns null if no __all__ is defined (meaning all public names are exported).
 */
function extractDunderAll(root) {
    for (const child of root.children) {
        if (child.type === "expression_statement") {
            const expr = child.firstChild;
            if (expr?.type === "assignment") {
                const left = expr.childForFieldName("left");
                const right = expr.childForFieldName("right");
                if (left?.text === "__all__" && right?.type === "list") {
                    const names = new Set();
                    for (const elem of right.namedChildren) {
                        if (elem.type === "string") {
                            // Strip quotes
                            const content = elem.text.replace(/^['"]|['"]$/g, "");
                            if (content)
                                names.add(content);
                        }
                    }
                    return names;
                }
            }
        }
    }
    return null;
}
function extractFromNode(node, source, functions, classes, imports, exports, allNames, currentClassName) {
    for (const child of node.children) {
        switch (child.type) {
            case "function_definition":
                extractFunction(child, source, functions, exports, allNames, currentClassName);
                break;
            case "decorated_definition": {
                // Unwrap: the actual definition is a child
                const inner = child.children.find((c) => c.type === "function_definition" || c.type === "class_definition");
                if (inner?.type === "function_definition") {
                    extractFunction(inner, source, functions, exports, allNames, currentClassName);
                }
                else if (inner?.type === "class_definition") {
                    extractClass(inner, source, classes, functions, exports, allNames);
                }
                break;
            }
            case "class_definition":
                extractClass(child, source, classes, functions, exports, allNames);
                break;
            case "import_statement":
                extractImportStatement(child, imports);
                break;
            case "import_from_statement":
                extractImportFromStatement(child, imports);
                break;
        }
    }
}
function isPublicName(name, allNames) {
    if (allNames !== null) {
        return allNames.has(name);
    }
    // No __all__ → public if doesn't start with _
    return !name.startsWith("_");
}
function extractFunction(node, _source, functions, exports, allNames, className) {
    const nameNode = node.childForFieldName("name");
    if (!nameNode)
        return;
    const name = nameNode.text;
    // For methods (inside class), check if it's a method definition
    const isMethod = className !== undefined;
    const isExported = !isMethod && isPublicName(name, allNames);
    const isAsync = node.children.some((c) => c.type === "async");
    const docstring = extractDocstring(node);
    functions.push({
        name,
        signature: buildSignature(node, isAsync),
        lineStart: node.startPosition.row + 1,
        lineEnd: node.endPosition.row + 1,
        loc: node.endPosition.row - node.startPosition.row + 1,
        complexity: computeComplexity(node),
        isExported,
        isAsync,
        className,
        jsdoc: docstring,
        bodyHash: computeBodyHash(node),
        paramCount: countParams(node),
    });
    if (isExported) {
        exports.push({ name, kind: "function", isDefault: false });
    }
}
function extractClass(node, source, classes, functions, exports, allNames) {
    const nameNode = node.childForFieldName("name");
    if (!nameNode)
        return;
    const name = nameNode.text;
    const isExported = isPublicName(name, allNames);
    const methods = [];
    // Find class body and extract methods
    const bodyNode = node.childForFieldName("body");
    if (bodyNode) {
        for (const child of bodyNode.children) {
            if (child.type === "function_definition") {
                const methodName = child.childForFieldName("name");
                if (methodName) {
                    methods.push(methodName.text);
                    extractFunction(child, source, functions, exports, allNames, name);
                }
            }
            else if (child.type === "decorated_definition") {
                const inner = child.children.find((c) => c.type === "function_definition");
                if (inner) {
                    const methodName = inner.childForFieldName("name");
                    if (methodName) {
                        methods.push(methodName.text);
                        extractFunction(inner, source, functions, exports, allNames, name);
                    }
                }
            }
        }
    }
    const lineStart = node.startPosition.row + 1;
    const lineEnd = node.endPosition.row + 1;
    const { loc, complexity } = computeClassMetrics(name, lineStart, lineEnd, functions);
    classes.push({
        name,
        lineStart,
        lineEnd,
        loc,
        complexity,
        isExported,
        methods,
    });
    if (isExported) {
        exports.push({ name, kind: "class", isDefault: false });
    }
}
function extractImportStatement(node, imports) {
    // `import foo` or `import foo.bar`
    for (const child of node.children) {
        if (child.type === "dotted_name") {
            imports.push({
                source: child.text,
                symbols: [child.text.split(".").pop() ?? child.text],
                isDefault: false,
                isNamespace: true,
                line: node.startPosition.row + 1,
            });
        }
        else if (child.type === "aliased_import") {
            const nameNode = child.childForFieldName("name");
            const aliasNode = child.childForFieldName("alias");
            if (nameNode) {
                imports.push({
                    source: nameNode.text,
                    symbols: [aliasNode?.text ?? nameNode.text.split(".").pop() ?? nameNode.text],
                    isDefault: false,
                    isNamespace: true,
                    line: node.startPosition.row + 1,
                });
            }
        }
    }
}
function extractImportFromStatement(node, imports) {
    // `from foo import bar, baz` or `from foo import *` or `from . import x`
    const moduleNode = node.childForFieldName("module_name");
    const source = moduleNode?.text ?? "";
    // Check for relative import prefix
    let relativePrefix = "";
    for (const child of node.children) {
        if (child.type === "relative_import") {
            // The relative_import node contains dots + optional dotted_name
            const dots = child.children.filter((c) => c.type === "import_prefix");
            relativePrefix = dots.map((d) => d.text).join("");
            const dottedName = child.children.find((c) => c.type === "dotted_name");
            const fullSource = relativePrefix + (dottedName?.text ?? "");
            extractImportNames(node, fullSource, imports);
            return;
        }
    }
    extractImportNames(node, source, imports);
}
function extractImportNames(node, source, imports) {
    const symbols = [];
    let isNamespace = false;
    for (const child of node.children) {
        if (child.type === "dotted_name" && child !== node.childForFieldName("module_name")) {
            symbols.push(child.text);
        }
        else if (child.type === "aliased_import") {
            const aliasNode = child.childForFieldName("alias");
            const nameNode = child.childForFieldName("name");
            symbols.push(aliasNode?.text ?? nameNode?.text ?? "");
        }
        else if (child.type === "wildcard_import") {
            isNamespace = true;
            symbols.push("*");
        }
    }
    if (source || symbols.length > 0) {
        imports.push({
            source,
            symbols,
            isDefault: false,
            isNamespace,
            line: node.startPosition.row + 1,
        });
    }
}
/**
 * Extract docstring from a function or class definition.
 * Python docstrings are the first expression_statement > string in the body.
 */
function extractDocstring(node) {
    const body = node.childForFieldName("body");
    if (!body)
        return undefined;
    // The first named child of the block should be an expression_statement containing a string
    const firstStmt = body.namedChildren[0];
    if (firstStmt?.type !== "expression_statement")
        return undefined;
    const expr = firstStmt.firstNamedChild;
    if (expr?.type !== "string" && expr?.type !== "concatenated_string")
        return undefined;
    let text = expr.text;
    // Strip triple-quote delimiters
    text = text.replace(/^("""|''')\s*/, "").replace(/\s*("""|''')$/, "");
    // Collapse whitespace
    text = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .trim();
    // Truncate to 200 chars
    if (text.length > 200) {
        text = `${text.slice(0, 197)}...`;
    }
    return text || undefined;
}
function buildSignature(node, isAsync) {
    const nameNode = node.childForFieldName("name");
    const paramsNode = node.childForFieldName("parameters");
    const returnType = node.childForFieldName("return_type");
    let sig = "";
    if (isAsync)
        sig += "async ";
    sig += `def ${nameNode?.text ?? "anonymous"}`;
    sig += paramsNode?.text ?? "()";
    if (returnType)
        sig += ` -> ${returnType.text}`;
    return sig;
}
function computeBodyHash(node) {
    return computeBodyHashShared(node, ["pass"]);
}
const PY_PARAM_TYPES = [
    "identifier",
    "typed_parameter",
    "default_parameter",
    "typed_default_parameter",
    "list_splat_pattern",
    "dictionary_splat_pattern",
];
function countParams(node) {
    return countParamsShared(node, PY_PARAM_TYPES, (c) => {
        // Skip 'self' and 'cls' — they're implicit, not real params
        return c.type === "identifier" && (c.text === "self" || c.text === "cls");
    });
}
function computeComplexity(node) {
    return computeComplexityShared(node, COMPLEXITY_TYPES, (n) => {
        if (n.type !== "boolean_operator")
            return false;
        // tree-sitter-python stores the operator as a direct child
        return n.children.some((child) => COMPLEXITY_OPERATORS.has(child.text));
    });
}
//# sourceMappingURL=python-tree-sitter.js.map