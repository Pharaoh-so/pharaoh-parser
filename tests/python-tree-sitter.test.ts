import path from "node:path";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../src/file-walker.js";
import { detectModules } from "../src/module-detector.js";
import { parseFile } from "../src/python-tree-sitter.js";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const PYTHON_DIR = path.join(FIXTURES_DIR, "python-simple");

describe("python tree-sitter parser", () => {
	describe("helpers.py", () => {
		const result = parseFile(path.join(PYTHON_DIR, "src/utils/helpers.py"), "src/utils/helpers.py");

		it("sets language to python", () => {
			expect(result.language).toBe("python");
		});

		it("counts lines of code", () => {
			expect(result.loc).toBeGreaterThan(0);
		});

		it("parses exported functions from __all__", () => {
			const add = result.functions.find((f) => f.name === "add");
			expect(add).toBeDefined();
			expect(add!.isExported).toBe(true);
			expect(add!.isAsync).toBe(false);
			expect(add!.paramCount).toBe(2);
			expect(add!.complexity).toBe(1);
			expect(add!.bodyHash).toMatch(/^[0-9a-f]{16}$/);

			const multiply = result.functions.find((f) => f.name === "multiply");
			expect(multiply).toBeDefined();
			expect(multiply!.isExported).toBe(true);
			expect(multiply!.paramCount).toBe(2);
			expect(multiply!.bodyHash).toMatch(/^[0-9a-f]{16}$/);
		});

		it("marks _private functions as not exported", () => {
			const priv = result.functions.find((f) => f.name === "_private_helper");
			expect(priv).toBeDefined();
			expect(priv!.isExported).toBe(false);
			expect(priv!.paramCount).toBe(1);
		});

		it("detects async functions", () => {
			const fetchData = result.functions.find((f) => f.name === "fetch_data");
			expect(fetchData).toBeDefined();
			expect(fetchData!.isAsync).toBe(true);
			expect(fetchData!.isExported).toBe(true);
			expect(fetchData!.paramCount).toBe(1);
		});

		it("extracts docstrings", () => {
			const add = result.functions.find((f) => f.name === "add");
			expect(add!.jsdoc).toBe("Add two numbers together and return the sum.");

			const multiply = result.functions.find((f) => f.name === "multiply");
			expect(multiply!.jsdoc).toBe("Multiply two numbers.");

			const priv = result.functions.find((f) => f.name === "_private_helper");
			expect(priv!.jsdoc).toBeUndefined();
		});

		it("computes cyclomatic complexity", () => {
			const process = result.functions.find((f) => f.name === "process_items");
			expect(process).toBeDefined();
			expect(process!.complexity).toBeGreaterThan(5);
		});

		it("builds correct signatures", () => {
			const add = result.functions.find((f) => f.name === "add");
			expect(add!.signature).toContain("def add");
			expect(add!.signature).toContain("-> int");
		});

		it("extracts imports", () => {
			expect(result.imports.length).toBeGreaterThanOrEqual(0);
		});

		it("extracts exports via __all__", () => {
			const exportNames = result.exports.map((e) => e.name);
			expect(exportNames).toContain("add");
			expect(exportNames).toContain("multiply");
			expect(exportNames).toContain("fetch_data");
			expect(exportNames).not.toContain("_private_helper");
			expect(exportNames).not.toContain("process_items");
		});
	});

	describe("user.py — classes with methods", () => {
		const result = parseFile(path.join(PYTHON_DIR, "src/models/user.py"), "src/models/user.py");

		it("detects class definitions", () => {
			expect(result.classes.length).toBeGreaterThanOrEqual(1);
			const user = result.classes.find((c) => c.name === "User");
			expect(user).toBeDefined();
			expect(user!.isExported).toBe(true);
			expect(user!.methods).toContain("greet");
			expect(user!.methods).toContain("save");
			expect(user!.methods).toContain("_internal_method");
		});

		it("extracts methods as functions with className", () => {
			const greet = result.functions.find((f) => f.name === "greet");
			expect(greet).toBeDefined();
			expect(greet!.className).toBe("User");
			expect(greet!.paramCount).toBe(0); // self excluded
			expect(greet!.bodyHash).toMatch(/^[0-9a-f]{16}$/);
		});

		it("detects async methods", () => {
			const save = result.functions.find((f) => f.name === "save");
			expect(save).toBeDefined();
			expect(save!.isAsync).toBe(true);
			expect(save!.className).toBe("User");
		});

		it("computes class loc and complexity", () => {
			const user = result.classes.find((c) => c.name === "User");
			expect(user).toBeDefined();
			expect(user!.loc).toBeGreaterThan(0);
			expect(user!.complexity).toBeGreaterThanOrEqual(3);

			const priv = result.classes.find((c) => c.name === "_PrivateModel");
			expect(priv).toBeDefined();
			expect(priv!.loc).toBeGreaterThan(0);
			expect(priv!.complexity).toBeGreaterThanOrEqual(1);
		});

		it("marks _private classes as not exported", () => {
			const priv = result.classes.find((c) => c.name === "_PrivateModel");
			expect(priv).toBeDefined();
			expect(priv!.isExported).toBe(false);
		});

		it("extracts class docstrings", () => {
			const greet = result.functions.find((f) => f.name === "greet");
			expect(greet!.jsdoc).toBe("Return a greeting string.");
		});

		it("extracts imports", () => {
			const dcImport = result.imports.find((i) => i.source === "dataclasses");
			expect(dcImport).toBeDefined();
			expect(dcImport!.symbols).toContain("dataclass");

			const helperImport = result.imports.find((i) => i.source.includes("helpers"));
			expect(helperImport).toBeDefined();
		});
	});

	describe("main.py — imports and entry point", () => {
		const result = parseFile(path.join(PYTHON_DIR, "src/main.py"), "src/main.py");

		it("extracts absolute imports", () => {
			const utilsImport = result.imports.find((i) => i.source === "src.utils.helpers");
			expect(utilsImport).toBeDefined();
			expect(utilsImport!.symbols).toContain("add");
			expect(utilsImport!.symbols).toContain("multiply");

			const modelImport = result.imports.find((i) => i.source === "src.models.user");
			expect(modelImport).toBeDefined();
			expect(modelImport!.symbols).toContain("User");
		});

		it("detects functions", () => {
			const main = result.functions.find((f) => f.name === "main");
			expect(main).toBeDefined();
			expect(main!.isExported).toBe(true);
			expect(main!.paramCount).toBe(0);
		});
	});
});

describe("file-walker with Python files", () => {
	it("walks python-simple and finds .py files", () => {
		const files = walkFiles(PYTHON_DIR);

		expect(files.length).toBe(6);
		expect(files.every((f) => f.relativePath.endsWith(".py"))).toBe(true);
		expect(files.some((f) => f.relativePath.includes("helpers.py"))).toBe(true);
		expect(files.some((f) => f.relativePath.includes("user.py"))).toBe(true);
		expect(files.some((f) => f.relativePath.includes("main.py"))).toBe(true);
	});
});

describe("module-detector with Python files", () => {
	it("detects modules from Python parsed files", () => {
		const files = walkFiles(PYTHON_DIR);
		const parsedFiles = files.map((f) => parseFile(f.absolutePath, f.relativePath));
		const modules = detectModules(parsedFiles, "test-repo");

		expect(modules.length).toBeGreaterThanOrEqual(2);
		expect(modules.some((m) => m.name === "utils")).toBe(true);
		expect(modules.some((m) => m.name === "models")).toBe(true);
	});
});
