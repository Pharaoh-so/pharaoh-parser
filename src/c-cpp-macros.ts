/**
 * Macro tolerance for C and C++: the text rewrites the parser tries when the
 * grammar cannot read a file as written. Nothing is preprocessed, so a macro
 * the grammar doesn't know (`LUAI_FUNC void f()`, `int x GUARDED_BY(mu);`,
 * `FMT_BEGIN_NAMESPACE`) or an `#if` whose branches each hold half a statement
 * leaves a syntax error. Each rewrite blanks text with spaces, keeping every
 * line and column where it was, so what is read from the rewritten text points
 * at the file as written.
 *
 * The rules borrow from Doxygen's preprocessor: blank attribute-like macros
 * (its PREDEFINED list of empty expansions), blank an upper-case macro alone on
 * a line (SKIP_FUNCTION_MACROS), and read one branch of each conditional.
 * They are guesses about what a macro expands to, so what is read through
 * them is approximate (see ParsedFile.recovered).
 */

/**
 * Attribute and annotation macros that expand to nothing the grammar needs, by
 * name: thread-safety annotations, export and calling-convention markers, and
 * the short names the underscore rule below doesn't cover.
 */
export const ATTRIBUTE_MACROS: ReadonlySet<string> = new Set([
	// Clang thread-safety annotations (LevelDB, Abseil, Chromium spellings)
	"GUARDED_BY",
	"PT_GUARDED_BY",
	"ACQUIRED_BEFORE",
	"ACQUIRED_AFTER",
	"REQUIRES",
	"REQUIRES_SHARED",
	"ACQUIRE",
	"ACQUIRE_SHARED",
	"RELEASE",
	"RELEASE_SHARED",
	"TRY_ACQUIRE",
	"EXCLUDES",
	"ASSERT_CAPABILITY",
	"RETURN_CAPABILITY",
	"CAPABILITY",
	"SCOPED_CAPABILITY",
	"LOCKABLE",
	"SCOPED_LOCKABLE",
	"EXCLUSIVE_LOCKS_REQUIRED",
	"SHARED_LOCKS_REQUIRED",
	"LOCKS_EXCLUDED",
	"LOCK_RETURNED",
	"EXCLUSIVE_LOCK_FUNCTION",
	"SHARED_LOCK_FUNCTION",
	"UNLOCK_FUNCTION",
	"EXCLUSIVE_TRYLOCK_FUNCTION",
	"SHARED_TRYLOCK_FUNCTION",
	"ASSERT_EXCLUSIVE_LOCK",
	"ASSERT_SHARED_LOCK",
	"NO_THREAD_SAFETY_ANALYSIS",
	// Short markers with no underscore
	"API",
	"EXPORT",
	"IMPORT",
	"INLINE",
	"FORCEINLINE",
	"NOINLINE",
	"NORETURN",
	"NODISCARD",
	"DEPRECATED",
	"UNUSED",
	"ALIGNED",
	"PACKED",
	"PURE",
	"WINAPI",
	"APIENTRY",
	"CALLBACK",
	"STDCALL",
	"CDECL",
	"FASTCALL",
	"Q_OBJECT",
	"Q_GADGET",
	"Q_INVOKABLE",
	// GCC and kernel-style lower-case markers the grammar doesn't know
	"__unused",
	"__used",
	"__maybe_unused",
	"__must_check",
	"__always_inline",
	"__noreturn",
	"__cold",
	"__hot",
	"__weak",
	"__packed",
	"__printf",
	"__init",
	"__exit",
]);

/** Words a declaration can carry that change nothing the grammar needs to read. */
const DECLARATION_WORDS = new Set([
	"static",
	"inline",
	"__inline",
	"__inline__",
	"extern",
	"const",
	"volatile",
	"constexpr",
	"consteval",
	"constinit",
	"explicit",
	"virtual",
	"noexcept",
	"register",
	"thread_local",
	"__thread",
	"_Thread_local",
	"_Noreturn",
	"_Atomic",
	"restrict",
	"__restrict",
	"__restrict__",
	"__forceinline",
	"__cdecl",
	"__stdcall",
	"__fastcall",
]);

