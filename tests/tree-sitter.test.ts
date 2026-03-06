import path from "node:path";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../src/file-walker.js";
import { detectModules } from "../src/module-detector.js";
import { parseFile } from "../src/tree-sitter.js";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

describe("tree-sitter parser", () => {
	describe("simple-module", () => {
		const simpleDir = path.join(FIXTURES_DIR, "simple-module");

		it("parses helpers.ts — exported functions + arrow functions", () => {
			const result = parseFile(
				path.join(simpleDir, "src/utils/helpers.ts"),
				"src/utils/helpers.ts",
			);

			expect(result.language).toBe("typescript");
			expect(result.loc).toBeGreaterThan(0);

			// Should find: add, multiply, privateHelper, fetchData
			expect(result.functions).toHaveLength(4);

			const add = result.functions.find((f) => f.name === "add");
			expect(add).toBeDefined();
			expect(add!.isExported).toBe(true);
			expect(add!.isAsync).toBe(false);
			expect(add!.complexity).toBe(1); // no branches
			expect(add!.bodyHash).toMatch(/^[0-9a-f]{16}$/);
			expect(add!.paramCount).toBe(2);

			const multiply = result.functions.find((f) => f.name === "multiply");
			expect(multiply).toBeDefined();
			expect(multiply!.isExported).toBe(true);
			expect(multiply!.bodyHash).toMatch(/^[0-9a-f]{16}$/);
			expect(multiply!.paramCount).toBe(2);

			const privateHelper = result.functions.find(
				(f) => f.name === "privateHelper",
			);
			expect(privateHelper).toBeDefined();
			expect(privateHelper!.isExported).toBe(false);
			expect(privateHelper!.bodyHash).toMatch(/^[0-9a-f]{16}$/);
			expect(privateHelper!.paramCount).toBe(1);

			const fetchData = result.functions.find((f) => f.name === "fetchData");
			expect(fetchData).toBeDefined();
			expect(fetchData!.isAsync).toBe(true);
			expect(fetchData!.isExported).toBe(true);
			expect(fetchData!.bodyHash).toMatch(/^[0-9a-f]{16}$/);
			expect(fetchData!.paramCount).toBe(1);
		});

		it("parses User.ts — classes with methods", () => {
			const result = parseFile(
				path.join(simpleDir, "src/models/User.ts"),
				"src/models/User.ts",
			);

			expect(result.classes).toHaveLength(1);
			const user = result.classes[0];
			expect(user.name).toBe("User");
			expect(user.isExported).toBe(true);
			expect(user.methods).toContain("greet");
			expect(user.methods).toContain("save");
			expect(user.methods).toContain("constructor");

			// Class-level metrics
			expect(user.loc).toBeGreaterThan(0);
			expect(user.complexity).toBeGreaterThanOrEqual(3);

			// Methods should also appear as functions with className
			const greet = result.functions.find((f) => f.name === "greet");
			expect(greet).toBeDefined();
			expect(greet!.className).toBe("User");
			expect(greet!.bodyHash).toMatch(/^[0-9a-f]{16}$/);
			expect(greet!.paramCount).toBe(0);

			const save = result.functions.find((f) => f.name === "save");
			expect(save).toBeDefined();
			expect(save!.isAsync).toBe(true);
			expect(save!.className).toBe("User");
			expect(typeof save!.bodyHash).toBe("string");
			expect(save!.paramCount).toBe(0);

			// Should have UserInput type export
			const typeExport = result.exports.find((e) => e.name === "UserInput");
			expect(typeExport).toBeDefined();
			expect(typeExport!.kind).toBe("type");
		});

		it("parses index.ts — imports and default export", () => {
			const result = parseFile(
				path.join(simpleDir, "src/index.ts"),
				"src/index.ts",
			);

			expect(result.imports).toHaveLength(1);
			expect(result.imports[0].source).toBe("./utils/helpers");
			expect(result.imports[0].symbols).toContain("add");
			expect(result.imports[0].symbols).toContain("multiply");

			const defaultExport = result.exports.find((e) => e.isDefault);
			expect(defaultExport).toBeDefined();
		});
	});

	describe("complex-module", () => {
		const complexDir = path.join(FIXTURES_DIR, "complex-module");

		it("computes cyclomatic complexity for processor.ts", () => {
			const result = parseFile(
				path.join(complexDir, "src/services/processor.ts"),
				"src/services/processor.ts",
			);

			const processItems = result.functions.find(
				(f) => f.name === "processItems",
			);
			expect(processItems).toBeDefined();
			expect(processItems!.complexity).toBeGreaterThan(5);
			expect(processItems!.isAsync).toBe(true);
			expect(processItems!.isExported).toBe(true);

			const transform = result.functions.find((f) => f.name === "transform");
			expect(transform).toBeDefined();
			expect(transform!.complexity).toBe(1); // no branches
		});

		it("detects re-exports", () => {
			const result = parseFile(
				path.join(complexDir, "src/re-exports.ts"),
				"src/re-exports.ts",
			);

			const reExports = result.exports.filter((e) => e.kind === "re-export");
			expect(reExports.length).toBeGreaterThanOrEqual(2);
			expect(reExports.some((e) => e.name === "processItems")).toBe(true);
			expect(reExports.some((e) => e.name === "transform")).toBe(true);
		});

		it("parses type exports", () => {
			const result = parseFile(
				path.join(complexDir, "src/types.ts"),
				"src/types.ts",
			);

			expect(
				result.exports.some((e) => e.name === "Config" && e.kind === "type"),
			).toBe(true);
			expect(
				result.exports.some(
					(e) => e.name === "ProcessResult" && e.kind === "type",
				),
			).toBe(true);
		});
	});
});

