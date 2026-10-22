import fs from "node:fs";
import path from "node:path";
import { parseCache } from "@vue/compiler-sfc";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../src/file-walker.js";
import { parseFile, toScriptSource } from "../src/tree-sitter.js";
import type { ParsedFile, ParsedTemplateRef } from "../src/types.js";
import { componentNameFromPath } from "../src/vue-sfc.js";
import type { SyntaxNode } from "../src/wasm-init.js";

const VUE_DIR = path.resolve(__dirname, "fixtures/vue");

function parseVue(relativePath: string): ParsedFile {
	return parseFile(path.join(VUE_DIR, relativePath), relativePath);
}

function readFixture(relativePath: string): string {
	return fs.readFileSync(path.join(VUE_DIR, relativePath), "utf-8");
}

/** Name and line range of each function, in output order. */
function functionSpans(parsed: ParsedFile) {
	return parsed.functions.map((f) => ({
		name: f.name,
		lineStart: f.lineStart,
		lineEnd: f.lineEnd,
		className: f.className,
	}));
}

function refNames(parsed: ParsedFile): string[] {
	return (parsed.templateRefs ?? []).map((r) => r.name);
}

/** First descendant of `type` whose `name` field reads `name`. */
function findNamed(
	node: SyntaxNode,
	type: string,
	name: string,
): SyntaxNode | null {
	if (node.type === type && node.childForFieldName("name")?.text === name) {
		return node;
	}
	for (const child of node.children) {
		const found = findNamed(child, type, name);
		if (found) return found;
	}
	return null;
}

describe("vue: file walking", () => {
	it("walkFiles lists .vue files", () => {
		const paths = walkFiles(VUE_DIR).map((f) => f.relativePath);
		expect(paths).toContain(path.join("src", "UserList.vue"));
		expect(paths).toContain(path.join("src", "components", "UserCard.vue"));
		expect(paths).toContain(path.join("src", "TemplateOnly.vue"));
	});
});