/** Attribute syntax with its arguments: `__attribute__((x))`, `__declspec(x)`, `[[x]]`, `alignas(8)`. */
const ATTRIBUTE_SYNTAX =
	/__attribute__\s*\(\((?:[^()]|\([^()]*\))*\)\)|(?:__declspec|alignas|_Alignas|__pragma|_Pragma)\s*\((?:[^()]|\([^()]*\))*\)|\[\[[^\]]*\]\]/g;

/**
 * The repo's own attribute macros, the way Doxygen's PREDEFINED list names
 * them: every `#define` whose value is empty or only declaration words,
 * attribute syntax and other such macros (`#define LUAI_FUNC
 * __attribute__((visibility("hidden"))) extern`, `#define FMT_CONSTEXPR
 * constexpr`, `#define redisAtomic _Atomic`). A name also defined as anything
 * else (`#define DEBUG 1`) is left out. Pass the result to parseFile for every
 * file of the repo: most such macros are defined in a header and used elsewhere.
 *
 * @param sources - The text of each C or C++ file of the repo
 * @returns The names safe to blank where an attribute can sit
 */
export function collectAttributeMacros(sources: Iterable<string>): Set<string> {
	const values = new Map<string, string[]>();
	for (const source of sources) {
		const defines = source.matchAll(
			/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)(\([^)]*\))?((?:[^\n\\]|\\\r?\n|\\)*)/gm,
		);
		for (const [, name, params, body] of defines) {
			const value = body
				.replace(/\\\r?\n/g, " ")
				.replace(/\/\*.*?\*\/|\/\/.*$/g, " ")
				.replace(ATTRIBUTE_SYNTAX, " ")
				.trim();
			// A parameter used in the body is part of the attribute: `GUARDED_BY(x)`
			const paramNames = new Set(
				(params ?? "")
					.slice(1, -1)
					.split(",")
					.map((p) => p.trim()),
			);
			const words = value === "" ? [] : value.split(/\s+/);
			const list = values.get(name) ?? [];
			values.set(name, list);
			list.push(words.filter((w) => !paramNames.has(w)).join(" "));
		}
	}
	const found = new Set<string>();
	// Values may name other such macros: grow to a fixed point
	for (let grew = true; grew; ) {
		grew = false;
		for (const [name, definitions] of values) {
			if (found.has(name)) continue;
			const qualifies = definitions.every((words) =>
				words === ""
					? true
					: words
							.split(" ")
							.every(
								(w) =>
									DECLARATION_WORDS.has(w) ||
									ATTRIBUTE_MACROS.has(w) ||
									found.has(w),
							),
			);
			if (qualifies) {
				found.add(name);
				grew = true;
			}
		}
	}
	return found;
}

const NONE: ReadonlySet<string> = new Set();

/** An upper-case macro-style name with an underscore: `LUAI_FUNC`, `GTEST_API_`. */
const MACRO_NAME = /^_*[A-Z][A-Z0-9]*(?:_[A-Z0-9]*)+$/;