describe("JSDoc extraction", () => {
	const visionDocsDir = path.join(FIXTURES_DIR, "vision-docs");

	it("extracts JSDoc from regular functions", () => {
		const result = parseFile(
			path.join(visionDocsDir, "src/utils/helpers.ts"),
			"src/utils/helpers.ts",
		);

		const add = result.functions.find((f) => f.name === "add");
		expect(add).toBeDefined();
		expect(add!.jsdoc).toBe("Add two numbers together and return the sum.");
	});

	it("extracts JSDoc from arrow functions", () => {
		const result = parseFile(
			path.join(visionDocsDir, "src/utils/helpers.ts"),
			"src/utils/helpers.ts",
		);

		const multiply = result.functions.find((f) => f.name === "multiply");
		expect(multiply).toBeDefined();
		expect(multiply!.jsdoc).toBe("Multiply two numbers");
	});

	it("returns undefined for functions without JSDoc", () => {
		const result = parseFile(
			path.join(visionDocsDir, "src/utils/helpers.ts"),
			"src/utils/helpers.ts",
		);

		const privateHelper = result.functions.find(
			(f) => f.name === "privateHelper",
		);
		expect(privateHelper).toBeDefined();
		expect(privateHelper!.jsdoc).toBeUndefined();
	});

	it("handles multi-line JSDoc", () => {
		const result = parseFile(
			path.join(visionDocsDir, "src/utils/helpers.ts"),
			"src/utils/helpers.ts",
		);

		const fetchData = result.functions.find((f) => f.name === "fetchData");
		expect(fetchData).toBeDefined();
		expect(fetchData!.jsdoc).toContain("Fetch data from a remote URL");
		expect(fetchData!.jsdoc).toContain("router module");
	});
});

describe("file-walker", () => {
	it("walks simple-module and finds .ts files", () => {
		const simpleDir = path.join(FIXTURES_DIR, "simple-module");
		const files = walkFiles(simpleDir);

		expect(files.length).toBe(3);
		expect(files.every((f) => f.relativePath.endsWith(".ts"))).toBe(true);
		expect(files.some((f) => f.relativePath.includes("helpers.ts"))).toBe(true);
		expect(files.some((f) => f.relativePath.includes("User.ts"))).toBe(true);
	});

	it("walks complex-module and finds .ts files", () => {
		const complexDir = path.join(FIXTURES_DIR, "complex-module");
		const files = walkFiles(complexDir);

		expect(files.length).toBe(4);
		expect(files.every((f) => f.relativePath.endsWith(".ts"))).toBe(true);
	});
});

