/**
 * Vue single-file components (.vue): what is specific to Vue. Finds the script
 * blocks with Vue's own compiler (@vue/compiler-sfc), reads a component's
 * Options API object and its script bindings from the parsed script, and reads
 * which of those the template uses from the compiler's template AST. The
 * TypeScript parser (tree-sitter.ts) parses the script and builds the result.
 */

import { createRequire } from "node:module";
import type {
	SFCDescriptor,
	SFCScriptBlock,
	SFCTemplateBlock,
} from "@vue/compiler-sfc";
import { type ScriptSource, blankOutside } from "./embedded-script.js";
import type {
	ParsedRefTarget,
	ParsedTemplateRef,
	ParsedUnverifiedTemplateRefs,
} from "./types.js";
import type { SyntaxNode } from "./wasm-init.js";

type VueCompiler = typeof import("@vue/compiler-sfc");

const require = createRequire(import.meta.url);
let vueCompiler: VueCompiler | undefined;

/** Load @vue/compiler-sfc on the first .vue file (~65ms), so repos without Vue never pay for it. */
function compiler(): VueCompiler {
	vueCompiler ??= require("@vue/compiler-sfc") as VueCompiler;
	return vueCompiler;
}

// Template AST types, read off the compiler's exported types (its own
// dependencies, like @vue/compiler-core, may not resolve from this package).
type TemplateRoot = NonNullable<SFCTemplateBlock["ast"]>;
type TemplateChild = TemplateRoot["children"][number];
type ElementNode = Extract<TemplateChild, { tagType: unknown }>;
type DirectiveNode = Extract<
	ElementNode["props"][number],
	{ modifiers: unknown }
>;
type ExpressionNode = NonNullable<DirectiveNode["exp"]>;
type InterpolationNode = Extract<TemplateChild, { content: ExpressionNode }>;
type ForParseResult = NonNullable<DirectiveNode["forParseResult"]>;
type WalkIdentifiers = VueCompiler["walkIdentifiers"];
type BabelNode = Parameters<WalkIdentifiers>[0];
type BabelIdentifier = Parameters<Parameters<WalkIdentifiers>[1]>[0];

// NodeTypes and ElementTypes from @vue/compiler-core (only their types are exported)
const NODE_ELEMENT = 1;
const NODE_INTERPOLATION = 5;
const NODE_DIRECTIVE = 7;
const ELEMENT_COMPONENT = 1;

/** Script languages the TypeScript parser reads. */
const SCRIPT_LANGS = new Set(["ts", "tsx", "js", "jsx"]);

/** A .vue file's blocks, read with Vue's compiler. */
export interface VueSfc {
	/** The <script> and <script setup> blocks, laid over the file. */
	script: ScriptSource;
	/** Whether the component has <script setup>, which exposes its bindings to the template. */
	hasScriptSetup: boolean;
	/** `<script src="./x.ts">`: the file holding the script, and the line naming it. */
	scriptSrc?: { source: string; line: number };
	/** The compiler's parsed blocks, for reading the template. */
	descriptor: SFCDescriptor;
}

/**
 * Read a .vue file's blocks.
 * @param source - The .vue file's text
 * @param relativePath - Its path, for the compiler's messages
 */
