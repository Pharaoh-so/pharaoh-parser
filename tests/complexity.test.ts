/**
 * The shared complexity rule (docs/complexity.md), construct by construct in
 * each language, with hardcoded values. `cc` is a function's own control
 * flow; a file's `excess` sums every scope's distance over 10, named or not.
 *
 * Breaks when: a language counts `else`, `default:`, `try`, `with` or `match`
 * again; misses a conditional expression, a comprehension clause or a
 * short-circuit operator; adds a nested function's decisions to the function
 * around it; or the same logic scores differently in TypeScript, Python and C.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseFile as parseC } from "../src/c-cpp-tree-sitter.js";
import { parseFile as parsePython } from "../src/python-tree-sitter.js";
import { parseFile as parseTs } from "../src/tree-sitter.js";
import type { ParsedFile } from "../src/types.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "complexity-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** Parse `code` as a file with extension `ext`. */
function parse(ext: string, code: string): ParsedFile {
	const name = `case${n++}${ext}`;
	const file = path.join(dir, name);
	fs.writeFileSync(file, code);
	if (ext === ".py") return parsePython(file, name);
	if (ext === ".c" || ext === ".cpp") return parseC(file, name);
	return parseTs(file, name);
}

/** `cc` of the function named `f`. */
const ccOf = (ext: string, code: string) =>
	parse(ext, code).functions.find((fn) => fn.name === "f")?.cc;

describe("cc: TypeScript and JavaScript", () => {
	it.each([
		["straight line", "function f(a) { return a; }", 1],
		[
			"if / else if / else: else adds nothing",
			"function f(a) { if (a > 1) return 1; else if (a > 0) return 2; else return 3; }",
			3,
		],
		[
			"for, for-of, for-in, while, do",
			"function f(xs) { for (let i = 0; i < 1; i++) {} for (const x of xs) {} for (const k in xs) {} while (xs) {} do {} while (xs); }",
			6,
		],
		[
			"each case, never default",
			"function f(a) { switch (a) { case 1: break; case 2: break; default: break; } }",
			3,
		],
		[
			"catch, never try or finally",
			"function f() { try { g(); } catch (e) { h(); } finally { k(); } }",
			2,
		],
		[
			"ternary and && || ??",
			"function f(a, b, c, d) { const x = a ? b : c; return (a && b) || (c ?? d); }",
			5,
		],
		["&&= ||= ??=", "function f(o) { o.a ||= 1; o.b &&= 2; o.c ??= 3; }", 4],
		["optional chaining adds nothing", "function f(o) { return o?.a?.b; }", 1],
		[
			"a callback's decisions are its own",
			"function f(xs) { if (xs) { return xs.map((x) => (x ? 1 : 2)); } }",
			2,
		],
		[
			"a decision after a callback is still the function's",
			"function f(xs) { const ys = xs.map((x) => x); return ys.length > 0 ? ys : xs; }",
			2,
		],
		["a method", "class A { f(a) { return a ? 1 : 2; } }", 2],
		["an arrow binding", "const f = (a) => (a ? 1 : 2);", 2],
		[
			"a class field holding a function",
			"class A { f = (a) => (a ? 1 : 2); }",
			2,
		],
	])("%s", (_, code, expected) => {
		expect(ccOf(".ts", code)).toBe(expected);
	});

	it("reads JavaScript the same way", () => {
		expect(ccOf(".js", "const f = (a, b) => (a && b ? 1 : 2);")).toBe(3);
	});
});