describe("vue: <script> and <script setup> together (TypeScript)", () => {
	const parsed = parseVue("src/UserList.vue");

	it("reports language vue and the whole file's line count", () => {
		expect(parsed.path).toBe("src/UserList.vue");
		expect(parsed.language).toBe("vue");
		expect(parsed.loc).toBe(73);
	});

	it("extracts <script setup> functions with their .vue line ranges", () => {
		expect(functionSpans(parsed)).toEqual([
			{ name: "row", lineStart: 39, lineEnd: 41, className: undefined },
			{ name: "hasUsers", lineStart: 43, lineEnd: 45, className: undefined },
			{ name: "visibleRows", lineStart: 47, lineEnd: 49, className: undefined },
			{ name: "onSearch", lineStart: 51, lineEnd: 53, className: undefined },
			{ name: "remove", lineStart: 55, lineEnd: 57, className: undefined },
			{ name: "reset", lineStart: 59, lineEnd: 61, className: undefined },
			{
				name: "unusedHelper",
				lineStart: 63,
				lineEnd: 65,
				className: undefined,
			},
		]);
		const hasUsers = parsed.functions.find((f) => f.name === "hasUsers");
		expect(hasUsers?.signature).toBe("function hasUsers(list: Row[]): boolean");
		expect(hasUsers?.isExported).toBe(false);
	});

	it("extracts imports from <script setup> with their .vue lines", () => {
		expect(parsed.imports).toEqual([
			{
				source: "vue",
				symbols: ["computed", "ref"],
				isDefault: false,
				isNamespace: false,
				line: 26,
			},
			{
				source: "./components/SearchBox.vue",
				symbols: ["SearchBox"],
				isDefault: true,
				isNamespace: false,
				line: 27,
			},
			{
				source: "./components/UserCard.vue",
				symbols: ["UserCard"],
				isDefault: true,
				isNamespace: false,
				line: 28,
			},
			{
				source: "./format",
				symbols: ["formatDate"],
				isDefault: false,
				isNamespace: false,
				line: 29,
			},
		]);
	});

	it("keeps named exports and constants from the plain <script> block", () => {
		expect(parsed.exports).toEqual([
			{ name: "Row", kind: "type", isDefault: false },
			{ name: "PAGE_SIZE", kind: "variable", isDefault: false },
			{ name: "UserList", kind: "class", isDefault: true },
		]);
		expect(parsed.constants?.find((c) => c.name === "PAGE_SIZE")).toEqual({
			name: "PAGE_SIZE",
			value: "20",
			typeAnnotation: null,
			isExported: true,
			lineStart: 22,
			lineEnd: 22,
		});
	});

	it("represents the component as a default-exported class named after the file", () => {
		expect(parsed.classes).toEqual([
			{
				name: "UserList",
				lineStart: 1,
				lineEnd: 73,
				loc: 73,
				complexity: 0,
				isExported: true,
				methods: [],
			},
		]);
	});

	it("references what the template uses, in document order", () => {
		expect(parsed.templateRefs).toEqual([
			{ name: "SearchBox", kind: "component", line: 3 },
			{ name: "query", kind: "directive", line: 3 },
			{ name: "onSearch", kind: "event", line: 3 },
			{ name: "hasUsers", kind: "directive", line: 4 },
			{ name: "visibleRows", kind: "directive", line: 5 },
			{ name: "UserCard", kind: "component", line: 6 },
			{ name: "remove", kind: "event", line: 6 },
			{ name: "formatDate", kind: "interpolation", line: 7 },
			{ name: "reset", kind: "event", line: 11 },
		]);
	});

	it("does not reference a v-for variable that shadows a script function", () => {
		// `row` is both a script function and the v-for alias on line 5
		expect(refNames(parsed)).not.toContain("row");
	});

	it("does not reference props destructured from defineProps", () => {
		expect(refNames(parsed)).not.toContain("users");
		expect(refNames(parsed)).not.toContain("emptyMessage");
	});

	it("does not reference inline-handler parameters or $event", () => {
		expect(refNames(parsed)).not.toContain("id");
		expect(refNames(parsed)).not.toContain("$event");
	});

	it("lends a tree whose rows are the .vue file's rows", () => {
		let row: number | undefined;
		let lastRow: number | undefined;
		let hasError: boolean | undefined;
		parseFile(
			path.join(VUE_DIR, "src/UserList.vue"),
			"src/UserList.vue",
			(root, lent) => {
				row = findNamed(root, "function_declaration", "hasUsers")?.startPosition
					.row;
				lastRow = root.endPosition.row;
				hasError = root.hasError;
				expect(lent.templateRefs).toHaveLength(9);
			},
		);
		expect(row).toBe(42); // 0-based row of line 43
		expect(lastRow).toBe(72);
		expect(hasError).toBe(false);
	});
});

describe("vue: compiler macros", () => {
	const parsed = parseVue("src/components/UserCard.vue");

	it("does not record defineProps/defineEmits/defineExpose as imports", () => {
		expect(parsed.imports).toEqual([]);
	});

	it("references the method used only from an event handler", () => {
		expect(parsed.functions.map((f) => f.name)).toEqual(["select"]);
		expect(parsed.templateRefs).toEqual([
			{ name: "select", kind: "event", line: 4 },
		]);
	});

	it("does not reference props or macro results", () => {
		// {{ title }} reads a prop declared only in defineProps' type
		expect(refNames(parsed)).not.toContain("title");
		expect(refNames(parsed)).not.toContain("props");
		expect(refNames(parsed)).not.toContain("emit");
	});
});

