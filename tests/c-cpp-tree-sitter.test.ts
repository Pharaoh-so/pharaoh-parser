import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	blankMacros,
	collectAttributeMacros,
	firstBranches,
} from "../src/c-cpp-macros.js";
import { parseFile, recoveryReparses } from "../src/c-cpp-tree-sitter.js";
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

	it("reads a file through the macros the grammar cannot, and marks what it read that way", () => {
		let hasError = true;
		const parsed = parse("macro.c", (root) => {
			hasError = root.hasError;
		});
		// `API` is blanked as an attribute; `DECLARE_HANDLER(open) {...}` is not
		// read as a function, and no name is invented for it
		expect(hasError).toBe(false);
		expect(parsed.recovered).toBe(true);
		// Only `API`'s line was rewritten: every other line reads as written
		expect(parsed.rewrittenLines).toEqual([4]);
		expect(functionsOf(parsed)).toEqual([
			["api_call", "int api_call(void)", "4-4", 1, 0, true],
			["platform", "int platform(void)", "11-11", 1, 0, true],
			["platform", "int platform(void)", "13-13", 1, 0, true],
		]);

		const cpp = parse("recovery.cpp", (root) => {
			hasError = root.hasError;
		});
		expect(hasError).toBe(false);
		expect(cpp.recovered).toBe(true);
		// Lines are the file's as written; signatures read without the macros. The
		// read as written took `empty` for a free function: only the method is kept.
		expect(functionsOf(cpp)).toEqual([
			["Widget::size", "int size() const", "7-7", 1, 0, true],
			["Widget::empty", "bool empty() const", "9-9", 1, 0, true],
			["twice", "auto twice(T value) -> T", "16-19", 2, 1, true],
			["connect", "int connect(int fd)", "21-30", 2, 1, true],
		]);
		expect(
			cpp.classes.map((c) => [
				c.name,
				`${c.lineStart}-${c.lineEnd}`,
				c.methods,
			]),
		).toEqual([["Widget", "5-13", ["size", "Lock", "empty"]]]);
		expect(cpp.imports.map((i) => i.source)).toEqual(["recovery.h"]);
		// A file the grammar reads as written is not marked
		expect(parse("shape.cpp").recovered).toBeUndefined();
		expect(parse("shape.cpp").rewrittenLines).toBeUndefined();
		// No budget, no recovery: the read as written, errors and all
		const unrecovered = parseFile(
			path.join(DIR, "recovery.cpp"),
			"recovery.cpp",
			(root) => {
				hasError = root.hasError;
			},
			{ recoveryBytes: 0 },
		);
		expect(hasError).toBe(true);
		expect(unrecovered.recovered).toBeUndefined();
	});

	it("keeps what the rewrite blanked away: #else definitions, prototypes, methods, constants", () => {
		let hasError = true;
		const parsed = parse("branches.cpp", (root) => {
			hasError = root.hasError;
		});
		// `run`'s braces split across branches: only one branch per #if reads
		expect(hasError).toBe(false);
		expect(parsed.recovered).toBe(true);
		expect(functionsOf(parsed).map((f) => [f[0], f[2], f[3]])).toEqual([
			["Port::handle", "6-6", 1],
			["Port::fd", "8-8", 1],
			["win_only", "14-14", 1],
			["posix_only", "17-17", 1],
			["run", "20-29", 2],
		]);
		expect(
			parsed.classes.map((c) => [c.name, c.methods, c.complexity]),
		).toEqual([["Port", ["handle", "fd"], 2]]);
		// The #else prototype is an export though nothing defines it here
		expect(parsed.exports.map((e) => `${e.kind} ${e.name}`).sort()).toEqual([
			"class Port",
			"function posix_api",
			"function posix_only",
			"function run",
			"function win_only",
			"function windows_api",
		]);
		expect(parsed.constants?.map((c) => c.name)).toEqual(["LIMIT"]);
	});

	it("keeps one copy of a method whose macro sits alone on the line above it", () => {
		const parsed = parse("own-line.cpp");
		expect(parsed.recovered).toBe(true);
		// The read as written starts `size` at the macro's line; the rewrite blanks
		// that line, but `size` is still there and read: no second copy
		expect(functionsOf(parsed).map((f) => [f[0], f[2]])).toEqual([
			["Box::size", "4-4"],
			["tag", "7-7"],
			["broken", "8-10"],
			["split", "12-17"],
		]);
		expect(
			parsed.classes.map((c) => [c.name, c.methods, c.complexity]),
		).toEqual([["Box", ["size"], 1]]);
	});

	it("reads through a macro another file of the repo defines, only when told about it", () => {
		const header = fs.readFileSync(path.join(DIR, "export.h"), "utf-8");
		const names = (opts: Parameters<typeof parseFile>[3]) =>
			parseFile(
				path.join(DIR, "widget.cpp"),
				"widget.cpp",
				undefined,
				opts,
			).functions.map((f) => `${f.className}::${f.name}`);
		// `class lib_export Widget`: lower case, so no generic rule blanks it
		expect(names({})).toEqual([]);
		expect(names({ repoMacros: collectAttributeMacros([header]) })).toEqual([
			"Widget::size",
		]);
	});

	it("bounds what recovery spends on a file full of errors, keeping the best partial read", () => {
		// The budget is text reparsed, so it binds the time whatever the machine
		expect(
			[10_000, 100_000, 1_000_000, 1_200_000, 3_000_000].map((n) =>
				recoveryReparses(n),
			),
		).toEqual([40, 10, 1, 0, 0]);
		const dir0 = fs.mkdtempSync(path.join(os.tmpdir(), "cpp-norewrite-"));
		try {
			// No macro and no conditional: nothing to rewrite, the read as written stands
			fs.writeFileSync(path.join(dir0, "plain.c"), "int broken( {\n");
			let plainError = false;
			const plain = parseFile(path.join(dir0, "plain.c"), "plain.c", (root) => {
				plainError = root.hasError;
			});
			expect([plainError, plain.recovered]).toEqual([true, undefined]);
		} finally {
			fs.rmSync(dir0, { recursive: true, force: true });
		}
		// 300 KB built to exhaust it: every line in error, and each rewrite reads a
		// little more without ever reading all of it
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cpp-budget-"));
		const file = path.join(dir, "broken.c");
		fs.writeFileSync(file, "CALL_ME(x) int f(( {\n".repeat(15_000));
		try {
			let hasError = false;
			const parsed = parseFile(file, "broken.c", (root) => {
				hasError = root.hasError;
			});
			expect(hasError).toBe(true);
			expect(parsed.recovered).toBe(true);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("blanks attribute macros where an attribute sits, never where a value does", () => {
		const text = [
			"LUAI_FUNC void f(void);",
			"int x = MAX_SIZE;",
			"case FOO_BAR: break;",
			"call(FOO_BAR);",
			"struct MY_STRUCT {",
			"int y GUARDED_BY(mu);",
			"class LIB_EXPORT Db {",
			"T *RESTRICT_PTR p;",
			"FMT_BEGIN_NAMESPACE",
			"ql_elm(edata_t) link;",
			"template <typename T, ENABLE_IF(is_int<T>::value)> void g();",
		].join("\n");
		const rows = text.split("\n").map((_, row) => row);
		expect(blankMacros(text, rows).split("\n")).toEqual([
			"          void f(void);",
			"int x = MAX_SIZE;",
			"case FOO_BAR: break;",
			"call(FOO_BAR);",
			"struct MY_STRUCT {",
			`int y ${" ".repeat(14)};`,
			"class            Db {",
			`T *${" ".repeat(13)}p;`,
			"                   ",
			"ql_elm          link;",
			`template <typename T, int=0${" ".repeat(22)}> void g();`,
		]);
		// The standard `va_arg` reads a type; a call with a string before `{` opens a block
		expect(
			blankMacros(
				'x = va_arg(ap, char *);\n  TEST("adds keys") {',
				[0, 1],
			).split("\n"),
		).toEqual([`x = va_arg(ap${" ".repeat(8)});`, `  ${" ".repeat(17)} {`]);
		// A repo's own attribute macro is blanked wherever an attribute sits
		expect(
			blankMacros(
				"static redisAtomic int n;",
				"all",
				true,
				new Set(["redisAtomic"]),
			),
		).toBe(`static ${" ".repeat(11)} int n;`);
		// Text in a string, a character or a comment on the same line isn't a macro;
		// a digit separator opens no character literal
		expect(blankMacros("int f(int n = 1'000) LOCKS_EXCLUDED(mu);", [0])).toBe(
			`int f(int n = 1'000) ${" ".repeat(18)};`,
		);
		const literals =
			'  log("x LUAI_FUNC y"); // FOO_BAR int\n  /* LIB_API int */ int z;';
		expect(blankMacros(literals, [0, 1])).toBe(literals);
		// One-line statements are not types or attributes: left as they are
		const statements =
			"if (!p) p = q;\nfor (;;) x = 1;\nif (done) return;\nwhile (n) n--;";
		expect(blankMacros(statements, [0, 1, 2, 3])).toBe(statements);
		// Lines keep their numbers: arguments over two lines, a short SFINAE name, CRLF
		for (const multi of [
			"template <typename T, ENABLE_IF(a &&\n b)> void g();\nint x;",
			"template <typename T, API(\n x)> void g();",
			"LUAI_FUNC void f(void);\r\nint y;",
		]) {
			const out = blankMacros(multi, [0, 1]);
			expect([
				out.length,
				out.split("\n").length,
				out.split("\r").length,
			]).toEqual([
				multi.length,
				multi.split("\n").length,
				multi.split("\r").length,
			]);
		}
		// Only the rows asked for, and only known annotations when asked for those
		expect(blankMacros(text, [1, 5])).toBe(
			text.replace("GUARDED_BY(mu)", " ".repeat(14)),
		);
		expect(
			blankMacros(
				"void f() LOCKS_EXCLUDED(mu);\nLUAI_FUNC int g;",
				"all",
				true,
			),
		).toBe(`void f() ${" ".repeat(18)};\nLUAI_FUNC int g;`);
	});

	it("collects a repo's attribute macros from its #defines, as Doxygen's PREDEFINED would", () => {
		const header = [
			'#define LUAI_FUNC __attribute__((visibility("hidden"))) extern',
			"#define API_EXPORT",
			"#define ALWAYS_INLINE static inline LUAI_FUNC",
			"#define GUARDED(x) __attribute__((guarded_by(x)))",
			"#define redisAtomic _Atomic",
			"#define DEBUG 1",
			"#define MAX(a, b) ((a) > (b) ? (a) : (b))",
			"#define CONSTEXPR constexpr",
		].join("\n");
		// `CONSTEXPR` is also defined as a value elsewhere: left out
		const other =
			"#define CONSTEXPR 0\n#define API_EXPORT __declspec(dllexport)";
		expect([...collectAttributeMacros([header, other])].sort()).toEqual([
			"ALWAYS_INLINE",
			"API_EXPORT",
			"GUARDED",
			"LUAI_FUNC",
			"redisAtomic",
		]);
	});

	it("reads one branch of each conditional, as the dialect's compiler would", () => {
		const text = [
			"#ifdef __cplusplus",
			'extern "C" {',
			"#endif",
			"int a;",
			"#if 0",
			"int b;",
			"#else",
			"int c;",
			"#endif",
			"#define TWICE(x) \\",
			"  ((x) * 2)",
		].join("\n");
		const blankLine = (line: string) => " ".repeat(line.length);
		const lines = text.split("\n");
		const expected = lines.map((line, i) =>
			[3, 7].includes(i) ? line : blankLine(line),
		);
		expect(firstBranches(text, "c").split("\n")).toEqual(expected);
		// In C++, `extern "C" {` is read
		expect(firstBranches(text, "cpp").split("\n")[1]).toBe('extern "C" {');
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
			"branches.cpp",
			"edge.cpp",
			"export.h",
			"macro.c",
			"own-line.cpp",
			"recovery.cpp",
			"shape.cpp",
			"shape.h",
			"util.c",
			"util.h",
			"widget.cpp",
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