describe("cc: Python", () => {
	it.each([
		["straight line", "def f(a):\n    return a\n", 1],
		[
			"if / elif / else: else adds nothing",
			"def f(a):\n    if a > 1:\n        return 1\n    elif a > 0:\n        return 2\n    else:\n        return 3\n",
			3,
		],
		[
			"for and while, their else adds nothing",
			"def f(xs):\n    for x in xs:\n        pass\n    else:\n        pass\n    while xs:\n        break\n",
			3,
		],
		[
			"each except, never try, else or finally",
			"def f():\n    try:\n        g()\n    except ValueError:\n        h()\n    except KeyError:\n        k()\n    else:\n        m()\n    finally:\n        z()\n",
			3,
		],
		[
			"with adds nothing",
			"def f(p):\n    with open(p) as fh:\n        return fh.read()\n",
			1,
		],
		[
			"each case, never match",
			"def f(a):\n    match a:\n        case 1:\n            return 1\n        case _:\n            return 2\n",
			3,
		],
		[
			"conditional expression, and, or",
			"def f(a, b, c):\n    x = b if a else c\n    return a and b or c\n",
			4,
		],
		[
			"a comprehension's for and if",
			"def f(xs):\n    return [x for x in xs if x]\n",
			3,
		],
		[
			"a nested def and a lambda are their own",
			"def f(xs):\n    def g(x):\n        if x:\n            return 1\n    return list(map(lambda y: y if y else 0, xs))\n",
			1,
		],
	])("%s", (_, code, expected) => {
		expect(ccOf(".py", code)).toBe(expected);
	});
});

describe("cc: C and C++", () => {
	it.each([
		[".c", "straight line", "int f(int a) { return a; }\n", 1],
		[
			".c",
			"if / else if / else: else adds nothing",
			"int f(int a) { if (a > 1) return 1; else if (a > 0) return 2; else return 3; }\n",
			3,
		],
		[
			".c",
			"for, while, do",
			"int f(int a) { for (int i = 0; i < a; i++) {} while (a) {} do {} while (a); return 0; }\n",
			4,
		],
		[
			".c",
			"each case, never default",
			"int f(int a) { switch (a) { case 1: return 1; case 2: return 2; default: return 0; } }\n",
			3,
		],
		[
			".c",
			"conditional expression and && ||",
			"int f(int a, int b, int c) { return a ? (b && c) : (b || c); }\n",
			4,
		],
		[
			".cpp",
			"range for",
			"#include <vector>\nint f(std::vector<int> v) { int s = 0; for (int x : v) s += x; return s; }\n",
			2,
		],
		[
			".cpp",
			"each catch, never try",
			"int g();\nint f() { try { return g(); } catch (int e) { return 1; } catch (...) { return 2; } }\n",
			3,
		],
		[
			".cpp",
			"a lambda is its own",
			"int f(int a) { auto g = [](int x) { return x ? 1 : 0; }; return g(a); }\n",
			1,
		],
		[
			".cpp",
			"`and` counts, an rvalue reference's && doesn't",
			"int f(int&& a, bool b, bool c) { return b and c; }\n",
			2,
		],
		[
			".cpp",
			"a fold expression's &&",
			"template <class... T> bool f(T... xs) { return (xs && ...); }\n",
			2,
		],
	])("%s %s", (ext, _, code, expected) => {
		expect(ccOf(ext, code)).toBe(expected);
	});

	it("counts a function restored from an #else branch in a recovered file's excess", () => {
		// `run`'s braces split across branches, so the file is read again with each
		// #if's first branch; posix_only, in the #else, comes back from the read as written.
		const decisions = Array.from(
			{ length: 14 },
			(_, i) => `if (a == ${i}) return ${i};`,
		).join(" ");
		const parsed = parse(
			".cpp",
			`#ifdef _WIN32\nint win_only() { return 1; }\n#else\nint posix_only(int a) { ${decisions} return 2; }\n#endif\n\nint run(int fd) {\n#ifdef _WIN32\n  if (fd == 0) {\n#else\n  if (fd < 0) {\n#endif\n    return -1;\n  }\n  return fd;\n}\n`,
		);
		expect(parsed.recovered).toBe(true);
		expect(parsed.functions.map((fn) => [fn.name, fn.cc])).toEqual([
			["win_only", 1],
			["posix_only", 15],
			["run", 2],
		]);
		expect(parsed.excess).toBe(5);
	});
});