describe("vue: Options API (JavaScript)", () => {
	const parsed = parseVue("src/LegacyForm.vue");

	it("extracts methods, computed, watchers and hooks as methods of the component", () => {
		const legacy = "LegacyForm";
		expect(functionSpans(parsed)).toEqual([
			{ name: "data", lineStart: 18, lineEnd: 20, className: legacy },
			{ name: "get filtered", lineStart: 22, lineEnd: 24, className: legacy },
			{ name: "get isDirty", lineStart: 26, lineEnd: 28, className: legacy },
			{ name: "set isDirty", lineStart: 29, lineEnd: 31, className: legacy },
			{ name: "watch draft", lineStart: 35, lineEnd: 37, className: legacy },
			{ name: "mounted", lineStart: 39, lineEnd: 41, className: legacy },
			{ name: "onSubmit", lineStart: 43, lineEnd: 45, className: legacy },
			{ name: "addItem", lineStart: 46, lineEnd: 48, className: legacy },
			{ name: "summary", lineStart: 49, lineEnd: 49, className: legacy },
			{ name: "persist", lineStart: 50, lineEnd: 52, className: legacy },
			{ name: "neverUsed", lineStart: 53, lineEnd: 55, className: legacy },
		]);
	});

	it("gives object members method signatures", () => {
		const byName = (name: string) =>
			parsed.functions.find((f) => f.name === name)?.signature;
		expect(byName("onSubmit")).toBe("function onSubmit()");
		expect(byName("addItem")).toBe("function addItem(name)");
		expect(byName("summary")).toBe("function summary(count)");
		expect(byName("get filtered")).toBe("get filtered()");
		expect(byName("set isDirty")).toBe("set isDirty(value)");
		expect(byName("watch draft")).toBe("watch draft(value)");
	});

	it("records the component class with its members", () => {
		expect(parsed.classes).toHaveLength(1);
		const [component] = parsed.classes;
		expect(component.name).toBe("LegacyForm");
		expect(component.lineStart).toBe(1);
		expect(component.lineEnd).toBe(59);
		expect(component.isExported).toBe(true);
		expect(component.methods).toEqual([
			"data",
			"get filtered",
			"get isDirty",
			"set isDirty",
			"watch draft",
			"mounted",
			"onSubmit",
			"addItem",
			"summary",
			"persist",
			"neverUsed",
		]);
	});

	it("replaces the options object's source with the component as default export", () => {
		expect(parsed.exports).toEqual([
			{ name: "LegacyForm", kind: "class", isDefault: true },
		]);
	});

	it("references template uses, registered components and runtime-called members", () => {
		const legacy = "LegacyForm";
		expect(parsed.templateRefs).toEqual([
			{ name: "onSubmit", kind: "event", line: 2, className: legacy },
			{ name: "UserCard", kind: "component", line: 4 },
			{ name: "get filtered", kind: "directive", line: 4, className: legacy },
			{ name: "addItem", kind: "event", line: 5, className: legacy },
			{ name: "get isDirty", kind: "directive", line: 6, className: legacy },
			{ name: "summary", kind: "interpolation", line: 6, className: legacy },
			{ name: "data", kind: "runtime", line: 18, className: legacy },
			{ name: "watch draft", kind: "runtime", line: 35, className: legacy },
			{ name: "mounted", kind: "runtime", line: 39, className: legacy },
		]);
	});

	it("does not reference props, data keys or loop variables", () => {
		const templateOnly = (parsed.templateRefs ?? []).filter(
			(r) => r.kind !== "runtime",
		);
		const names = templateOnly.map((r) => r.name);
		expect(names).not.toContain("title"); // props: ["title"]
		expect(names).not.toContain("draft"); // a data key (and a watcher's name)
		expect(names).not.toContain("items");
		expect(names).not.toContain("item");
		expect(names).not.toContain("neverUsed");
	});

	it("keeps imports with their .vue lines", () => {
		expect(parsed.imports.map((i) => [i.source, i.line])).toEqual([
			["./components/UserCard.vue", 11],
			["./validate", 12],
		]);
	});
});