/** `class LEVELDB_EXPORT DB {`, `struct ABSL_ATTR Foo final :`: a macro between the tag and the name. */
const CLASS_HEAD =
	/^(\s*(?:template\s*<[^>]*>\s*)?(?:class|struct|union)\s+)([A-Za-z_]\w*)(?=\s+[A-Za-z_]\w*\s*(?:final\s*)?[:{])/;

/** Words after which an upper-case name is a value or a type, not an attribute. */
const VALUE_POSITION = new Set([
	"return",
	"case",
	"goto",
	"sizeof",
	"alignof",
	"typeof",
	"decltype",
	"throw",
	"new",
	"delete",
	"typedef",
	"using",
	"else",
	"do",
	"co_return",
	"co_yield",
	"co_await",
	"defined",
]);

/** Words after which an upper-case name may be the declared type's own name. */
const TAG_WORDS = new Set(["class", "struct", "union", "enum"]);

const isWordChar = (ch: string | undefined): boolean =>
	ch !== undefined && /\w/.test(ch);

/** Replace `[start, end)` with spaces, keeping newlines. */
function blank(chars: string[], start: number, end: number): void {
	for (let i = start; i < end; i++) {
		if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
	}
}

/** What a SFINAE macro in a template's parameters is read as (see blankNames). */
const SFINAE_PARAMETER = "int=0";

/** Text that ends inside a template's parameter list: `template <typename T, `. */
const TEMPLATE_HEAD = /\btemplate\s*<[^;{}()]*$/;

/** How far past its line a macro's arguments may run. */
const MAX_ARGS_SPAN = 512;

/** A call where a type goes: `ql_elm(edata_t) link;`, `typedef rb_tree(T) tree_t;`. */
const TYPE_MACRO =
	/^(\s*(?:(?:typedef|const|static|extern|volatile)\s+)*[A-Za-z_]\w*)\s*(\([^()]*\))(?=\s+\**\s*[A-Za-z_]\w*\s*[;,=[)])/;

/**
 * Blank the arguments of a macro used as a type at the start of a line, so
 * its name reads as the type: a call followed by a name is never an expression.
 */
function blankTypeMacroArgs(
	text: string,
	chars: string[],
	from: number,
	to: number,
): void {
	const match = TYPE_MACRO.exec(text.slice(from, to));
	if (!match) return;
	const start = from + match[0].length - match[2].length;
	blank(chars, start, start + match[2].length);
}

/**
 * Blank the type a `va_arg(ap, T)` takes: the C standard's macro reads a type
 * where the grammar expects an expression.
 */
function blankTypeArgument(
	text: string,
	chars: string[],
	from: number,
	to: number,
): void {
	for (const match of text.slice(from, to).matchAll(/\bva_arg\s*\(/g)) {
		const open = from + (match.index ?? 0) + match[0].length - 1;
		const close = closeParen(
			text,
			open,
			Math.min(text.length, to + MAX_ARGS_SPAN),
		);
		if (close === -1) continue;
		let depth = 0;
		for (let i = open + 1; i < close - 1; i++) {
			if (text[i] === "(") depth++;
			else if (text[i] === ")") depth--;
			else if (text[i] === "," && depth === 0) {
				blank(chars, i, close - 1);
				break;
			}
		}
	}
}

/**
 * Blank a macro that opens a block, `TEST("adds keys") {`, keeping the block:
 * a call whose arguments hold a string is never a function's declarator, and
 * a call followed by `{` is never an expression.
 */
function blankBlockMacro(
	text: string,
	chars: string[],
	from: number,
	to: number,
): void {
	const match = /^\s*([A-Za-z_]\w*)\s*\(/.exec(text.slice(from, to));
	if (!match || CONTROL_WORDS.has(match[1])) return;
	const open = from + match[0].length - 1;
	const close = closeParen(
		text,
		open,
		Math.min(text.length, to + MAX_ARGS_SPAN),
	);
	if (close === -1 || !text.slice(open, close).includes('"')) return;
	let next = close;
	while (next < text.length && /[ \t]/.test(text[next])) next++;
	if (text[next] !== "{") return;
	blank(chars, from + match[0].length - match[0].trimStart().length, close);
}

/** Statement keywords a parenthesis follows. */
const CONTROL_WORDS = new Set([
	"if",
	"while",
	"for",
	"switch",
	"return",
	"sizeof",
	"catch",
]);

/** The index after the `)` that closes the `(` at `open`, within `limit`, or -1. */
function closeParen(text: string, open: number, limit: number): number {
	let depth = 0;
	for (let i = open; i < limit; i++) {
		if (text[i] === "(") depth++;
		else if (text[i] === ")" && --depth === 0) return i + 1;
	}
	return -1;
}

/** Start offset of each line, and the text's length as a last entry. */
export function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = 0; i < text.length; i++)
		if (text[i] === "\n") starts.push(i + 1);
	starts.push(text.length);
	return starts;
}

/**
 * Blank the macros on the given lines that the grammar can't read through:
 *
 * - an upper-case name alone on its line, with or without arguments and not
 *   ending a statement (`FMT_BEGIN_NAMESPACE`, `TEST_END`);
 * - an attribute-like macro inside a declaration: a name from ATTRIBUTE_MACROS
 *   or an upper-case name with an underscore, with its arguments, where an
 *   attribute can sit (`LUAI_FUNC void f()`, `class LEVELDB_EXPORT DB`,
 *   `void f() LOCKS_EXCLUDED(mu);`) and not where a value can
 *   (`x = MAX_SIZE;`, `case FOO_BAR:`, `f(FOO_BAR)`).
 *
 * Preprocessor lines are left alone.
 *
 * @param text - The file's text, possibly already rewritten
 * @param rows - Zero-based line numbers to rewrite
 * @returns The rewritten text, the same length as `text`
 */
export function blankMacros(
	text: string,
	rows: Iterable<number> | "all",
	onlyKnown = false,
	repoMacros: ReadonlySet<string> = NONE,
): string {
	const known = (name: string): boolean =>
		ATTRIBUTE_MACROS.has(name) || repoMacros.has(name);
	const starts = lineStarts(text);
	const chars = text.split("");
	const every =
		rows === "all" ? starts.slice(0, -1).map((_, row) => row) : rows;
	for (const row of every) {
		if (row < 0 || row >= starts.length - 1) continue;
		const from = starts[row];
		const to = starts[row + 1];
		const line = text.slice(from, to);
		if (/^\s*#/.test(line)) continue;

		const head = CLASS_HEAD.exec(line);
		if (head && (known(head[2]) || MACRO_NAME.test(head[2]))) {
			const start = from + head[1].length;
			blank(chars, start, start + head[2].length);
		}
		blankTypeArgument(text, chars, from, to);
		if (!onlyKnown) blankBlockMacro(text, chars, from, to);
		if (onlyKnown) {
			blankNames(text, chars, from, to, known);
			continue;
		}

		const alone =
			/^\s*([A-Z_][A-Z0-9_]{2,})\s*(\(.*\))?\s*(\/\/.*|\/\*.*\*\/)?\s*$/.exec(
				line,
			);
		if (alone && /[A-Z]/.test(alone[1])) {
			blank(chars, from, from + line.trimEnd().length);
			continue;
		}

		blankTypeMacroArgs(text, chars, from, to);
		blankNames(
			text,
			chars,
			from,
			to,
			(name) => known(name) || MACRO_NAME.test(name),
		);
	}
	return chars.join("");
}

/** Blank the names `wanted` accepts on one line, where an attribute can sit (see blankMacros). */
function blankNames(
	text: string,
	chars: string[],
	from: number,
	to: number,
	wanted: (name: string) => boolean,
): void {
	const line = text.slice(from, to);
	for (const match of line.matchAll(/\b[A-Za-z_]\w*\b/g)) {
		const name = match[0];
		if (!wanted(name)) continue;
		const start = from + (match.index ?? 0);
		let end = start + name.length;
		let next = end;
		while (next < to && /[ \t]/.test(text[next])) next++;
		const hasArgs = text[next] === "(";
		let prevWord = "";
		let back = start - 1;
		while (back >= from && /[ \t]/.test(text[back])) back--;
		const before = back >= from ? text[back] : "";
		let beforeWord = "";
		if (isWordChar(before)) {
			let w = back;
			while (w >= from && isWordChar(text[w])) w--;
			prevWord = text.slice(w + 1, back + 1);
			while (w >= from && /[ \t]/.test(text[w])) w--;
			beforeWord = w >= from ? text[w] : "";
		}
		// `if FMT_CONSTEXPR20 (cond)`: the parentheses are the condition's
		if (hasArgs && prevWord !== "if") {
			// Arguments may run over a few lines: `FMT_ENABLE_IF(a &&\n b)`
			const close = closeParen(
				text,
				next,
				Math.min(text.length, to + MAX_ARGS_SPAN),
			);
			if (close === -1) continue;
			end = close;
			next = end;
			while (next < to && /[ \t]/.test(text[next])) next++;
		}
		const after = next < text.length ? text[next] : "";

		const attributeBefore =
			before === "" ||
			before === ")" ||
			before === ">" ||
			before === "}" ||
			before === ";" ||
			before === "]" ||
			(prevWord !== "" && !VALUE_POSITION.has(prevWord)) ||
			// `T *RESTRICT p`, `f(EV_P_ ev_io *w)`: two terms side by side are never an expression
			((before === "*" || before === "&" || before === "(" || before === ",") &&
				isWordChar(after));
		// `template <typename T, FMT_ENABLE_IF(cond)>`: a SFINAE macro stands for an
		// unnamed parameter with a default, which `int=0` keeps in the same width
		if (
			hasArgs &&
			(before === "," || before === "<") &&
			(after === ">" || after === ",") &&
			end - start >= SFINAE_PARAMETER.length &&
			TEMPLATE_HEAD.test(text.slice(Math.max(0, start - MAX_ARGS_SPAN), start))
		) {
			blank(chars, start, end);
			chars.splice(start, SFINAE_PARAMETER.length, ...SFINAE_PARAMETER);
			continue;
		}
		if (!attributeBefore) continue;
		// `struct NAME {` names the struct; `class EXPORT NAME {` doesn't
		if (TAG_WORDS.has(prevWord) && !isWordChar(after)) continue;
		// `FOO(x);` at the start of a line is a statement, which the grammar reads
		if (before === "" && hasArgs && after === ";") continue;
		const attributeAfter =
			after === "" ||
			after === "\n" ||
			after === "\r" ||
			isWordChar(after) ||
			after === "{" ||
			after === "~" ||
			(after === ";" && before !== "") ||
			((after === "=" || after === ":") && hasArgs) ||
			(after === "(" && prevWord === "if") ||
			// `const T *p UNUSED,`: after a declarator's name, not after a type's
			((after === "," || after === ")") &&
				prevWord !== "" &&
				(beforeWord === "*" || beforeWord === "&" || isWordChar(beforeWord)));
		if (!attributeAfter) continue;
		blank(chars, start, end);
	}
}

/**
 * Read one branch of every conditional, as a compiler would: every directive
 * (conditionals, `#define` bodies, `#pragma`, `#include`) and every other
 * branch is blanked. The first branch is read, except that
 * `#if 0` reads its `#else`, and `#ifdef __cplusplus` reads as false in C
 * (`#ifndef __cplusplus` in C++), since no compiler of that dialect defines
 * it otherwise.
 *
 * @param text - The file's text, possibly already rewritten
 * @param dialect - The grammar the file is read with
 * @returns The rewritten text, the same length as `text`
 */
export function firstBranches(text: string, dialect: "c" | "cpp"): string {
	const starts = lineStarts(text);
	const chars = text.split("");
	// Per open conditional: is the current branch read, has a branch been read
	const stack: { reading: boolean; taken: boolean }[] = [];
	const reading = (): boolean => stack.every((level) => level.reading);
	const skipFirst = (condition: string, keyword: string): boolean => {
		const c = condition.trim();
		if (keyword === "if" && /^0\b/.test(c)) return true;
		const cplusplus =
			/^__cplusplus\b/.test(c) || /^defined\s*\(?\s*__cplusplus\b/.test(c);
		if (!cplusplus) return false;
		const positive = keyword === "ifdef" || keyword === "if";
		return dialect === "c" ? positive : !positive;
	};
	for (let row = 0; row < starts.length - 1; row++) {
		const from = starts[row];
		let to = starts[row + 1];
		const line = text.slice(from, to);
		const directive = /^\s*#\s*(\w*)(.*)$/s.exec(line);
		// A directive continued with `\` spans the lines that follow
		let last = row;
		while (
			directive &&
			/\\\s*$/.test(text.slice(starts[last], starts[last + 1])) &&
			last + 1 < starts.length - 1
		) {
			last++;
		}
		to = starts[last + 1];
		if (directive) {
			const [, keyword, rest] = directive;
			if (keyword === "if" || keyword === "ifdef" || keyword === "ifndef") {
				const read = !skipFirst(rest, keyword);
				stack.push({ reading: read, taken: read });
			} else if (keyword === "elif" || keyword === "else") {
				const level = stack.at(-1);
				if (level) {
					level.reading = !level.taken;
					level.taken = true;
				}
			} else if (keyword === "endif") {
				stack.pop();
			}
			blank(chars, from, to);
			row = last;
			continue;
		}
		if (!reading()) blank(chars, from, to);
	}
	return chars.join("");
}
