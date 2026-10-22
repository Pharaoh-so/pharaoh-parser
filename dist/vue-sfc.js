/**
 * Vue single-file components (.vue): what is specific to Vue. Finds the script
 * blocks with Vue's own compiler (@vue/compiler-sfc), reads a component's
 * Options API object and its script bindings from the parsed script, and reads
 * which of those the template uses from the compiler's template AST. The
 * TypeScript parser (tree-sitter.ts) parses the script and builds the result.
 */
import { createRequire } from "node:module";
import { blankOutside } from "./embedded-script.js";
const require = createRequire(import.meta.url);
let vueCompiler;
/** Load @vue/compiler-sfc on the first .vue file (~65ms), so repos without Vue never pay for it. */
function compiler() {
    vueCompiler ??= require("@vue/compiler-sfc");
    return vueCompiler;
}
// NodeTypes and ElementTypes from @vue/compiler-core (only their types are exported)
const NODE_ELEMENT = 1;
const NODE_INTERPOLATION = 5;
const NODE_DIRECTIVE = 7;
const ELEMENT_COMPONENT = 1;
/** Script languages the TypeScript parser reads. */
const SCRIPT_LANGS = new Set(["ts", "tsx", "js", "jsx"]);
/**
 * Read a .vue file's blocks.
 * @param source - The .vue file's text
 * @param relativePath - Its path, for the compiler's messages
 */
export function readVueSfc(source, relativePath) {
    const { parse, parseCache } = compiler();
    const { descriptor } = parse(source, {
        filename: relativePath,
        sourceMap: false,
    });
    // Each file is parsed once, so the compiler's cache (500 descriptors,
    // template ASTs included) would only hold memory on large Vue repos.
    parseCache.clear();
    const { script, scriptSetup } = descriptor;
    // Vue requires both blocks to share a language
    const lang = (scriptSetup ?? script)?.lang ?? "js";
    const blocks = [script, scriptSetup].filter((b) => b !== null);
    const inline = SCRIPT_LANGS.has(lang) ? blocks.filter((b) => !b.src) : [];
    const external = blocks.find((b) => b.src);
    return {
        script: {
            code: blankOutside(source, inline.map((b) => ({
                start: b.loc.start.offset,
                end: b.loc.end.offset,
            }))),
            ext: SCRIPT_LANGS.has(lang) ? `.${lang}` : ".js",
        },
        hasScriptSetup: scriptSetup !== null,
        ...(external?.src
            ? { scriptSrc: { source: external.src, line: external.loc.start.line } }
            : {}),
        descriptor,
    };
}
/**
 * The component's name from its file, as a parent imports it:
 * `user-card.vue` → `UserCard`, `[id].vue` → `Id`.
 */