describe("vue: Options API in defineComponent (TypeScript)", () => {
	const parsed = parseVue("src/DefineComponent.vue");

	it("reads members from the defineComponent argument", () => {
		expect(functionSpans(parsed)).toEqual([
			{
				name: "data",
				lineStart: 10,
				lineEnd: 12,
				className: "DefineComponent",
			},
			{
				name: "toggle",
				lineStart: 14,
				lineEnd: 16,
				className: "DefineComponent",
			},
			{
				name: "label",
				lineStart: 17,
				lineEnd: 19,
				className: "DefineComponent",
			},
		]);
		expect(parsed.functions.find((f) => f.name === "toggle")?.signature).toBe(
			"function toggle(): void",
		);
	});

	it("references the method used only from an event handler", () => {
		const cls = "DefineComponent";
		expect(parsed.templateRefs).toEqual([
			{ name: "toggle", kind: "event", line: 2, className: cls },
			{ name: "label", kind: "interpolation", line: 2, className: cls },
			{ name: "data", kind: "runtime", line: 10, className: cls },
		]);
	});

	it("exports the component, not the defineComponent call's source", () => {
		expect(parsed.exports).toEqual([
			{ name: "DefineComponent", kind: "class", isDefault: true },
		]);
	});
});

describe("vue: <script setup> in JavaScript", () => {
	const parsed = parseVue("src/JsSetup.vue");

	it("extracts functions when the template comes after the script", () => {
		expect(functionSpans(parsed)).toEqual([
			{ name: "increment", lineStart: 7, lineEnd: 9, className: undefined },
			{ name: "double", lineStart: 11, lineEnd: 11, className: undefined },
		]);
	});

	it("references components, bound calls, handlers, member tags and <component :is>", () => {
		expect(parsed.templateRefs).toEqual([
			{ name: "Child", kind: "component", line: 15 },
			{ name: "double", kind: "bind", line: 15 },
			{ name: "increment", kind: "event", line: 15 },
			{ name: "Item", kind: "component", line: 16, receiver: "Child" },
			{ name: "Child", kind: "component", line: 17 },
		]);
	});
});

describe("vue: scopes, directives and self-reference", () => {
	const parsed = parseVue("src/TreeNode.vue");

	it("references only names that resolve to the script or the component itself", () => {
		const expected: ParsedTemplateRef[] = [
			{ name: "TreeNode", kind: "component", line: 3 },
			{ name: "children", kind: "directive", line: 3 },
			{ name: "DataTable", kind: "component", line: 4 },
			{ name: "rows", kind: "bind", line: 4 },
			{ name: "vFocus", kind: "directive", line: 6 },
			{ name: "save", kind: "event", line: 6, receiver: "api" },
			{ name: "label", kind: "interpolation", line: 9 },
		];
		expect(parsed.templateRefs).toEqual(expected);
	});

	it("treats v-for destructuring and slot props as locals", () => {
		// `label` inside the v-for on line 3 is the destructured alias, not the function
		expect(
			(parsed.templateRefs ?? []).filter((r) => r.name === "label"),
		).toEqual([{ name: "label", kind: "interpolation", line: 9 }]);
		expect(refNames(parsed)).not.toContain("value");
		expect(refNames(parsed)).not.toContain("id");
	});
});

describe("vue: files without an inline script", () => {
	it("parses a template-only component", () => {
		const parsed = parseVue("src/TemplateOnly.vue");
		expect(parsed.language).toBe("vue");
		expect(parsed.loc).toBe(7);
		expect(parsed.functions).toEqual([]);
		expect(parsed.imports).toEqual([]);
		// No script, so nothing in the template resolves to it
		expect(parsed.templateRefs).toBeUndefined();
		expect(parsed.classes.map((c) => c.name)).toEqual(["TemplateOnly"]);
		expect(parsed.exports).toEqual([
			{ name: "TemplateOnly", kind: "class", isDefault: true },
		]);
	});

	it("records <script src> as an import of that file", () => {
		const parsed = parseVue("src/ExternalScript.vue");
		expect(parsed.imports).toEqual([
			{
				source: "./external-logic.ts",
				symbols: [],
				isDefault: false,
				isNamespace: false,
				line: 5,
			},
		]);
		expect(parsed.templateRefs).toBeUndefined();
	});
});