describe("dynamic import extraction", () => {
	const fixtureFile = path.join(
		FIXTURES_DIR,
		"dynamic-import-patterns/dynamic-imports.ts",
	);

	it("extracts destructured dynamic imports: const { a, b } = await import(...)", () => {
		const result = parseFile(fixtureFile, "dynamic-imports.ts");

		const destructured = result.imports.find(
			(i) => i.source === "./destructured-module.js",
		);
		expect(destructured).toBeDefined();
		expect(destructured!.symbols).toEqual(["a", "b"]);
		expect(destructured!.isNamespace).toBe(false);
		expect(destructured!.isDefault).toBe(false);
	});

	it("extracts namespace dynamic imports: const mod = await import(...)", () => {
		const result = parseFile(fixtureFile, "dynamic-imports.ts");

		const namespace = result.imports.find(
			(i) => i.source === "./namespace-module.js",
		);
		expect(namespace).toBeDefined();
		expect(namespace!.symbols).toEqual(["mod"]);
		expect(namespace!.isNamespace).toBe(true);
	});

	it("extracts aliased destructured dynamic imports: const { Foo: bar } = await import(...)", () => {
		const result = parseFile(fixtureFile, "dynamic-imports.ts");

		const aliased = result.imports.find(
			(i) => i.source === "./aliased-module.js",
		);
		expect(aliased).toBeDefined();
		expect(aliased!.symbols).toEqual(["bar"]);
		expect(aliased!.aliases).toEqual([{ local: "bar", original: "Foo" }]);
	});

	it("skips bare dynamic imports with no assignment", () => {
		const result = parseFile(fixtureFile, "dynamic-imports.ts");

		const bare = result.imports.find((i) => i.source === "./bare-module.js");
		expect(bare).toBeUndefined();
	});

	it("preserves static imports alongside dynamic imports", () => {
		const result = parseFile(fixtureFile, "dynamic-imports.ts");

		const staticImport = result.imports.find(
			(i) => i.source === "./static-module.js",
		);
		expect(staticImport).toBeDefined();
		expect(staticImport!.symbols).toEqual(["staticFn"]);
	});

	it("produces entries for both static and dynamic imports in same file", () => {
		const result = parseFile(fixtureFile, "dynamic-imports.ts");

		// 1 static + 5 dynamic (destructured, namespace, aliased, inner, multi) = 6 total
		expect(result.imports).toHaveLength(6);
	});

	it("captures dynamic imports inside function bodies", () => {
		const result = parseFile(fixtureFile, "dynamic-imports.ts");

		const inner = result.imports.find((i) => i.source === "./inner-module.js");
		expect(inner).toBeDefined();
		expect(inner!.symbols).toEqual(["inner"]);
		expect(inner!.isNamespace).toBe(false);
	});

	it("captures multiple destructured symbols from dynamic import", () => {
		const result = parseFile(fixtureFile, "dynamic-imports.ts");

		const multi = result.imports.find((i) => i.source === "./multi-module.js");
		expect(multi).toBeDefined();
		expect(multi!.symbols).toEqual(["x", "y", "z"]);
	});
});

describe("module-detector", () => {
	it("detects modules from parsed files", () => {
		const simpleDir = path.join(FIXTURES_DIR, "simple-module");
		const files = walkFiles(simpleDir);
		const parsedFiles = files.map((f) =>
			parseFile(f.absolutePath, f.relativePath),
		);
		const modules = detectModules(parsedFiles, "test-repo");

		expect(modules.length).toBe(3);
		expect(modules.some((m) => m.name === "utils")).toBe(true);
		expect(modules.some((m) => m.name === "models")).toBe(true);
		expect(modules.some((m) => m.name === "root")).toBe(true);

		const utils = modules.find((m) => m.name === "utils")!;
		expect(utils.files).toHaveLength(1);
		expect(utils.loc).toBeGreaterThan(0);
	});
});
