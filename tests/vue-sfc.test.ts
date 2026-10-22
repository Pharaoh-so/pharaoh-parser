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
			{ name: "filtered", lineStart: 22, lineEnd: 24, className: legacy },
			{ name: "isDirty", lineStart: 26, lineEnd: 28, className: legacy },
			{ name: "isDirty", lineStart: 29, lineEnd: 31, className: legacy },
			{ name: "draft", lineStart: 35, lineEnd: 37, className: legacy },
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
			"filtered",
			"isDirty",
			"draft",
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
			{ name: "filtered", kind: "directive", line: 4, className: legacy },
			{ name: "addItem", kind: "event", line: 5, className: legacy },
			{ name: "isDirty", kind: "directive", line: 6, className: legacy },
			{ name: "summary", kind: "interpolation", line: 6, className: legacy },
			{ name: "data", kind: "runtime", line: 18, className: legacy },
			{ name: "draft", kind: "runtime", line: 35, className: legacy },
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