describe("vue: <script setup lang=tsx>", () => {
	it("reads JSX in the script and references the component from the template", () => {
		const parsed = parseVue("src/TsxRender.vue");
		expect(functionSpans(parsed)).toEqual([
			{ name: "Label", lineStart: 2, lineEnd: 2, className: undefined },
		]);
		expect(parsed.templateRefs).toEqual([
			{ name: "Label", kind: "component", line: 6 },
		]);
	});
});

describe("toScriptSource", () => {
	it("lays a .vue file's script blocks over blank text at their original positions", () => {
		const source = readFixture("src/UserList.vue");
		const script = toScriptSource("src/UserList.vue", source);
		expect(script.ext).toBe(".ts");
		expect(script.code).toHaveLength(source.length);
		expect(script.code.split("\n")).toHaveLength(73);
		expect(script.code).not.toContain("<template>");
		expect(script.code).not.toContain("<script");
		expect(script.code).not.toContain("padding");
		expect(script.code.indexOf("function hasUsers")).toBe(
			source.indexOf("function hasUsers"),
		);
		expect(script.code.indexOf("export const PAGE_SIZE")).toBe(
			source.indexOf("export const PAGE_SIZE"),
		);
	});

	it("reports the script's language as an extension", () => {
		expect(
			toScriptSource("src/JsSetup.vue", readFixture("src/JsSetup.vue")).ext,
		).toBe(".js");
		expect(
			toScriptSource("src/TsxRender.vue", readFixture("src/TsxRender.vue")).ext,
		).toBe(".tsx");
	});

	it("returns other files unchanged", () => {
		const source = "export const a = 1;\n";
		expect(toScriptSource("src/a.ts", source)).toEqual({
			code: source,
			ext: ".ts",
		});
		expect(toScriptSource("src/b.jsx", source)).toEqual({
			code: source,
			ext: ".jsx",
		});
	});
});

describe("vue: memory", () => {
	it("leaves @vue/compiler-sfc's descriptor cache empty after parsing", () => {
		parseVue("src/UserList.vue");
		parseVue("src/LegacyForm.vue");
		expect(parseCache.size).toBe(0);
	});
});

describe("componentNameFromPath", () => {
	it("names a component the way a parent imports it", () => {
		expect(componentNameFromPath("src/components/UserCard.vue")).toBe(
			"UserCard",
		);
		expect(componentNameFromPath("src/components/user-card.vue")).toBe(
			"UserCard",
		);
		expect(componentNameFromPath("pages/users/[id].vue")).toBe("Id");
		expect(componentNameFromPath("pages/404.vue")).toBe("Component404");
		expect(componentNameFromPath("src\\views\\home-page.vue")).toBe("HomePage");
	});
});

describe("vue: templates the parser can't read", () => {
	it("names a Pug template's candidates as unverified, not as references", () => {
		const parsed = parseVue("src/PugTemplate.vue");
		expect(parsed.templateRefs).toBeUndefined();
		expect(parsed.unverifiedTemplateRefs).toEqual([
			{
				reason: "template-lang",
				lang: "pug",
				line: 1,
				candidates: [{ name: "Child" }, { name: "label" }, { name: "save" }],
			},
		]);
	});

	it("names a <template src> file and its candidates as unverified", () => {
		const parsed = parseVue("src/ExternalTemplate.vue");
		expect(parsed.templateRefs).toBeUndefined();
		expect(parsed.unverifiedTemplateRefs).toEqual([
			{
				reason: "template-src",
				src: "./form.html",
				line: 1,
				candidates: [{ name: "submit" }],
			},
		]);
	});

	it("leaves readable templates without unverified entries", () => {
		expect(parseVue("src/UserList.vue").unverifiedTemplateRefs).toBeUndefined();
		expect(
			parseVue("src/LegacyForm.vue").unverifiedTemplateRefs,
		).toBeUndefined();
	});
});

