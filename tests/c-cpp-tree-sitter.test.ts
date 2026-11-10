import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFile } from "../src/c-cpp-tree-sitter.js";
import { isTestFile, walkFiles } from "../src/file-walker.js";
import type { ParsedFile } from "../src/types.js";

const DIR = path.resolve(__dirname, "fixtures/c-cpp");
const parse = (file: string, onTree?: Parameters<typeof parseFile>[2]) =>
	parseFile(path.join(DIR, file), file, onTree);

/** name, className, signature, lineStart-lineEnd, complexity, paramCount, isExported */
const functionsOf = (parsed: ParsedFile) =>
	parsed.functions.map((f) => [
		f.className ? `${f.className}::${f.name}` : f.name,
		f.signature,
		`${f.lineStart}-${f.lineEnd}`,
		f.complexity,
		f.paramCount,
		f.isExported,
	]);

describe("C and C++ parser", () => {
	it("reads a C++ implementation file: out-of-class methods, overloads, an unnamed namespace", () => {
		const parsed = parse("shape.cpp");
		expect(parsed.language).toBe("cpp");
		expect(parsed.loc).toBe(32);
		expect(functionsOf(parsed)).toEqual([
			["pi", "double pi()", "8-8", 1, 0, false],
			["Shape::~Shape", "Shape::~Shape()", "14-14", 1, 0, true],
			["Circle::Circle", "Circle::Circle(double radius)", "16-16", 1, 1, true],
			["Circle::area", "double Circle::area() const", "18-23", 3, 0, true],
			["Circle::unit", "Circle Circle::unit()", "25-25", 1, 0, true],
			[
				"scale",
				"double scale(double value, double factor)",
				"27-27",
				1,
				2,
				true,
			],
			["scale", "double scale(double value)", "29-29", 1, 1, true],
		]);
		// The two overloads differ in body, and an empty body has no hash
		const hashes = parsed.functions.map((f) => f.bodyHash);
		expect(hashes[5]).toMatch(/^[0-9a-f]{16}$/);
		expect(hashes[5]).not.toBe(hashes[6]);
		expect(hashes[1]).toBe("");
		expect(parsed.imports.map((i) => [i.source, i.line])).toEqual([
			["shape.h", 1],
			["<cmath>", 2],
		]);
		// `pi` is hidden by its unnamed namespace; methods are not file exports
		expect(parsed.exports).toEqual([
			{ name: "scale", kind: "function", isDefault: false },
		]);
		expect(parsed.classes).toEqual([]);
	});

	it("reads a C++ header: classes, bases, inline and template definitions, prototypes", () => {
		const parsed = parse("shape.h");
		expect(parsed.language).toBe("cpp");
		expect(functionsOf(parsed)).toEqual([
			["Shape::label", "std::string label() const", "10-10", 1, 0, true],
			["clamp", "T clamp(T value, T low, T high)", "27-29", 3, 3, true],
		]);
		expect(
			parsed.classes.map((c) => [
				c.name,
				`${c.lineStart}-${c.lineEnd}`,
				c.methods,
				c.extends,
				c.implements,
			]),
		).toEqual([
			["Shape", "6-11", ["~Shape", "area", "label"], undefined, undefined],
			["Circle", "13-21", ["Circle", "area", "unit"], "Shape", ["Tagged"]],
		]);
		expect(parsed.exports.map((e) => `${e.kind} ${e.name}`)).toEqual([
			"function scale",
			"function clamp",
			"class Shape",
			"class Circle",
		]);
		expect(parsed.imports.map((i) => i.source)).toEqual(["<string>"]);
	});

	it("reads C: static functions, a header's prototypes and struct, a scalar macro", () => {
		const source = parse("util.c");
		expect(source.language).toBe("c");
		expect(functionsOf(source)).toEqual([
			["helper", "static int helper(int x)", "6-8", 1, 1, false],
			["add", "int add(int a, int b)", "10-12", 1, 2, true],
			["sum_point", "int sum_point(const point_t *p)", "14-19", 2, 1, true],
		]);
		expect(source.imports.map((i) => i.source)).toEqual([
			"util.h",
			"<stddef.h>",
		]);
		expect(source.exports.map((e) => e.name)).toEqual(["add", "sum_point"]);

		const header = parse("util.h");
		expect(header.language).toBe("c");
		expect(header.functions).toEqual([]);
		expect(header.exports.map((e) => `${e.kind} ${e.name}`)).toEqual([
			"function add",
			"function sum_point",
			"class point",
		]);
		expect(header.classes.map((c) => [c.name, c.lineStart, c.lineEnd])).toEqual(
			[["point", 6, 9]],
		);
		expect(header.constants).toEqual([
			{
				name: "MAX_POINTS",
				value: "64",
				typeAnnotation: null,
				isExported: true,
				lineStart: 4,
				lineEnd: 4,
			},
		]);
	});

	it("keeps what it can read around a macro the grammar cannot, and says so", () => {
		let hasError = false;
		const parsed = parse("macro.c", (root) => {
			hasError = root.hasError;
		});
		// `DECLARE_HANDLER(open) {...}` is not C until preprocessed: the tree
		// reports the error and the function it would declare is absent.
		expect(hasError).toBe(true);
		// An attribute macro before the type is read through; both `#if` branches are read.
		expect(functionsOf(parsed)).toEqual([
			["api_call", "API int api_call(void)", "4-4", 1, 0, true],
			["platform", "int platform(void)", "11-11", 1, 0, true],
			["platform", "int platform(void)", "13-13", 1, 0, true],
		]);
	});

	it("reads template members, and takes neither local declarations nor code macros for definitions", () => {
		const parsed = parse("edge.cpp");
		// `Box<T>::set` belongs to Box; `lock(mu_)`, `copy(value_)`, `first(second)`
		// and `int helper(int);` inside bodies declare locals, not functions
		expect(functionsOf(parsed).map((f) => f[0])).toEqual([
			"Box::get",
			"Box::set",
			"run",
		]);
		expect(parsed.classes.map((c) => [c.name, c.methods])).toEqual([
			["Box", ["set", "get"]],
		]);
		expect(parsed.exports.map((e) => `${e.kind} ${e.name}`)).toEqual([
			"function run",
			"class Box",
		]);
		// One literal each: no secret-named macro, no code, no trailing comment
		expect(parsed.constants?.map((c) => [c.name, c.value])).toEqual([
			["COUNT", "3"],
			["RATIO", "0.5"],
			["GREETING", '"hi // there"'],
		]);
	});

	it("lists C and C++ files only when asked, and knows their test files", () => {
		const names = (files: { relativePath: string }[]) =>
			files.map((f) => f.relativePath).sort();
		expect(names(walkFiles(DIR))).toEqual([]);
		expect(names(walkFiles(DIR, { cpp: true }))).toEqual([
			"edge.cpp",
			"macro.c",
			"shape.cpp",
			"shape.h",
			"util.c",
			"util.h",
		]);
		expect(
			["src/shape_test.cc", "src/test_util.c", "src/io_unittest.cpp"].map(
				isTestFile,
			),
		).toEqual([true, true, true]);
		expect(["src/contest.c", "src/latest.cpp"].map(isTestFile)).toEqual([
			false,
			false,
		]);
	});
});
