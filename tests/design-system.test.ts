import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFile } from "../src/tree-sitter.js";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures/design-system");

// ── Destructured params + propsType ──

describe("destructured params extraction", () => {
	it("extracts destructured param names from function declaration", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const button = result.functions.find((f) => f.name === "Button");
		expect(button).toBeDefined();
		expect(button!.destructuredParams).toEqual(["variant", "size", "onClick"]);
		expect(button!.propsType).toBe("ButtonProps");
	});

	it("extracts propsType without destructuring (opaque props)", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const card = result.functions.find((f) => f.name === "Card");
		expect(card).toBeDefined();
		expect(card!.destructuredParams).toBeUndefined();
		expect(card!.propsType).toBe("CardProps");
	});

	it("returns undefined for functions with no params", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const divider = result.functions.find((f) => f.name === "Divider");
		expect(divider).toBeDefined();
		expect(divider!.destructuredParams).toBeUndefined();
		expect(divider!.propsType).toBeUndefined();
	});

	it("extracts destructured params from arrow functions", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const input = result.functions.find((f) => f.name === "Input");
		expect(input).toBeDefined();
		expect(input!.destructuredParams).toEqual([
			"value",
			"onChange",
			"placeholder",
		]);
		expect(input!.propsType).toBe("InputProps");
	});

	it("extracts propsType from arrow functions without destructuring", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const select = result.functions.find((f) => f.name === "Select");
		expect(select).toBeDefined();
		expect(select!.destructuredParams).toBeUndefined();
		expect(select!.propsType).toBe("SelectProps");
	});

	it("extracts destructured params from class methods", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const render = result.functions.find(
			(f) => f.name === "render" && f.className === "Dialog",
		);
		expect(render).toBeDefined();
		expect(render!.destructuredParams).toEqual(["open", "onClose"]);
		expect(render!.propsType).toBe("DialogProps");
	});

	it("extracts default-valued destructured params", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const badge = result.functions.find((f) => f.name === "Badge");
		expect(badge).toBeDefined();
		expect(badge!.destructuredParams).toEqual(["variant", "size", "rest"]);
		expect(badge!.propsType).toBe("BadgeProps");
	});

	it("extracts renamed destructured props (pair_pattern)", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const iconBtn = result.functions.find((f) => f.name === "IconButton");
		expect(iconBtn).toBeDefined();
		// Keys (prop names), not local aliases
		expect(iconBtn!.destructuredParams).toEqual(["onClick", "icon"]);
		expect(iconBtn!.propsType).toBe("IconButtonProps");
	});

	it("returns undefined propsType for inline object types", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const inline = result.functions.find((f) => f.name === "Inline");
		expect(inline).toBeDefined();
		expect(inline!.destructuredParams).toEqual(["x", "y"]);
		// Inline object types don't produce a named propsType
		expect(inline!.propsType).toBeUndefined();
	});
});

// ── JSX intrinsics ──

describe("JSX intrinsics extraction", () => {
	it("extracts curated intrinsic elements from function body", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const button = result.functions.find((f) => f.name === "Button");
		expect(button).toBeDefined();
		expect(button!.jsxIntrinsics).toEqual(["button"]);
	});

	it("extracts multiple intrinsics and deduplicates", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const form = result.functions.find((f) => f.name === "Form");
		expect(form).toBeDefined();
		// form, input, textarea, button — all in curated set
		expect(form!.jsxIntrinsics).toEqual(
			expect.arrayContaining(["form", "input", "textarea", "button"]),
		);
		expect(form!.jsxIntrinsics).toHaveLength(4);
	});

	it("returns undefined when only non-curated elements are used", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const layout = result.functions.find((f) => f.name === "Layout");
		expect(layout).toBeDefined();
		// div and span are NOT in the curated set
		expect(layout!.jsxIntrinsics).toBeUndefined();
	});

	it("extracts img and a elements", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const media = result.functions.find((f) => f.name === "MediaCard");
		expect(media).toBeDefined();
		expect(media!.jsxIntrinsics).toEqual(expect.arrayContaining(["img", "a"]));
		expect(media!.jsxIntrinsics).toHaveLength(2);
	});

	it("returns undefined for non-JSX functions", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const compute = result.functions.find((f) => f.name === "compute");
		expect(compute).toBeDefined();
		expect(compute!.jsxIntrinsics).toBeUndefined();
	});

	it("extracts dialog from class method body", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const render = result.functions.find(
			(f) => f.name === "render" && f.className === "Dialog",
		);
		expect(render).toBeDefined();
		expect(render!.jsxIntrinsics).toEqual(
			expect.arrayContaining(["dialog", "button"]),
		);
		expect(render!.jsxIntrinsics).toHaveLength(2);
	});

	it("extracts self-closing intrinsic elements (input)", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		const input = result.functions.find((f) => f.name === "Input");
		expect(input).toBeDefined();
		expect(input!.jsxIntrinsics).toEqual(["input"]);
	});
});

// ── Constant extraction ──