describe("vue: Options API watchers and aliases", () => {
	it("references methods a watcher names by string, in a handler object or an array", () => {
		const parsed = parseVue("src/Watchers.vue");
		const cls = "Watchers";
		expect(parsed.templateRefs).toEqual([
			{ name: "data", kind: "runtime", line: 9, className: cls },
			{ name: "persist", kind: "runtime", line: 13, className: cls },
			{ name: "persist", kind: "runtime", line: 14, className: cls },
			{ name: "log", kind: "runtime", line: 14, className: cls },
			{ name: "logChange", kind: "runtime", line: 14 },
		]);
	});

	it("resolves methods that alias a script function (`{ formatDate }`, `save: saveDraft`)", () => {
		const parsed = parseVue("src/OptionsAliases.vue");
		expect(parsed.templateRefs).toEqual([
			{ name: "saveDraft", kind: "event", line: 2 },
			{ name: "formatDate", kind: "interpolation", line: 2 },
			{ name: "data", kind: "runtime", line: 11, className: "OptionsAliases" },
		]);
	});
});

describe("vue: class components (vue-class-component)", () => {
	const parsed = parseVue("src/ClassComponent.vue");

	it("uses the default-exported class as the component", () => {
		expect(parsed.classes.map((c) => c.name)).toEqual(["Counter"]);
		expect(parsed.exports).toEqual([
			{ name: "Counter", kind: "class", isDefault: true },
		]);
	});

	it("reads @Component's registry, template uses, hooks and watchers", () => {
		const cls = "Counter";
		expect(parsed.templateRefs).toEqual([
			{ name: "ChildPanel", kind: "component", line: 2 },
			{ name: "total", kind: "bind", line: 2, className: cls },
			{ name: "onChange", kind: "event", line: 2, className: cls },
			{ name: "mounted", kind: "runtime", line: 17, className: cls },
			{ name: "onCount", kind: "runtime", line: 22, className: cls },
		]);
		expect(refNames(parsed)).not.toContain("neverUsed");
	});
});

describe("vue: same-name shorthand (Vue 3.4)", () => {
	it("references the binding `:handler` and `:on-save` stand for", () => {
		const parsed = parseVue("src/Shorthand.vue");
		expect(parsed.templateRefs).toEqual([
			{ name: "Child", kind: "component", line: 2 },
			{ name: "handler", kind: "bind", line: 2 },
			{ name: "onSave", kind: "bind", line: 2 },
		]);
	});
});

describe("vue: expressions Babel can't read", () => {
	it("does not throw, and names their candidates as unverified, not as references", () => {
		const parsed = parseVue("src/OddExpressions.vue");
		expect(parsed.functions.map((f) => f.name)).toEqual(["label"]);
		expect(parsed.templateRefs).toEqual([
			{ name: "count", kind: "interpolation", line: 3 },
		]);
		expect(parsed.unverifiedTemplateRefs).toEqual([
			// @click="/* ; */": the compiler's walker can't read it
			{ reason: "unparsed-expression", kind: "event", line: 2, candidates: [] },
			// :title="label // note": Babel can't parse it
			{
				reason: "unparsed-expression",
				kind: "bind",
				line: 3,
				candidates: [{ name: "label" }],
			},
		]);
	});
});