describe("cc: the same logic in every language", () => {
	it("scores 6 in TypeScript, Python and C", () => {
		const ts =
			"function f(a, b, xs) { if (a && b) { for (const x of xs) { if (x > 0) { return 1; } else { return 2; } } } return a ? 3 : 4; }";
		const py =
			"def f(a, b, xs):\n    if a and b:\n        for x in xs:\n            if x > 0:\n                return 1\n            else:\n                return 2\n    return 3 if a else 4\n";
		const c =
			"int f(int a, int b, int *xs, int n) { if (a && b) { for (int i = 0; i < n; i++) { if (xs[i] > 0) { return 1; } else { return 2; } } } return a ? 3 : 4; }\n";
		expect([ccOf(".ts", ts), ccOf(".py", py), ccOf(".c", c)]).toEqual([
			6, 6, 6,
		]);
	});
});

describe("excess: each scope's distance over 10, summed per file", () => {
	/** A TypeScript body with `k` decisions, so its scope's cc is k + 1. */
	const ifs = (k: number) =>
		Array.from({ length: k }, (_, i) => `if (a === ${i}) g();`).join(" ");

	it("is 10 for one function at 20, and 1 once it's split into 11 and 10", () => {
		expect(parse(".ts", `function big(a) { ${ifs(19)} }`).excess).toBe(10);
		expect(
			parse(
				".ts",
				`function one(a) { ${ifs(10)} }\nfunction two(a) { ${ifs(9)} }`,
			).excess,
		).toBe(1);
	});

	it("counts an anonymous callback, and naming it changes nothing", () => {
		const inline = `function host(xs) { return xs.map((a) => { ${ifs(14)} }); }`;
		const named = `const cb = (a) => { ${ifs(14)} };\nfunction host(xs) { return xs.map(cb); }`;
		expect([parse(".ts", inline).excess, parse(".ts", named).excess]).toEqual([
			5, 5,
		]);
		// The host's own control flow has no decisions: the callback's are never its.
		expect(
			parse(".ts", inline).functions.find((fn) => fn.name === "host")?.cc,
		).toBe(1);
	});

	it("doesn't move when trivial functions are added", () => {
		const trivial = Array.from(
			{ length: 20 },
			(_, i) => `function t${i}() { return ${i}; }`,
		).join("\n");
		expect(
			parse(".ts", `function big(a) { ${ifs(19)} }\n${trivial}`).excess,
		).toBe(10);
	});

	it("adds two nested scopes over 10 separately, and counts no module-level code", () => {
		const nested = `function host(a, xs) { ${ifs(14)} return xs.map((a) => { ${ifs(14)} }); }`;
		expect(parse(".ts", nested).excess).toBe(10);
		expect(parse(".ts", `const a = 1;\n${ifs(20)}`).excess).toBe(0);
	});

	it("is summed the same way in Python and C", () => {
		const pyIfs = Array.from(
			{ length: 14 },
			(_, i) => `    if a == ${i}:\n        g()\n`,
		).join("");
		expect(parse(".py", `def big(a):\n${pyIfs}`).excess).toBe(5);
		const cIfs = Array.from(
			{ length: 14 },
			(_, i) => `if (a == ${i}) g();`,
		).join(" ");
		expect(
			parse(".c", `void g(void);\nvoid big(int a) { ${cIfs} }\n`).excess,
		).toBe(5);
	});
});

describe("the parser's own code", () => {
	// Pharaoh's Health plan splits the ten functions that held 78% of this
	// repo's excess; each is listed here once it is split. Breaks when one of
	// them grows past 10 again, or is renamed without updating this list.
	const SPLIT: [file: string, name: string][] = [
		["c-cpp-macros.ts", "blankNames"],
		["c-cpp-macros.ts", "firstBranches"],
		["c-cpp-tree-sitter.ts", "read"],
		["tree-sitter.ts", "extractExportStatement"],
		["tree-sitter.ts", "extractClass"],
		["tree-sitter.ts", "addVueComponent"],
	];

	it.each(SPLIT)("%s: %s stays at cc 10 or less", (file, name) => {
		const parsed = parseTs(
			path.resolve(__dirname, "../src", file),
			`src/${file}`,
		);
		const cc = parsed.functions.find((fn) => fn.name === name)?.cc;
		expect(cc).toBeTypeOf("number");
		expect(cc).toBeLessThanOrEqual(10);
	});
});