export function readVueSfc(source: string, relativePath: string): VueSfc {
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
	const blocks = [script, scriptSetup].filter(
		(b): b is SFCScriptBlock => b !== null,
	);
	const inline = SCRIPT_LANGS.has(lang) ? blocks.filter((b) => !b.src) : [];
	const external = blocks.find((b) => b.src);

	return {
		script: {
			code: blankOutside(
				source,
				inline.map((b) => ({
					start: b.loc.start.offset,
					end: b.loc.end.offset,
				})),
			),
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
export function componentNameFromPath(relativePath: string): string {
	const file = relativePath.slice(
		Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\")) + 1,
	);
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

/** What a <script setup> component's template can reach in its script. */
export interface SetupBindings {
	/** Every name (see readSetupBindings). */
	names: Set<string>;
	/** Namespace imports (`import * as api`), whose members are real names (`api.call`). */
	namespaces: Set<string>;
}

/**
 * Names a <script setup> component's template can use: the top-level imports
 * and declarations of both script blocks. Type-only imports and names bound
 * to compiler macros (`const { title } = defineProps()`, `const emit =
 * defineEmits()`) are left out: those are props and emits, not script code.
 */
export function readSetupBindings(root: SyntaxNode): SetupBindings {
	const names = new Set<string>();
	const namespaces = new Set<string>();
	for (const statement of root.namedChildren) {
		const node =
			statement.type === "export_statement"
				? statement.childForFieldName("declaration")
				: statement;
		switch (node?.type) {
			case "import_statement":
				for (const { name, namespace } of importedNames(node)) {
					names.add(name);
					if (namespace) namespaces.add(name);
				}
				break;
			case "function_declaration":
			case "generator_function_declaration":
			case "class_declaration":
			case "abstract_class_declaration":
			case "enum_declaration": {
				const name = node.childForFieldName("name");
				if (name) names.add(name.text);
				break;
			}
			case "lexical_declaration":
			case "variable_declaration":
				for (const declarator of node.namedChildren) {
					if (declarator.type !== "variable_declarator") continue;
					if (isMacroCall(declarator.childForFieldName("value"))) continue;
					for (const name of patternNames(
						declarator.childForFieldName("name"),
					)) {
						names.add(name);
					}
				}
				break;
		}
	}
	return { names, namespaces };
}

/** Local names an import binds as values (type-only imports bind none). */
function importedNames(
	node: SyntaxNode,
): { name: string; namespace: boolean }[] {
	if (node.children.some((c) => c.type === "type")) return [];
	const clause = node.namedChildren.find((c) => c.type === "import_clause");
	const names: { name: string; namespace: boolean }[] = [];
	for (const part of clause?.namedChildren ?? []) {
		if (part.type === "identifier") {
			names.push({ name: part.text, namespace: false });
		} else if (part.type === "namespace_import") {
			const alias = part.namedChildren.find((c) => c.type === "identifier");
			if (alias) names.push({ name: alias.text, namespace: true });
		} else if (part.type === "named_imports") {
			for (const spec of part.namedChildren) {
				if (spec.type !== "import_specifier") continue;
				if (spec.children.some((c) => c.type === "type")) continue;
				const local =
					spec.childForFieldName("alias") ?? spec.childForFieldName("name");
				if (local) names.push({ name: local.text, namespace: false });
			}
		}
	}
	return names;
}

/** `defineProps()`, `withDefaults(defineProps(), ...)` and the other macros. */
function isMacroCall(value: SyntaxNode | null): boolean {
	if (value?.type !== "call_expression") return false;
	const callee = value.childForFieldName("function");
	return callee?.type === "identifier" && MACROS.has(callee.text);
}

/** Names a binding pattern declares: `a`, `{ a, b: c, d = 1, ...e }`, `[f, g]`. */
function patternNames(node: SyntaxNode | null): string[] {
	if (!node) return [];
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

/** A function an Options API object holds, and how Vue reaches it. */
export interface OptionsMember {
	/**
	 * The function's name: its key for a method or option (`save`, `mounted`);
	 * for a computed accessor or watcher, its role and key (`get total`,
	 * `set total`, `watch draft`, `watch draft[1]` in an array), the way
	 * JavaScript names accessors. A method, a computed property and a watcher
	 * may share a key; their names never collide.
	 */
	name: string;
	/** The key it is declared under: what the template and `this` call it (`total`). */
	key: string;
	/** "get"/"set" for a computed accessor, "watch" for a watcher: its signature's keyword. */
	role?: "get" | "set" | "watch";
	/** The method_definition, the pair, or the array element whose value may be a function. */
	node: SyntaxNode;
	/**
	 * "member": a method or computed property, which the template and `this`
	 * reach by name. "runtime": what the Vue runtime calls itself: lifecycle
	 * hooks, watchers, `data()`, `setup()` and any other function-valued option.
	 */
	reach: "member" | "runtime";
}

/** What a component's Options API object declares. */
export interface OptionsApi {
	members: OptionsMember[];
	/** `methods: { formatDate, save: saveDraft }`: member name → the script function it is. */
	aliases: Map<string, string>;
	/** `components: { UserCard }`: registered name → script name. */
	components: Map<string, string>;
	/** `directives: { focus }`: registered name → script name. */
	directives: Map<string, string>;
	/**
	 * What a watcher names instead of holding a function: a method
	 * (`"persist"`, `isMethod`) or a script function (`logChange`).
	 */
	watcherTargets: { name: string; line: number; isMethod: boolean }[];
}

/**
 * Read the Options API object a component default-exports: `export default
 * { ... }`, the object passed to `defineComponent(...)` / `Vue.extend(...)`,
 * or a class component's `@Component({ ... })` options.
 * @returns null when the script default-exports no such object
 */
export function readOptionsApi(root: SyntaxNode): OptionsApi | null {
	const object = defaultExportedObject(root);
	if (!object) return null;

	const api: OptionsApi = {
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
					if (target) api.aliases.set(method.name, target);
					else {
						api.members.push({
							name: method.name,
							key: method.name,
							node: method.node,
							reach: "member",
						});
					}
				}
				break;
			case "computed":
				for (const computed of objectMembers(value)) {
					const target = identifierValue(computed.node);
					if (target) {
						api.aliases.set(computed.name, target);
						continue;
					}
					const accessors = objectMembers(pairValue(computed.node)).filter(
						(m) => m.name === "get" || m.name === "set",
					);
					// `total() {}` is a getter; `total: { get() {}, set(v) {} }` has both
					for (const { name: role, node } of accessors.length > 0
						? accessors
						: [{ name: "get", node: computed.node }]) {
						const accessor = role === "set" ? "set" : "get";
						api.members.push({
							name: `${accessor} ${computed.name}`,
							key: computed.name,
							role: accessor,
							node,
							reach: "member",
						});
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
				api.members.push({
					name: option.name,
					key: option.name,
					node: option.node,
					reach: "runtime",
				});
		}
	}
	return api;
}

/**
 * Read one watcher: `x(v) {}`, `x: function () {}`, `x: "persist"`,
 * `x: logChange`, `x: { handler, immediate }` or an array of those.
 * @param index - The watcher's position in an array of handlers
 */
function readWatcher(
	api: OptionsApi,
	key: string,
	entry: SyntaxNode,
	index?: number,
): void {
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
			value.namedChildren.forEach((element, i) => {
				readWatcher(api, key, element, i);
			});
			return;
		case "object": {
			const handler = objectMembers(value).find((m) => m.name === "handler");
			if (handler) readWatcher(api, key, handler.node, index);
			return;
		}
		default:
			// A method, or a pair or array element holding a function
			api.members.push({
				name: `watch ${key}${index === undefined ? "" : `[${index}]`}`,
				key,
				role: "watch",
				node: entry,
				reach: "runtime",
			});
	}
}

/**
 * The options object a script default-exports: directly, as the first
 * argument of a call, or as a class component's decorator argument
 * (`@Component({ components })`).
 */
function defaultExportedObject(root: SyntaxNode): SyntaxNode | null {
	for (const statement of root.namedChildren) {
		if (statement.type !== "export_statement") continue;
		if (!statement.children.some((c) => c.type === "default")) continue;
		const declaration = statement.childForFieldName("declaration");
		if (declaration?.type === "class_declaration") {
			return decoratorOptions([
				...statement.namedChildren,
				...declaration.namedChildren,
			]);
		}
		let value = statement.childForFieldName("value");
		while (
			value?.type === "as_expression" ||
			value?.type === "satisfies_expression" ||
			value?.type === "parenthesized_expression"
		) {
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
function objectMembers(
	object: SyntaxNode | null,
): { name: string; node: SyntaxNode }[] {
	if (object?.type !== "object") return [];
	const members: { name: string; node: SyntaxNode }[] = [];
	for (const entry of object.namedChildren) {
		if (entry.type === "pair" || entry.type === "method_definition") {
			const name = staticKey(
				entry.childForFieldName(entry.type === "pair" ? "key" : "name"),
			);
			if (name !== null) members.push({ name, node: entry });
		} else if (entry.type === "shorthand_property_identifier") {
			members.push({ name: entry.text, node: entry });
		}
	}
	return members;
}

/** `save`, `"user.name"` or `0`; null for a computed key (`[key]`). */
function staticKey(key: SyntaxNode | null): string | null {
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
function decoratorOptions(nodes: SyntaxNode[]): SyntaxNode | null {
	for (const node of nodes) {
		if (node.type !== "decorator") continue;
		const call = node.namedChildren.find((c) => c.type === "call_expression");
		const arg = call?.childForFieldName("arguments")?.namedChildren[0];
		if (arg?.type === "object") return arg;
	}
	return null;
}

/** A pair's value; a method or shorthand property has none. */
function pairValue(entry: SyntaxNode): SyntaxNode | null {
	return entry.type === "pair" ? entry.childForFieldName("value") : null;
}

/** The script name an entry stands for: `{ formatDate }` or `{ save: saveDraft }`. */
function identifierValue(entry: SyntaxNode): string | null {
	const value = entry.type === "pair" ? pairValue(entry) : entry;
	return value?.type === "identifier" ||
		value?.type === "shorthand_property_identifier"
		? value.text
		: null;
}

/** `{ UserCard, "user-list": List }` → UserCard → UserCard, user-list → List. */
function readRegistry(
	object: SyntaxNode | null,
	registry: Map<string, string>,
) {
	for (const { name, node } of objectMembers(object)) {
		const target = identifierValue(node);
		if (target) registry.set(name, target);
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
export function isClassComponentHook(
	name: string,
	decorators: readonly string[] = [],
): boolean {
	return (
		CLASS_COMPONENT_HOOKS.has(name) ||
		decorators.some((d) => d.startsWith("@Watch("))
	);
}

/**
 * The component-class functions a template name reaches: its getter for a
 * read, its setter for a write. A method is one function for both.
 */
export interface MemberTargets {
	read?: string;
	write?: string;
}

/** What a template's names can resolve to. */
export interface TemplateScope {
	/** <script setup> bindings; empty without <script setup>. */
	setup: SetupBindings;
	/** Methods and computed properties of the component class, by the name the template uses. */
	members: ReadonlyMap<string, MemberTargets>;
	/** Options API members that stand for a script function (see OptionsApi.aliases). */
	aliases: ReadonlyMap<string, string>;
	/** The component class: members belong to it, and its file name refers to it. */
	componentName: string;
	/** Options API `components` registry. */
	components: ReadonlyMap<string, string>;
	/** Options API `directives` registry. */
	directives: ReadonlyMap<string, string>;
}

/** What a template uses: references read from its AST, and what it may use but couldn't be read. */
export interface TemplateUses {
	refs: ParsedTemplateRef[];
	unverified: ParsedUnverifiedTemplateRefs[];
}

/** How an expression uses a name: `x`, `x = 1`, or `x++` / `x += 1` / `v-model="x"`. */
type Access = "read" | "write" | "readwrite";

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

/** Function.prototype methods: `handler.bind(null)` still targets `handler`. */
const FUNCTION_METHODS = new Set(["bind", "call", "apply"]);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Read which script names a component's template uses, in document order.
 * A name counts only when it resolves to the script: template locals (`v-for`
 * aliases, slot props, handler parameters), props, `data()` keys and globals
 * like `$event` do not. A computed property is read through its getter and
 * written through its setter. Nothing of the template's text is kept but names.
 *
 * What can't be read is reported as unverified, never as references: a
 * template in another language or file (`lang="pug"`, `src`) with every name
 * it could use, and an expression that can't be parsed with the names its
 * text contains.
 */
export function readTemplateRefs(
	descriptor: SFCDescriptor,
	scope: TemplateScope,
): TemplateUses {
	const template = descriptor.template;
	if (!template) return { refs: [], unverified: [] };
	if (template.src || (template.lang && template.lang !== "html")) {
		return {
			refs: [],
			unverified: [
				{
					reason: template.src ? "template-src" : "template-lang",
					line: template.loc.start.line,
					...(template.src ? { src: template.src } : { lang: template.lang }),
					candidates: everyTarget(scope),
				},
			],
		};
	}
	const root = template.ast;
	if (!root) return { refs: [], unverified: [] };

	const refs: ParsedTemplateRef[] = [];
	const unverified: ParsedUnverifiedTemplateRefs[] = [];
	const seen = new Set<string>();
	const add = (
		target: ParsedRefTarget,
		kind: ParsedTemplateRef["kind"],
		line: number,
	) => {
		const key = `${kind}|${line}|${targetKey(target)}`;
		if (seen.has(key)) return;
		seen.add(key);
		refs.push({ ...target, kind, line });
	};

	/** What `name` reaches in the script; `member` is read off it (`name.member`). */
	const targets = (
		name: string,
		access: Access,
		member?: string,
	): ParsedRefTarget[] => {
		if (scope.setup.names.has(name)) {
			// `api.call()` on a namespace import calls its member `call`;
			// `handler.bind(null)` still targets `handler`
			const isMember =
				member !== undefined &&
				(scope.setup.namespaces.has(name) || !FUNCTION_METHODS.has(member));
			return [isMember ? { name: member, receiver: name } : { name }];
		}
		const fns = scope.members.get(name);
		if (fns) {
			const names = [
				access === "write" ? undefined : fns.read,
				access === "read" ? undefined : fns.write,
			];
			return names
				.filter((n): n is string => n !== undefined)
				.map((n) => ({ name: n, className: scope.componentName }));
		}
		const alias = scope.aliases.get(name);
		return alias ? [{ name: alias }] : [];
	};

	/** Reference a name unless the template declares it. */
	const visitName = (
		name: string,
		kind: ParsedTemplateRef["kind"],
		line: number,
		locals: ReadonlySet<string>,
		access: Access = "read",
	) => {
		if (locals.has(name)) return;
		for (const target of targets(name, access)) add(target, kind, line);
	};

	/** An expression that can't be parsed: the names its text contains, unverified. */
	const unparsed = (
		content: string,
		kind: ParsedTemplateRef["kind"],
		line: number,
		locals: ReadonlySet<string>,
	) => {
		const candidates = new Map<string, ParsedRefTarget>();
		for (const match of content.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
			if (locals.has(match[0])) continue;
			for (const target of targets(match[0], "readwrite")) {
				candidates.set(targetKey(target), target);
			}
		}
		unverified.push({
			reason: "unparsed-expression",
			kind,
			line,
			candidates: [...candidates.values()],
		});
	};

	const visitExpression = (
		exp: ExpressionNode | undefined,
		kind: ParsedTemplateRef["kind"],
		locals: ReadonlySet<string>,
		access: Access = "read",
	) => {
		if (!exp || !("content" in exp) || exp.isStatic) return;
		const { ast, content, loc } = exp;
		if (ast === false) {
			// Babel couldn't parse it (`:x="a // note"`)
			unparsed(content, kind, loc.start.line, locals);
			return;
		}
		if (!ast) {
			// A bare identifier (the compiler skips parsing those)
			const name = content.trim();
			if (IDENTIFIER.test(name)) {
				visitName(name, kind, loc.start.line, locals, access);
			}
			return;
		}
		const knownIds: Record<string, number> = Object.create(null);
		for (const local of locals) knownIds[local] = 1;
		const found: { target: ParsedRefTarget; line: number }[] = [];
		try {
			compiler().walkIdentifiers(
				ast,
				(id, parent, parentStack) => {
					// The compiler parses `(${content})`: lines count from the expression's start
					const line = loc.start.line + (id.loc?.start.line ?? 1) - 1;
					const uses = targets(
						id.name,
						accessOf(id, parent, parentStack),
						memberName(id, parent),
					);
					for (const target of uses) found.push({ target, line });
				},
				false,
				[],
				knownIds,
			);
		} catch {
			// The walker reads `body[0]` of a handler with `;` but no statement
			// (`@click="/* ; */"`); one odd expression must not fail the file
			unparsed(content, kind, loc.start.line, locals);
			return;
		}
		for (const { target, line } of found) add(target, kind, line);
	};

	const visitTag = (element: ElementNode) => {
		const { tag } = element;
		const line = element.loc.start.line;
		// <component :is="X"> is dynamic: its :is binding names the component
		if (tag === "component") return;
		const dot = tag.indexOf(".");
		if (dot > 0) {
			for (const target of targets(
				tag.slice(0, dot),
				"read",
				tag.slice(dot + 1),
			)) {
				add(target, "component", line);
			}
			return;
		}
		// Vue matches a tag to a name as written, camelized, then capitalized
		const candidates = [tag, camelize(tag), capitalize(camelize(tag))];
		for (const candidate of candidates) {
			const name = scope.setup.names.has(candidate)
				? candidate
				: scope.components.get(candidate);
			if (name) {
				add({ name }, "component", line);
				return;
			}
		}
		// A component can render itself by its file name
		if (candidates.includes(scope.componentName)) {
			add({ name: scope.componentName }, "component", line);
		}
	};

	const visitCustomDirective = (directive: DirectiveNode) => {
		const camel = camelize(directive.name);
		const line = directive.loc.start.line;
		// <script setup>: `v-focus` is the binding `vFocus`
		const setupName = `v${capitalize(camel)}`;
		const name = scope.setup.names.has(setupName)
			? setupName
			: (scope.directives.get(directive.name) ?? scope.directives.get(camel));
		if (name) add({ name }, "directive", line);
	};

	const visitElement = (element: ElementNode, outer: ReadonlySet<string>) => {
		const directives = element.props.filter(
			(p): p is DirectiveNode => (p.type as number) === NODE_DIRECTIVE,
		);
		const vFor = directives.find((d) => d.name === "for");
		const vSlot = directives.find((d) => d.name === "slot");
		// v-for's source reads the outer scope; its aliases cover the element and its children
		const locals = vFor?.forParseResult
			? withLocals(outer, forAliases(vFor.forParseResult))
			: outer;

		if ((element.tagType as number) === ELEMENT_COMPONENT) visitTag(element);
		if (vFor) visitExpression(vFor.forParseResult?.source, "directive", outer);
		for (const directive of directives) {
			if (directive === vFor || directive === vSlot) continue;
			if (!BUILTIN_DIRECTIVES.has(directive.name)) {
				visitCustomDirective(directive);
			}
			const kind = directiveKind(directive, element);
			visitExpression(directive.arg, kind, locals);
			// v-model reads its value and writes it back
			const access = directive.name === "model" ? "readwrite" : "read";
			visitExpression(directive.exp, kind, locals, access);
			// Vue 3.4 same-name shorthand: `:on-save` binds `onSave`
			const { arg } = directive;
			if (
				directive.name === "bind" &&
				!directive.exp &&
				arg &&
				"content" in arg &&
				arg.isStatic
			) {
				visitName(
					camelize(arg.content),
					kind,
					directive.loc.start.line,
					locals,
				);
			}
		}
		// Slot props cover the slot's content only
		visitChildren(
			element.children,
			vSlot ? withLocals(locals, paramNames(vSlot.exp)) : locals,
		);
	};

	const visitChildren = (
		children: readonly TemplateChild[],
		locals: ReadonlySet<string>,
	) => {
		for (const child of children) {
			if (isElement(child)) {
				visitElement(child, locals);
			} else if (isInterpolation(child)) {
				visitExpression(child.content, "interpolation", locals);
			}
		}
	};

	visitChildren(root.children, new Set());
	return { refs, unverified };
}

/** Everything a template can reach in the script, for one the parser can't read. */
function everyTarget(scope: TemplateScope): ParsedRefTarget[] {
	const names = new Set([
		...scope.setup.names,
		...scope.aliases.values(),
		...scope.components.values(),
		...scope.directives.values(),
	]);
	const memberFunctions = new Set(
		[...scope.members.values()].flatMap((t) => [t.read, t.write]),
	);
	return [
		...[...names].map((name) => ({ name })),
		...[...memberFunctions]
			.filter((name): name is string => name !== undefined)
			.map((name) => ({ name, className: scope.componentName })),
	];
}

function targetKey(target: ParsedRefTarget): string {
	return `${target.receiver ?? ""}|${target.className ?? ""}|${target.name}`;
}

/** How an expression uses an identifier: assigned (`x = 1`), updated (`x++`, `x += 1`) or read. */
function accessOf(
	id: BabelIdentifier,
	parent: BabelNode | null,
	parentStack: BabelNode[],
): Access {
	if (parent?.type === "AssignmentExpression" && parent.left === id) {
		return parent.operator === "=" ? "write" : "readwrite";
	}
	if (parent?.type === "UpdateExpression") return "readwrite";
	if (parent && compiler().isInDestructureAssignment(parent, parentStack)) {
		return "write";
	}
	return "read";
}

/** `user-card` → `userCard` */
function camelize(name: string): string {
	return name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
}

function capitalize(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

function isElement(node: TemplateChild): node is ElementNode {
	return (node.type as number) === NODE_ELEMENT;
}

function isInterpolation(node: TemplateChild): node is InterpolationNode {
	return (node.type as number) === NODE_INTERPOLATION;
}

function directiveKind(
	directive: DirectiveNode,
	element: ElementNode,
): ParsedTemplateRef["kind"] {
	if (directive.name === "on") return "event";
	if (directive.name !== "bind") return "directive";
	const isComponentIs =
		element.tag === "component" &&
		directive.arg &&
		"content" in directive.arg &&
		directive.arg.content === "is";
	return isComponentIs ? "component" : "bind";
}

/** `item` in `item.save()` or `<Form.Input>`: the member read off a binding, if any. */
function memberName(
	id: BabelIdentifier,
	parent: BabelNode | null,
): string | undefined {
	if (
		(parent?.type === "MemberExpression" ||
			parent?.type === "OptionalMemberExpression") &&
		parent.object === id &&
		!parent.computed &&
		parent.property.type === "Identifier"
	) {
		return parent.property.name;
	}
	return undefined;
}

/** `item`, `index` and destructured names a v-for declares. */
function forAliases(result: ForParseResult): string[] {
	return [result.value, result.key, result.index].flatMap(paramNames);
}

/** Names declared by an expression the compiler parsed as parameters (v-for aliases, v-slot props). */
function paramNames(exp: ExpressionNode | undefined): string[] {
	if (!exp || !("content" in exp) || exp.ast === false) return [];
	if (!exp.ast) {
		const name = exp.content.trim();
		return IDENTIFIER.test(name) ? [name] : [];
	}
	// Parsed as `(${content}) => {}`
	const fn = exp.ast;
	if (fn.type !== "ArrowFunctionExpression") return [];
	return fn.params.flatMap((param) =>
		compiler()
			.extractIdentifiers(param)
			.map((id) => id.name),
	);
}

function withLocals(
	outer: ReadonlySet<string>,
	names: readonly string[],
): ReadonlySet<string> {
	return names.length > 0 ? new Set([...outer, ...names]) : outer;
}
