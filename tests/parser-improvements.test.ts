import path from "node:path";
import { describe, expect, it } from "vitest";
import { walkFiles } from "../src/file-walker.js";
import { parseFile as parsePythonFile } from "../src/python-tree-sitter.js";
import { parseFile } from "../src/tree-sitter.js";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");

// ── Python decorator extraction ──

describe("python decorator extraction", () => {
	const ADVANCED_DIR = path.join(FIXTURES_DIR, "python-advanced");

	it("extracts decorators from standalone decorated functions", () => {
		const result = parsePythonFile(
			path.join(ADVANCED_DIR, "src/decorators.py"),
			"src/decorators.py",
		);

		const fn = result.functions.find((f) => f.name === "standalone_decorated");
		expect(fn).toBeDefined();
		expect(fn!.decorators).toEqual(["@my_decorator"]);
	});

	it("extracts stacked decorators from standalone functions", () => {
		const result = parsePythonFile(
			path.join(ADVANCED_DIR, "src/decorators.py"),
			"src/decorators.py",
		);

		const fn = result.functions.find((f) => f.name === "double_decorated");
		expect(fn).toBeDefined();
		expect(fn!.decorators).toEqual(['@log_calls("debug")', "@my_decorator"]);
	});

	it("extracts decorators from class methods", () => {
		const result = parsePythonFile(
			path.join(ADVANCED_DIR, "src/decorators.py"),
			"src/decorators.py",
		);

		const createId = result.functions.find((f) => f.name === "create_id");
		expect(createId).toBeDefined();
		expect(createId!.decorators).toEqual(["@staticmethod"]);

		const fromConfig = result.functions.find((f) => f.name === "from_config");
		expect(fromConfig).toBeDefined();
		expect(fromConfig!.decorators).toEqual(["@classmethod"]);

		const name = result.functions.find(
			(f) => f.name === "name" && f.className === "Service",
		);
		expect(name).toBeDefined();
		expect(name!.decorators).toEqual(["@property"]);
	});

	it("extracts custom decorator with arguments on method", () => {
		const result = parsePythonFile(
			path.join(ADVANCED_DIR, "src/decorators.py"),
			"src/decorators.py",
		);

		const process = result.functions.find(
			(f) => f.name === "process" && f.className === "Service",
		);
		expect(process).toBeDefined();
		expect(process!.decorators).toEqual(["@my_decorator"]);
	});

	it("extracts stacked decorators on methods", () => {
		const result = parsePythonFile(
			path.join(ADVANCED_DIR, "src/decorators.py"),
			"src/decorators.py",
		);

		const handle = result.functions.find(
			(f) => f.name === "handle" && f.className === "Service",
		);
		expect(handle).toBeDefined();
		expect(handle!.decorators).toEqual(['@log_calls("info")', "@my_decorator"]);
	});

	it("omits decorators field for undecorated functions", () => {
		const result = parsePythonFile(
			path.join(ADVANCED_DIR, "src/decorators.py"),
			"src/decorators.py",
		);

		const myDecorator = result.functions.find((f) => f.name === "my_decorator");
		expect(myDecorator).toBeDefined();
		expect(myDecorator!.decorators).toBeUndefined();
	});
});

// ── TypeScript enum extraction ──

describe("typescript enum extraction", () => {
	const JS_DIR = path.join(FIXTURES_DIR, "js-support");

	it("extracts exported enums as type exports", () => {
		const result = parseFile(path.join(JS_DIR, "src/enums.ts"), "src/enums.ts");

		const statusExport = result.exports.find((e) => e.name === "Status");
		expect(statusExport).toBeDefined();
		expect(statusExport!.kind).toBe("type");
		expect(statusExport!.isDefault).toBe(false);

		const directionExport = result.exports.find((e) => e.name === "Direction");
		expect(directionExport).toBeDefined();
		expect(directionExport!.kind).toBe("type");
	});

	it("does not extract non-exported enums as exports", () => {
		const result = parseFile(path.join(JS_DIR, "src/enums.ts"), "src/enums.ts");

		const internalExport = result.exports.find(
			(e) => e.name === "InternalState",
		);
		expect(internalExport).toBeUndefined();
	});

	it("still extracts interface and function exports alongside enums", () => {
		const result = parseFile(path.join(JS_DIR, "src/enums.ts"), "src/enums.ts");

		const configExport = result.exports.find((e) => e.name === "Config");
		expect(configExport).toBeDefined();
		expect(configExport!.kind).toBe("type");

		const fnExport = result.exports.find((e) => e.name === "getStatus");
		expect(fnExport).toBeDefined();
		expect(fnExport!.kind).toBe("function");
	});
});

// ── JavaScript file support ──