describe("vue: members that share a name keep their own identity", () => {
	const parsed = parseVue("src/Collisions.vue");
	const cls = "Collisions";

	it("names computed accessors, watchers and colliding hooks apart from methods", () => {
		expect(functionSpans(parsed)).toEqual([
			{ name: "data", lineStart: 10, lineEnd: 12, className: cls },
			{ name: "get total", lineStart: 15, lineEnd: 17, className: cls },
			{ name: "set total", lineStart: 18, lineEnd: 20, className: cls },
			{ name: "get label", lineStart: 22, lineEnd: 24, className: cls },
			{ name: "watch total", lineStart: 27, lineEnd: 29, className: cls },
			{ name: "watch refresh", lineStart: 30, lineEnd: 30, className: cls },
			{ name: "watch count[0]", lineStart: 31, lineEnd: 31, className: cls },
			{ name: "watch count[2]", lineStart: 31, lineEnd: 31, className: cls },
			{ name: "refresh", lineStart: 34, lineEnd: 34, className: cls },
			{ name: "label", lineStart: 35, lineEnd: 37, className: cls },
			{ name: "mounted", lineStart: 38, lineEnd: 38, className: cls },
			{ name: "mounted#2", lineStart: 40, lineEnd: 40, className: cls },
		]);
		const names = parsed.functions.map((f) => `${f.className}.${f.name}`);
		expect(new Set(names).size).toBe(names.length);
		expect(parsed.classes[0].methods).toEqual(
			parsed.functions.map((f) => f.name),
		);
	});

	it("reads through the getter and writes through the setter", () => {
		expect(parsed.templateRefs).toEqual([
			// v-model="total" reads and writes
			{ name: "get total", kind: "directive", line: 2, className: cls },
			{ name: "set total", kind: "directive", line: 2, className: cls },
			{ name: "refresh", kind: "event", line: 2, className: cls },
			{ name: "get total", kind: "interpolation", line: 3, className: cls },
			// Vue 3 defines computed after methods: `label` is the computed
			{ name: "get label", kind: "interpolation", line: 3, className: cls },
			// total = 0 only writes
			{ name: "set total", kind: "event", line: 4, className: cls },
			// total += 1 reads and writes
			{ name: "get total", kind: "event", line: 5, className: cls },
			{ name: "set total", kind: "event", line: 5, className: cls },
			{ name: "data", kind: "runtime", line: 10, className: cls },
			{ name: "watch total", kind: "runtime", line: 27, className: cls },
			{ name: "watch refresh", kind: "runtime", line: 30, className: cls },
			{ name: "watch count[0]", kind: "runtime", line: 31, className: cls },
			{ name: "watch count[2]", kind: "runtime", line: 31, className: cls },
			{ name: "mounted#2", kind: "runtime", line: 40, className: cls },
			// "refresh" in the count watcher array names the method
			{ name: "refresh", kind: "runtime", line: 31, className: cls },
		]);
	});

	it("does not reference the method a computed shadows, or the method named like a hook", () => {
		const templateUses = (parsed.templateRefs ?? []).filter(
			(r) => r.kind !== "runtime",
		);
		expect(templateUses.map((r) => r.name)).not.toContain("label");
		expect(refNames(parsed)).not.toContain("mounted");
	});
});

describe("vue: .bind, .call and .apply keep the function as the target", () => {
	const parsed = parseVue("src/BindForms.vue");

	it("references the handler, a namespace member, and nothing for locals or unknown names", () => {
		expect(parsed.templateRefs).toEqual([
			{ name: "handler", kind: "event", line: 2 },
			{ name: "handler", kind: "event", line: 3 },
			{ name: "handler", kind: "event", line: 4 },
			// `api` is a namespace import: `call` is its member, not Function.prototype.call
			{ name: "call", kind: "event", line: 5, receiver: "api" },
			// line 6: `handler` is the v-for alias, so only `others` resolves
			{ name: "others", kind: "directive", line: 6 },
		]);
		expect(
			(parsed.templateRefs ?? []).filter((r) => r.name === "bind"),
		).toEqual([]);
	});
});