export function componentNameFromPath(relativePath) {
    const file = relativePath.slice(Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\")) + 1);
    const base = file.slice(0, file.lastIndexOf(".vue"));
    const name = base
        .split(/[^A-Za-z0-9]+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
    return /^[A-Za-z]/.test(name) ? name : `Component${name}`;
}
/** Compiler macros of <script setup>: called without an import, never part of a template's scope. */
const MACROS = new Set([
    "defineProps",
    "defineEmits",
    "defineModel",
    "defineSlots",
    "defineExpose",
    "defineOptions",
    "withDefaults",
]);
/**
 * Names a <script setup> component's template can use: the top-level imports
 * and declarations of both script blocks. Type-only imports and names bound
 * to compiler macros (`const { title } = defineProps()`, `const emit =
 * defineEmits()`) are left out: those are props and emits, not script code.
 */
export function readSetupBindings(root) {
    const names = new Set();
    for (const statement of root.namedChildren) {
        const node = statement.type === "export_statement"
            ? statement.childForFieldName("declaration")
            : statement;
        switch (node?.type) {
            case "import_statement":
                for (const name of importedNames(node))
                    names.add(name);
                break;
            case "function_declaration":
            case "generator_function_declaration":
            case "class_declaration":
            case "abstract_class_declaration":
            case "enum_declaration": {
                const name = node.childForFieldName("name");
                if (name)
                    names.add(name.text);
                break;
            }
            case "lexical_declaration":
            case "variable_declaration":
                for (const declarator of node.namedChildren) {
                    if (declarator.type !== "variable_declarator")
                        continue;
                    if (isMacroCall(declarator.childForFieldName("value")))
                        continue;
                    for (const name of patternNames(declarator.childForFieldName("name"))) {
                        names.add(name);
                    }
                }
                break;
        }
    }
    return names;
}
/** Local names an import binds as values (type-only imports bind none). */
function importedNames(node) {
    if (node.children.some((c) => c.type === "type"))
        return [];
    const clause = node.namedChildren.find((c) => c.type === "import_clause");
    const names = [];
    for (const part of clause?.namedChildren ?? []) {
        if (part.type === "identifier") {
            names.push(part.text);
        }
        else if (part.type === "namespace_import") {
            const alias = part.namedChildren.find((c) => c.type === "identifier");
            if (alias)
                names.push(alias.text);
        }
        else if (part.type === "named_imports") {
            for (const spec of part.namedChildren) {
                if (spec.type !== "import_specifier")
                    continue;
                if (spec.children.some((c) => c.type === "type"))
                    continue;
                const local = spec.childForFieldName("alias") ?? spec.childForFieldName("name");
                if (local)
                    names.push(local.text);
            }
        }
    }
    return names;
}
/** `defineProps()`, `withDefaults(defineProps(), ...)` and the other macros. */
function isMacroCall(value) {
    if (value?.type !== "call_expression")
        return false;
    const callee = value.childForFieldName("function");
    return callee?.type === "identifier" && MACROS.has(callee.text);
}
/** Names a binding pattern declares: `a`, `{ a, b: c, d = 1, ...e }`, `[f, g]`. */
function patternNames(node) {
    if (!node)
        return [];
    switch (node.type) {
        case "identifier":
        case "shorthand_property_identifier_pattern":
            return [node.text];
        case "pair_pattern":
            return patternNames(node.childForFieldName("value"));
        case "object_assignment_pattern":
        case "assignment_pattern":
            return patternNames(node.childForFieldName("left"));
        default:
            // object_pattern, array_pattern, rest_pattern
            return node.namedChildren.flatMap(patternNames);
    }
}
/**
 * Read the Options API object a component default-exports: `export default
 * { ... }`, the object passed to `defineComponent(...)` / `Vue.extend(...)`,
 * or a class component's `@Component({ ... })` options.
 * @returns null when the script default-exports no such object
 */
export function readOptionsApi(root) {
    const object = defaultExportedObject(root);
    if (!object)
        return null;
    const api = {
        members: [],
        aliases: new Map(),
        components: new Map(),
        directives: new Map(),
        watcherTargets: [],
    };
    for (const option of objectMembers(object)) {
        const value = pairValue(option.node);
        switch (option.name) {
            case "methods":
                for (const method of objectMembers(value)) {
                    const target = identifierValue(method.node);
                    if (target)
                        api.aliases.set(method.name, target);
                    else
                        api.members.push({ ...method, reach: "member" });
                }
                break;
            case "computed":
                for (const computed of objectMembers(value)) {
                    const target = identifierValue(computed.node);
                    if (target) {
                        api.aliases.set(computed.name, target);
                        continue;
                    }
                    const accessors = objectMembers(pairValue(computed.node)).filter((m) => m.name === "get" || m.name === "set");
                    for (const { node } of accessors.length > 0
                        ? accessors
                        : [computed]) {
                        api.members.push({ name: computed.name, node, reach: "member" });
                    }
                }
                break;
            case "watch":
                for (const watcher of objectMembers(value)) {
                    readWatcher(api, watcher.name, watcher.node);
                }
                break;
            case "components":
                readRegistry(value, api.components);
                break;
            case "directives":
                readRegistry(value, api.directives);
                break;
            default:
                // data(), setup(), mounted() and every other option holding a
                // function; non-function options are dropped by the caller
                api.members.push({ ...option, reach: "runtime" });
        }
    }
    return api;
}
/**
 * Read one watcher: `x(v) {}`, `x: function () {}`, `x: "persist"`,
 * `x: logChange`, `x: { handler, immediate }` or an array of those.
 */
function readWatcher(api, name, entry) {
    const value = entry.type === "pair" ? pairValue(entry) : entry;
    const line = (value ?? entry).startPosition.row + 1;
    switch (value?.type) {
        case "string":
            api.watcherTargets.push({
                name: value.text.slice(1, -1),
                line,
                isMethod: true,
            });
            return;
        case "identifier":
        case "shorthand_property_identifier":
            api.watcherTargets.push({ name: value.text, line, isMethod: false });
            return;
        case "array":
            for (const element of value.namedChildren) {
                readWatcher(api, name, element);
            }
            return;
        case "object": {
            const handler = objectMembers(value).find((m) => m.name === "handler");
            if (handler)
                readWatcher(api, name, handler.node);
            return;
        }
        default:
            // A method, or a pair or array element holding a function
            api.members.push({ name, node: entry, reach: "runtime" });
    }
}
/**
 * The options object a script default-exports: directly, as the first
 * argument of a call, or as a class component's decorator argument
 * (`@Component({ components })`).
 */
function defaultExportedObject(root) {
    for (const statement of root.namedChildren) {
        if (statement.type !== "export_statement")
            continue;
        if (!statement.children.some((c) => c.type === "default"))
            continue;
        const declaration = statement.childForFieldName("declaration");
        if (declaration?.type === "class_declaration") {
            return decoratorOptions([
                ...statement.namedChildren,
                ...declaration.namedChildren,
            ]);
        }
        let value = statement.childForFieldName("value");
        while (value?.type === "as_expression" ||
            value?.type === "satisfies_expression" ||
            value?.type === "parenthesized_expression") {
            value = value.namedChildren[0] ?? null;
        }
        if (value?.type === "call_expression") {
            value = value.childForFieldName("arguments")?.namedChildren[0] ?? null;
        }
        return value?.type === "object" ? value : null;
    }
    return null;
}
/** Named entries of an object literal: pairs and methods with a static key. */
function objectMembers(object) {
    if (object?.type !== "object")
        return [];
    const members = [];
    for (const entry of object.namedChildren) {
        if (entry.type === "pair" || entry.type === "method_definition") {
            const name = staticKey(entry.childForFieldName(entry.type === "pair" ? "key" : "name"));
            if (name !== null)
                members.push({ name, node: entry });
        }
        else if (entry.type === "shorthand_property_identifier") {
            members.push({ name: entry.text, node: entry });
        }
    }
    return members;
}
/** `save`, `"user.name"` or `0`; null for a computed key (`[key]`). */
function staticKey(key) {
    switch (key?.type) {
        case "property_identifier":
        case "number":
            return key.text;
        case "string":
            return key.text.slice(1, -1);
        default:
            return null;
    }
}
/** The object argument of the first decorator among `nodes` that has one. */
function decoratorOptions(nodes) {
    for (const node of nodes) {
        if (node.type !== "decorator")
            continue;
        const call = node.namedChildren.find((c) => c.type === "call_expression");
        const arg = call?.childForFieldName("arguments")?.namedChildren[0];
        if (arg?.type === "object")
            return arg;
    }
    return null;
}
/** A pair's value; a method or shorthand property has none. */
function pairValue(entry) {
    return entry.type === "pair" ? entry.childForFieldName("value") : null;
}
/** The script name an entry stands for: `{ formatDate }` or `{ save: saveDraft }`. */
function identifierValue(entry) {
    const value = entry.type === "pair" ? pairValue(entry) : entry;
    return value?.type === "identifier" ||
        value?.type === "shorthand_property_identifier"
        ? value.text
        : null;
}
/** `{ UserCard, "user-list": List }` → UserCard → UserCard, user-list → List. */
function readRegistry(object, registry) {
    for (const { name, node } of objectMembers(object)) {
        const target = identifierValue(node);
        if (target)
            registry.set(name, target);
    }
}
/** Class component methods Vue calls itself, by name. */
const CLASS_COMPONENT_HOOKS = new Set([
    "data",
    "render",
    "beforeCreate",
    "created",
    "beforeMount",
    "mounted",
    "beforeUpdate",
    "updated",
    "beforeUnmount",
    "unmounted",
    "beforeDestroy",
    "destroyed",
    "activated",
    "deactivated",
    "errorCaptured",
    "renderTracked",
    "renderTriggered",
    "serverPrefetch",
    "beforeRouteEnter",
    "beforeRouteUpdate",
    "beforeRouteLeave",
]);
/**
 * Whether Vue calls a class component's method itself: a lifecycle hook, or
 * a `@Watch(...)` handler (vue-property-decorator).
 */
export function isClassComponentHook(name, decorators = []) {
    return (CLASS_COMPONENT_HOOKS.has(name) ||
        decorators.some((d) => d.startsWith("@Watch(")));
}
/** Directives Vue implements itself; any other `v-x` is a custom directive. */
const BUILTIN_DIRECTIVES = new Set([
    "bind",
    "on",
    "if",
    "else-if",
    "else",
    "for",
    "model",
    "show",
    "slot",
    "html",
    "text",
    "once",
    "memo",
    "cloak",
    "pre",
    "is",
]);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/**
 * Read which script names a component's template uses, in document order.
 * A name counts only when it resolves to the script: template locals (`v-for`
 * aliases, slot props, handler parameters), props, `data()` keys and globals
 * like `$event` do not. Nothing of the template's text is kept but names.
 *
 * Where the template can't be read, it errs toward referencing: a template in
 * another language or file (`lang="pug"`, `src`) lists every name it could
 * use, and an expression Babel can't parse falls back to its identifiers.
 * A missed reference would mark live code unused.
 */
export function readTemplateRefs(descriptor, scope) {
    const template = descriptor.template;
    if (!template)
        return [];
    if (template.src || (template.lang && template.lang !== "html")) {
        return unreadTemplateRefs(scope, template.loc.start.line);
    }
    const root = template.ast;
    if (!root)
        return [];
    const refs = [];
    const seen = new Set();
    const add = (ref) => {
        const key = `${ref.kind}|${ref.line}|${ref.receiver ?? ""}|${ref.className ?? ""}|${ref.name}`;
        if (seen.has(key))
            return;
        seen.add(key);
        refs.push(ref);
    };
    /** Add a reference to `name` if it resolves to the script. */
    const resolve = (name, kind, line, member) => {
        if (scope.setupBindings.has(name)) {
            add(member
                ? { name: member, kind, line, receiver: name }
                : { name, kind, line });
        }
        else if (scope.members.has(name)) {
            add({ name, kind, line, className: scope.componentName });
        }
        else {
            const target = scope.aliases.get(name);
            if (target)
                add({ name: target, kind, line });
        }
    };
    /** Resolve a name unless the template declares it. */
    const visitName = (name, kind, line, locals) => {
        if (!locals.has(name))
            resolve(name, kind, line);
    };
    /** Every identifier-like word, for an expression Babel can't parse. */
    const scanNames = (content, kind, firstLine, locals) => {
        for (const match of content.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
            const before = content.slice(0, match.index);
            const line = firstLine + (before.match(/\n/g)?.length ?? 0);
            visitName(match[0], kind, line, locals);
        }
    };
    const visitExpression = (exp, kind, locals) => {
        if (!exp || !("content" in exp) || exp.isStatic)
            return;
        const { ast, content, loc } = exp;
        if (ast === false) {
            // Babel couldn't parse it (`:x="a // note"`)
            scanNames(content, kind, loc.start.line, locals);
            return;
        }
        if (!ast) {
            // A bare identifier (the compiler skips parsing those)
            const name = content.trim();
            if (IDENTIFIER.test(name))
                visitName(name, kind, loc.start.line, locals);
            return;
        }
        const knownIds = Object.create(null);
        for (const local of locals)
            knownIds[local] = 1;
        try {
            compiler().walkIdentifiers(ast, (id, parent) => {
                // The compiler parses `(${content})`: lines count from the expression's start
                const line = loc.start.line + (id.loc?.start.line ?? 1) - 1;
                resolve(id.name, kind, line, memberName(id, parent));
            }, false, [], knownIds);
        }
        catch {
            // The walker reads `body[0]` of a handler with `;` but no statement
            // (`@click="/* ; */"`); one odd expression must not fail the file
            scanNames(content, kind, loc.start.line, locals);
        }
    };
    const visitTag = (element) => {
        const { tag } = element;
        const line = element.loc.start.line;
        // <component :is="X"> is dynamic: its :is binding names the component
        if (tag === "component")
            return;
        const dot = tag.indexOf(".");
        if (dot > 0) {
            resolve(tag.slice(0, dot), "component", line, tag.slice(dot + 1));
            return;
        }
        // Vue matches a tag to a name as written, camelized, then capitalized
        const candidates = [tag, camelize(tag), capitalize(camelize(tag))];
        for (const candidate of candidates) {
            const name = scope.setupBindings.has(candidate)
                ? candidate
                : scope.components.get(candidate);
            if (name) {
                add({ name, kind: "component", line });
                return;
            }
        }
        // A component can render itself by its file name
        if (candidates.includes(scope.componentName)) {
            add({ name: scope.componentName, kind: "component", line });
        }
    };
    const visitCustomDirective = (directive) => {
        const camel = camelize(directive.name);
        const line = directive.loc.start.line;
        // <script setup>: `v-focus` is the binding `vFocus`
        const setupName = `v${capitalize(camel)}`;
        const name = scope.setupBindings.has(setupName)
            ? setupName
            : (scope.directives.get(directive.name) ?? scope.directives.get(camel));
        if (name)
            add({ name, kind: "directive", line });
    };
    const visitElement = (element, outer) => {
        const directives = element.props.filter((p) => p.type === NODE_DIRECTIVE);
        const vFor = directives.find((d) => d.name === "for");
        const vSlot = directives.find((d) => d.name === "slot");
        // v-for's source reads the outer scope; its aliases cover the element and its children
        const locals = vFor?.forParseResult
            ? withLocals(outer, forAliases(vFor.forParseResult))
            : outer;
        if (element.tagType === ELEMENT_COMPONENT)
            visitTag(element);
        if (vFor)
            visitExpression(vFor.forParseResult?.source, "directive", outer);
        for (const directive of directives) {
            if (directive === vFor || directive === vSlot)
                continue;
            if (!BUILTIN_DIRECTIVES.has(directive.name))
                visitCustomDirective(directive);
            const kind = directiveKind(directive, element);
            visitExpression(directive.arg, kind, locals);
            visitExpression(directive.exp, kind, locals);
            // Vue 3.4 same-name shorthand: `:on-save` binds `onSave`
            const { arg } = directive;
            if (directive.name === "bind" &&
                !directive.exp &&
                arg &&
                "content" in arg &&
                arg.isStatic) {
                visitName(camelize(arg.content), kind, directive.loc.start.line, locals);
            }
        }
        // Slot props cover the slot's content only
        visitChildren(element.children, vSlot ? withLocals(locals, paramNames(vSlot.exp)) : locals);
    };
    const visitChildren = (children, locals) => {
        for (const child of children) {
            if (isElement(child)) {
                visitElement(child, locals);
            }
            else if (isInterpolation(child)) {
                visitExpression(child.content, "interpolation", locals);
            }
        }
    };
    visitChildren(root.children, new Set());
    return refs;
}
/**
 * For a template that can't be read: every name it could use, at the
 * template's first line, so nothing it uses reads as unused.
 */
function unreadTemplateRefs(scope, line) {
    const names = new Set([
        ...scope.setupBindings,
        ...scope.aliases.values(),
        ...scope.components.values(),
        ...scope.directives.values(),
    ]);
    return [
        ...[...names].map((name) => ({ name, kind: "template", line })),
        ...[...scope.members].map((name) => ({
            name,
            kind: "template",
            line,
            className: scope.componentName,
        })),
    ];
}
/** `user-card` → `userCard` */
function camelize(name) {
    return name.replace(/-(\w)/g, (_, c) => c.toUpperCase());
}
function capitalize(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
}
function isElement(node) {
    return node.type === NODE_ELEMENT;
}
function isInterpolation(node) {
    return node.type === NODE_INTERPOLATION;
}
function directiveKind(directive, element) {
    if (directive.name === "on")
        return "event";
    if (directive.name !== "bind")
        return "directive";
    const isComponentIs = element.tag === "component" &&
        directive.arg &&
        "content" in directive.arg &&
        directive.arg.content === "is";
    return isComponentIs ? "component" : "bind";
}
/** `item` in `item.save()` or `<Form.Input>`: the member read off a binding, if any. */
function memberName(id, parent) {
    if ((parent?.type === "MemberExpression" ||
        parent?.type === "OptionalMemberExpression") &&
        parent.object === id &&
        !parent.computed &&
        parent.property.type === "Identifier") {
        return parent.property.name;
    }
    return undefined;
}
/** `item`, `index` and destructured names a v-for declares. */
function forAliases(result) {
    return [result.value, result.key, result.index].flatMap(paramNames);
}
/** Names declared by an expression the compiler parsed as parameters (v-for aliases, v-slot props). */
function paramNames(exp) {
    if (!exp || !("content" in exp) || exp.ast === false)
        return [];
    if (!exp.ast) {
        const name = exp.content.trim();
        return IDENTIFIER.test(name) ? [name] : [];
    }
    // Parsed as `(${content}) => {}`
    const fn = exp.ast;
    if (fn.type !== "ArrowFunctionExpression")
        return [];
    return fn.params.flatMap((param) => compiler()
        .extractIdentifiers(param)
        .map((id) => id.name));
}
function withLocals(outer, names) {
    return names.length > 0 ? new Set([...outer, ...names]) : outer;
}
//# sourceMappingURL=vue-sfc.js.map