describe("javascript file support", () => {
	const JS_DIR = path.join(FIXTURES_DIR, "js-support");

	it("parses .js files with language='javascript'", () => {
		const result = parseFile(
			path.join(JS_DIR, "src/helpers.js"),
			"src/helpers.js",
		);

		expect(result.language).toBe("javascript");
		expect(result.loc).toBeGreaterThan(0);
	});

	it("extracts functions from .js files", () => {
		const result = parseFile(
			path.join(JS_DIR, "src/helpers.js"),
			"src/helpers.js",
		);

		const add = result.functions.find((f) => f.name === "add");
		expect(add).toBeDefined();
		expect(add!.paramCount).toBe(2);
		expect(add!.jsdoc).toBe("A helper that adds two numbers.");

		const multiply = result.functions.find((f) => f.name === "multiply");
		expect(multiply).toBeDefined();
		expect(multiply!.paramCount).toBe(2);
	});

	it("extracts classes from .js files", () => {
		const result = parseFile(
			path.join(JS_DIR, "src/helpers.js"),
			"src/helpers.js",
		);

		const calc = result.classes.find((c) => c.name === "Calculator");
		expect(calc).toBeDefined();
		expect(calc!.methods).toContain("constructor");
		expect(calc!.methods).toContain("add");
		expect(calc!.methods).toContain("reset");
	});

	it("parses .jsx files with language='jsx'", () => {
		const result = parseFile(path.join(JS_DIR, "src/app.jsx"), "src/app.jsx");

		expect(result.language).toBe("jsx");
		expect(result.loc).toBeGreaterThan(0);

		const appFn = result.functions.find((f) => f.name === "App");
		expect(appFn).toBeDefined();
	});

	it("file walker picks up .js and .jsx files", () => {
		const files = walkFiles(JS_DIR);

		const jsFiles = files.filter((f) => f.relativePath.endsWith(".js"));
		expect(jsFiles.length).toBeGreaterThanOrEqual(2);

		const jsxFiles = files.filter((f) => f.relativePath.endsWith(".jsx"));
		expect(jsxFiles.length).toBeGreaterThanOrEqual(1);

		// TS files should still be picked up
		const tsFiles = files.filter((f) => f.relativePath.endsWith(".ts"));
		expect(tsFiles.length).toBeGreaterThanOrEqual(1);
	});
});

// ── CommonJS require() extraction ──

describe("commonjs require extraction", () => {
	const JS_DIR = path.join(FIXTURES_DIR, "js-support");

	it("extracts namespace require: const path = require('path')", () => {
		const result = parseFile(
			path.join(JS_DIR, "src/require-patterns.js"),
			"src/require-patterns.js",
		);

		const pathImport = result.imports.find((i) => i.source === "path");
		expect(pathImport).toBeDefined();
		expect(pathImport!.symbols).toEqual(["path"]);
		expect(pathImport!.isNamespace).toBe(true);
	});

	it("extracts destructured require: const { a, b } = require('fs')", () => {
		const result = parseFile(
			path.join(JS_DIR, "src/require-patterns.js"),
			"src/require-patterns.js",
		);

		const fsImport = result.imports.find((i) => i.source === "fs");
		expect(fsImport).toBeDefined();
		expect(fsImport!.symbols).toContain("readFileSync");
		expect(fsImport!.symbols).toContain("writeFileSync");
		expect(fsImport!.isNamespace).toBe(false);
	});

	it("extracts relative require: const { add } = require('./helpers')", () => {
		const result = parseFile(
			path.join(JS_DIR, "src/require-patterns.js"),
			"src/require-patterns.js",
		);

		const helpersImport = result.imports.find((i) => i.source === "./helpers");
		expect(helpersImport).toBeDefined();
		expect(helpersImport!.symbols).toContain("add");
		expect(helpersImport!.symbols).toContain("multiply");
	});

	it("extracts JSON require: const config = require('./config.json')", () => {
		const result = parseFile(
			path.join(JS_DIR, "src/require-patterns.js"),
			"src/require-patterns.js",
		);

		const configImport = result.imports.find(
			(i) => i.source === "./config.json",
		);
		expect(configImport).toBeDefined();
		expect(configImport!.symbols).toEqual(["config"]);
		expect(configImport!.isNamespace).toBe(true);
	});

	it("extracts functions from files with require()", () => {
		const result = parseFile(
			path.join(JS_DIR, "src/require-patterns.js"),
			"src/require-patterns.js",
		);

		const processFile = result.functions.find((f) => f.name === "processFile");
		expect(processFile).toBeDefined();
		expect(processFile!.paramCount).toBe(1);
	});
});

// ── Regression: existing tests should still pass ──

describe("regression — existing TS parsing unchanged", () => {
	const simpleDir = path.join(FIXTURES_DIR, "simple-module");

	it("helpers.ts still has 4 functions", () => {
		const result = parseFile(
			path.join(simpleDir, "src/utils/helpers.ts"),
			"src/utils/helpers.ts",
		);

		expect(result.language).toBe("typescript");
		expect(result.functions).toHaveLength(4);
	});

	it("User.ts still has 1 class with methods", () => {
		const result = parseFile(
			path.join(simpleDir, "src/models/User.ts"),
			"src/models/User.ts",
		);

		expect(result.classes).toHaveLength(1);
		expect(result.classes[0].methods).toContain("greet");
	});
});

describe("regression — existing Python parsing unchanged", () => {
	const PYTHON_DIR = path.join(FIXTURES_DIR, "python-simple");

	it("helpers.py still exports correctly", () => {
		const result = parsePythonFile(
			path.join(PYTHON_DIR, "src/utils/helpers.py"),
			"src/utils/helpers.py",
		);

		expect(result.language).toBe("python");
		const add = result.functions.find((f) => f.name === "add");
		expect(add).toBeDefined();
		expect(add!.isExported).toBe(true);
	});
});