describe("constant extraction", () => {
	it("extracts exported string constant with value", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const primary = result.constants?.find((c) => c.name === "PRIMARY");
		expect(primary).toBeDefined();
		expect(primary!.value).toBe("#1a1a2e");
		expect(primary!.isExported).toBe(true);
		expect(primary!.typeAnnotation).toBeNull();
	});

	it("extracts exported number constant with value", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const retries = result.constants?.find((c) => c.name === "MAX_RETRIES");
		expect(retries).toBeDefined();
		expect(retries!.value).toBe("3");
		expect(retries!.isExported).toBe(true);
	});

	it("sets value: null for object constants", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const config = result.constants?.find((c) => c.name === "config");
		expect(config).toBeDefined();
		expect(config!.value).toBeNull();
		expect(config!.isExported).toBe(true);
	});

	it("sets value: null for array constants", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const colors = result.constants?.find((c) => c.name === "COLORS");
		expect(colors).toBeDefined();
		expect(colors!.value).toBeNull();
		expect(colors!.isExported).toBe(true);
	});

	it("marks non-exported constants correctly", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const internal = result.constants?.find((c) => c.name === "INTERNAL_KEY");
		expect(internal).toBeDefined();
		expect(internal!.value).toBe("secret-key-123");
		expect(internal!.isExported).toBe(false);
	});

	it("extracts type annotation when present", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const apiUrl = result.constants?.find((c) => c.name === "API_URL");
		expect(apiUrl).toBeDefined();
		expect(apiUrl!.value).toBe("https://api.example.com");
		expect(apiUrl!.typeAnnotation).toBe("string");
		expect(apiUrl!.isExported).toBe(true);
	});

	it("extracts complex type annotation", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const headers = result.constants?.find((c) => c.name === "HEADERS");
		expect(headers).toBeDefined();
		expect(headers!.typeAnnotation).toBe("Record<string, string>");
		expect(headers!.value).toBeNull(); // object value
	});

	it("extracts template literal without interpolation", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const greeting = result.constants?.find((c) => c.name === "GREETING");
		expect(greeting).toBeDefined();
		expect(greeting!.value).toBe("Hello World");
	});

	it("sets value: null for template literal WITH interpolation", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const message = result.constants?.find((c) => c.name === "MESSAGE");
		expect(message).toBeDefined();
		expect(message!.value).toBeNull();
	});

	it("does NOT include arrow function constants (they are ParsedFunction)", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const helper = result.constants?.find((c) => c.name === "helper");
		expect(helper).toBeUndefined();

		// But it should appear as a function
		const helperFn = result.functions.find((f) => f.name === "helper");
		expect(helperFn).toBeDefined();
	});

	it("sets value: null for string constants > 128 chars", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const longVal = result.constants?.find((c) => c.name === "LONG_VALUE");
		expect(longVal).toBeDefined();
		expect(longVal!.value).toBeNull();
	});

	it("sets value: null for new expression constants", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const instance = result.constants?.find((c) => c.name === "instance");
		expect(instance).toBeDefined();
		expect(instance!.value).toBeNull();
	});

	it("sets value: null for call expression constants", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const timestamp = result.constants?.find((c) => c.name === "timestamp");
		expect(timestamp).toBeDefined();
		expect(timestamp!.value).toBeNull();
		expect(timestamp!.isExported).toBe(true);
	});

	it("unwraps 'as const' on scalar values", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const version = result.constants?.find((c) => c.name === "API_VERSION");
		expect(version).toBeDefined();
		expect(version!.value).toBe("v2");
		expect(version!.isExported).toBe(true);
	});

	it("sets value: null for 'as const' on non-scalar values", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const sizes = result.constants?.find((c) => c.name === "SIZES");
		expect(sizes).toBeDefined();
		expect(sizes!.value).toBeNull();
	});

	it("excludes let/var declarations from constants", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/constants.ts"),
			"src/constants.ts",
		);

		const mutable = result.constants?.find((c) => c.name === "mutableVal");
		expect(mutable).toBeUndefined();
		const another = result.constants?.find((c) => c.name === "anotherVal");
		expect(another).toBeUndefined();
	});

	it("omits constants field for files with no constants", () => {
		const result = parseFile(
			path.join(FIXTURES_DIR, "src/components.tsx"),
			"src/components.tsx",
		);

		// components.tsx has arrow function consts (treated as functions, not constants)
		expect(result.constants).toBeUndefined();
	});
});

// ── Regression: existing parsing unaffected ──

describe("regression — new fields do not break existing parsing", () => {
	const simpleDir = path.resolve(__dirname, "fixtures/simple-module");

	it("existing functions still parse correctly", () => {
		const result = parseFile(
			path.join(simpleDir, "src/utils/helpers.ts"),
			"src/utils/helpers.ts",
		);

		expect(result.functions).toHaveLength(4);

		const add = result.functions.find((f) => f.name === "add");
		expect(add).toBeDefined();
		expect(add!.paramCount).toBe(2);
		// New fields should be undefined for non-component functions
		expect(add!.destructuredParams).toBeUndefined();
		expect(add!.propsType).toBeUndefined();
		expect(add!.jsxIntrinsics).toBeUndefined();
	});
});
