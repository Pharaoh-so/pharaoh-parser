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
export const ATTRIBUTE_MACROS = new Set([
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
const ATTRIBUTE_SYNTAX = /__attribute__\s*\(\((?:[^()]|\([^()]*\))*\)\)|(?:__declspec|alignas|_Alignas|__pragma|_Pragma)\s*\((?:[^()]|\([^()]*\))*\)|\[\[[^\]]*\]\]/g;
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
export function collectAttributeMacros(sources) {
    const values = new Map();
    for (const source of sources) {
        const defines = source.matchAll(/^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)(\([^)]*\))?((?:[^\n\\]|\\\r?\n|\\)*)/gm);
        for (const [, name, params, body] of defines) {
            const value = body
                .replace(/\\\r?\n/g, " ")
                .replace(/\/\*.*?\*\/|\/\/.*$/g, " ")
                .replace(ATTRIBUTE_SYNTAX, " ")
                .trim();
            // A parameter used in the body is part of the attribute: `GUARDED_BY(x)`
            const paramNames = new Set((params ?? "")
                .slice(1, -1)
                .split(",")
                .map((p) => p.trim()));
            const words = value === "" ? [] : value.split(/\s+/);
            const list = values.get(name) ?? [];
            values.set(name, list);
            list.push(words.filter((w) => !paramNames.has(w)).join(" "));
        }
    }
    const found = new Set();
    // Values may name other such macros: grow to a fixed point
    for (let grew = true; grew;) {
        grew = false;
        for (const [name, definitions] of values) {
            if (found.has(name))
                continue;
            const qualifies = definitions.every((words) => words === ""
                ? true
                : words
                    .split(" ")
                    .every((w) => DECLARATION_WORDS.has(w) ||
                    ATTRIBUTE_MACROS.has(w) ||
                    found.has(w)));
            if (qualifies) {
                found.add(name);
                grew = true;
            }
        }
    }
    return found;
}
const NONE = new Set();
/** An upper-case macro-style name with an underscore: `LUAI_FUNC`, `GTEST_API_`. */
const MACRO_NAME = /^_*[A-Z][A-Z0-9]*(?:_[A-Z0-9]*)+$/;
/** `class LEVELDB_EXPORT DB {`, `struct ABSL_ATTR Foo final :`: a macro between the tag and the name. */
const CLASS_HEAD = /^(\s*(?:template\s*<[^>]*>\s*)?(?:class|struct|union)\s+)([A-Za-z_]\w*)(?=\s+[A-Za-z_]\w*\s*(?:final\s*)?[:{])/;
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
const isWordChar = (ch) => ch !== undefined && /\w/.test(ch);
/** Replace `[start, end)` with spaces, keeping newlines. */
function blank(chars, start, end) {
    for (let i = start; i < end; i++) {
        if (chars[i] !== "\n" && chars[i] !== "\r")
            chars[i] = " ";
    }
}
/** What a SFINAE macro in a template's parameters is read as (see blankNames). */
const SFINAE_PARAMETER = "int=0";
/** Text that ends inside a template's parameter list: `template <typename T, `. */
const TEMPLATE_HEAD = /\btemplate\s*<[^;{}()]*$/;
/** How far past its line a macro's arguments may run. */
const MAX_ARGS_SPAN = 512;
/** A call where a type goes: `ql_elm(edata_t) link;`, `typedef rb_tree(T) tree_t;`. */
const TYPE_MACRO = /^(\s*(?:(?:typedef|const|static|extern|volatile)\s+)*[A-Za-z_]\w*)\s*(\([^()]*\))(?=\s+\**\s*[A-Za-z_]\w*\s*[;,=[)])/;
/**
 * Blank the arguments of a macro used as a type at the start of a line, so
 * its name reads as the type: a call followed by a name is never an expression.
 */
function blankTypeMacroArgs(text, chars, from, to) {
    const match = TYPE_MACRO.exec(text.slice(from, to));
    // `if (!p) p = q;` is a statement, not a type
    if (!match || CONTROL_WORDS.has(match[1].trim().split(/\s+/).at(-1) ?? "")) {
        return;
    }
    const start = from + match[0].length - match[2].length;
    blank(chars, start, start + match[2].length);
}
/**
 * Blank the type a `va_arg(ap, T)` takes: the C standard's macro reads a type
 * where the grammar expects an expression.
 */
function blankTypeArgument(text, chars, from, to) {
    for (const match of text.slice(from, to).matchAll(/\bva_arg\s*\(/g)) {
        const open = from + (match.index ?? 0) + match[0].length - 1;
        const close = closeParen(text, open, Math.min(text.length, to + MAX_ARGS_SPAN));
        if (close === -1)
            continue;
        let depth = 0;
        for (let i = open + 1; i < close - 1; i++) {
            if (text[i] === "(")
                depth++;
            else if (text[i] === ")")
                depth--;
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
function blankBlockMacro(text, chars, from, to) {
    const match = /^\s*([A-Za-z_]\w*)\s*\(/.exec(text.slice(from, to));
    if (!match || CONTROL_WORDS.has(match[1]))
        return;
    const open = from + match[0].length - 1;
    const close = closeParen(text, open, Math.min(text.length, to + MAX_ARGS_SPAN));
    if (close === -1 || !text.slice(open, close).includes('"'))
        return;
    let next = close;
    while (next < text.length && /[ \t]/.test(text[next]))
        next++;
    if (text[next] !== "{")
        return;
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
function closeParen(text, open, limit) {
    let depth = 0;
    for (let i = open; i < limit; i++) {
        if (text[i] === "(")
            depth++;
        else if (text[i] === ")" && --depth === 0)
            return i + 1;
    }
    return -1;
}
/** Start offset of each line, and the text's length as a last entry. */
export function lineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++)
        if (text[i] === "\n")
            starts.push(i + 1);
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
export function blankMacros(text, rows, onlyKnown = false, repoMacros = NONE) {
    const known = (name) => ATTRIBUTE_MACROS.has(name) || repoMacros.has(name);
    const starts = lineStarts(text);
    const chars = text.split("");
    const every = rows === "all" ? starts.slice(0, -1).map((_, row) => row) : rows;
    for (const row of every) {
        if (row < 0 || row >= starts.length - 1)
            continue;
        const from = starts[row];
        const to = starts[row + 1];
        const line = text.slice(from, to);
        if (/^\s*#/.test(line))
            continue;
        const head = CLASS_HEAD.exec(line);
        if (head && (known(head[2]) || MACRO_NAME.test(head[2]))) {
            const start = from + head[1].length;
            blank(chars, start, start + head[2].length);
        }
        blankTypeArgument(text, chars, from, to);
        if (!onlyKnown)
            blankBlockMacro(text, chars, from, to);
        if (onlyKnown) {
            blankNames(text, chars, from, to, known);
            continue;
        }
        const alone = /^\s*([A-Z_][A-Z0-9_]{2,})\s*(\(.*\))?\s*(\/\/.*|\/\*.*\*\/)?\s*$/.exec(line);
        if (alone && /[A-Z]/.test(alone[1])) {
            blank(chars, from, from + line.trimEnd().length);
            continue;
        }
        blankTypeMacroArgs(text, chars, from, to);
        blankNames(text, chars, from, to, (name) => known(name) || MACRO_NAME.test(name));
    }
    return chars.join("");
}
/** Whether the `'` at `i` separates digits (`1'000`) rather than opening a literal (`u8'x'`, `L'x'`). */
function digitSeparator(text, i) {
    if (text[i] !== "'" || !isWordChar(text[i - 1]))
        return false;
    let start = i - 1;
    while (start > 0 && isWordChar(text[start - 1]))
        start--;
    return /[0-9]/.test(text[start]);
}
/**
 * Whether the `)` at `close` ends a declarator's parameters, as far as one
 * line shows: not inside a comment or literal, and not a condition's
 * (`if (n)`, `for (...)`), whose next line is a statement.
 */
function declaratorParen(text, close) {
    const lineStart = text.lastIndexOf("\n", close) + 1;
    const lineEnd = text.indexOf("\n", close);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    if (literalColumns(line)[close - lineStart])
        return false;
    let depth = 0;
    for (let i = close; i >= Math.max(0, close - MAX_ARGS_SPAN); i--) {
        if (text[i] === ")")
            depth++;
        else if (text[i] === "(" && --depth === 0) {
            let w = i - 1;
            while (w >= 0 && /\s/.test(text[w]))
                w--;
            let start = w;
            while (start >= 0 && isWordChar(text[start]))
                start--;
            return !CONTROL_WORDS.has(text.slice(start + 1, w + 1));
        }
    }
    return false;
}
/**
 * Which columns of one line sit inside a string or character literal or a
 * comment. Per line only: a block comment or raw string opened on an earlier
 * line isn't seen (blanking a name there changes no code, only a body hash).
 */
function literalColumns(line) {
    const inside = new Array(line.length).fill(false);
    let quote = "";
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            inside[i] = true;
            if (ch === "\\") {
                inside[i + 1] = true;
                i++;
            }
            else if (ch === quote)
                quote = "";
            continue;
        }
        if (digitSeparator(line, i))
            continue;
        if (ch === '"' || ch === "'") {
            quote = ch;
            inside[i] = true;
        }
        else if (ch === "/" && line[i + 1] === "/") {
            inside.fill(true, i);
            break;
        }
        else if (ch === "/" && line[i + 1] === "*") {
            const close = line.indexOf("*/", i + 2);
            const end = close === -1 ? line.length : close + 2;
            inside.fill(true, i, end);
            i = end - 1;
        }
    }
    return inside;
}
/** Blank the names `wanted` accepts on one line, where an attribute can sit (see blankMacros). */
function blankNames(text, chars, from, to, wanted) {
    const line = text.slice(from, to);
    const literal = literalColumns(line);
    for (const match of line.matchAll(/\b[A-Za-z_]\w*\b/g)) {
        const column = match.index ?? 0;
        // A name inside a string, a character or a comment is text, not a macro
        if (!wanted(match[0]) || literal[column])
            continue;
        const site = nameSite(text, from, to, from + column, match[0].length);
        if (!site)
            continue;
        if (sfinaeParameter(text, site)) {
            blank(chars, site.start, site.end);
            chars.splice(site.start, SFINAE_PARAMETER.length, ...SFINAE_PARAMETER);
        }
        else if (attributeSite(site)) {
            blank(chars, site.start, site.end);
        }
    }
}
const isBlank = (ch) => /[ \t]/.test(ch);
const isSpace = (ch) => /\s/.test(ch);
/** The first index from `i`, below `to`, that isn't a space or a tab (`to` if none). */
function skipBlanks(text, i, to) {
    let next = i;
    while (next < to && isBlank(text[next]))
        next++;
    return next;
}
/** The last index from `i` down to `from` whose character `skip` refuses, or `from - 1`. */
function skipBack(text, i, from, skip) {
    let back = i;
    while (back >= from && skip(text[back]))
        back--;
    return back;
}
/** The name `[start, start + length)` on the line `[from, to)` and its surroundings, or null when its arguments don't close. */
function nameSite(text, from, to, start, length) {
    let end = start + length;
    let next = skipBlanks(text, end, to);
    const hasArgs = text[next] === "(";
    const { before, prevWord, beforeWord } = lookBehind(text, from, start);
    // `if FMT_CONSTEXPR20 (cond)`: the parentheses are the condition's
    if (hasArgs && prevWord !== "if") {
        // Arguments may run over a few lines: `FMT_ENABLE_IF(a &&\n b)`
        end = closeParen(text, next, Math.min(text.length, to + MAX_ARGS_SPAN));
        if (end === -1)
            return null;
        next = skipBlanks(text, end, to);
    }
    const after = next < text.length ? text[next] : "";
    return { start, end, hasArgs, before, prevWord, beforeWord, after };
}
/** What precedes the name at `start` on the line from `from` (see NameSite). */
function lookBehind(text, from, start) {
    const back = skipBack(text, start - 1, from, isBlank);
    if (back < from) {
        const before = continuesDeclarator(text, from) ? ")" : "";
        return { before, prevWord: "", beforeWord: "" };
    }
    const before = text[back];
    if (!isWordChar(before))
        return { before, prevWord: "", beforeWord: "" };
    const word = skipBack(text, back, from, isWordChar);
    const ahead = skipBack(text, word, from, isBlank);
    return {
        before,
        prevWord: text.slice(word + 1, back + 1),
        beforeWord: ahead >= from ? text[ahead] : "",
    };
}
/**
 * Whether the line from `from` follows a declarator's `)` on the line before:
 * its first name is a trailing attribute continued
 * (`int f(const char *fmt, ...)` / `  PRINTF_ARGS(1, 2);`).
 */
function continuesDeclarator(text, from) {
    const up = skipBack(text, from - 1, 0, isSpace);
    return text[up] === ")" && declaratorParen(text, up);
}
/**
 * `template <typename T, FMT_ENABLE_IF(cond)>`: a SFINAE macro stands for an
 * unnamed parameter with a default, which `int=0` keeps in the same width.
 */
function sfinaeParameter(text, site) {
    const { start, end, before, after } = site;
    return (site.hasArgs &&
        (before === "," || before === "<") &&
        (after === ">" || after === ",") &&
        end - start >= SFINAE_PARAMETER.length &&
        // The replacement must not cover a line break: lines keep their numbers
        !/[\r\n]/.test(text.slice(start, start + SFINAE_PARAMETER.length)) &&
        TEMPLATE_HEAD.test(text.slice(Math.max(0, start - MAX_ARGS_SPAN), start)));
}
/** Characters before a name that end a declaration's previous part: an attribute can follow. */
const ATTRIBUTE_BEFORE = new Set(["", ")", ">", "}", ";", "]"]);
/** Characters before a name that an attribute can follow when a word comes after it. */
const BEFORE_TERM = new Set(["*", "&", "(", ","]);
/** Characters after a name that leave it an attribute: the line's end, `{`, `~`. */
const ATTRIBUTE_AFTER = new Set(["", "\n", "\r", "{", "~"]);
/** Whether the name at `site` sits where an attribute does, not where a value does. */
function attributeSite(site) {
    const { before, prevWord, after } = site;
    if (!attributeBefore(site))
        return false;
    // `struct NAME {` names the struct; `class EXPORT NAME {` doesn't
    if (TAG_WORDS.has(prevWord) && !isWordChar(after))
        return false;
    // `FOO(x);` at the start of a line is a statement, which the grammar reads
    if (before === "" && site.hasArgs && after === ";")
        return false;
    return attributeAfter(site);
}
/** Whether what precedes the name at `site` lets it be an attribute (see attributeSite). */
function attributeBefore(site) {
    const { before, prevWord, after } = site;
    return (ATTRIBUTE_BEFORE.has(before) ||
        (prevWord !== "" && !VALUE_POSITION.has(prevWord)) ||
        // `T *RESTRICT p`, `f(EV_P_ ev_io *w)`: two terms side by side are never an expression
        (BEFORE_TERM.has(before) && isWordChar(after)));
}
/** Whether what follows the name at `site` lets it be an attribute (see attributeSite). */
function attributeAfter(site) {
    const { before, prevWord, after } = site;
    return (ATTRIBUTE_AFTER.has(after) ||
        isWordChar(after) ||
        (after === ";" && before !== "") ||
        ((after === "=" || after === ":") && site.hasArgs) ||
        (after === "(" && prevWord === "if") ||
        afterDeclaratorName(site));
}
/** `const T *p UNUSED,`: after a declarator's name, not after a type's. */
function afterDeclaratorName(site) {
    const { prevWord, beforeWord, after } = site;
    return ((after === "," || after === ")") &&
        prevWord !== "" &&
        (beforeWord === "*" || beforeWord === "&" || isWordChar(beforeWord)));
}
/**
 * Where the directive in `[from, to)` opens a block comment it doesn't close,
 * or -1. A `/*` inside a string, a character or a `//` comment opens nothing.
 */
function openComment(text, from, to) {
    let quote = "";
    for (let i = from; i < to; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === "\\")
                i++;
            else if (ch === quote || ch === "\n")
                quote = "";
        }
        else if (ch === '"' || (ch === "'" && !digitSeparator(text, i))) {
            quote = ch;
        }
        else if (ch === "/" && text[i + 1] === "/") {
            const end = text.indexOf("\n", i);
            if (end === -1)
                return -1;
            i = end;
        }
        else if (ch === "/" && text[i + 1] === "*") {
            const close = text.indexOf("*/", i + 2);
            if (close === -1 || close + 2 > to)
                return i;
            i = close + 1;
        }
    }
    return -1;
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
export function firstBranches(text, dialect) {
    const starts = lineStarts(text);
    const chars = text.split("");
    const stack = [];
    for (let row = 0; row < starts.length - 1; row++) {
        const from = starts[row];
        const line = text.slice(from, starts[row + 1]);
        const directive = /^\s*#\s*(\w*)(.*)$/s.exec(line);
        if (!directive) {
            if (!reading(stack))
                blank(chars, from, starts[row + 1]);
            continue;
        }
        const [, keyword, rest] = directive;
        row = continuedTo(text, starts, row);
        const to = starts[row + 1];
        enterBranch(stack, keyword, rest, dialect);
        blank(chars, from, to);
        // A block comment the directive opens and doesn't close (`#define X 1 /* a
        // note that runs on`) goes with it: its rest is not code
        const close = openComment(text, from, to) === -1 ? -1 : text.indexOf("*/", to);
        if (close !== -1) {
            row = blankComment(chars, starts, row, to, close, reading(stack));
        }
    }
    return chars.join("");
}
/** Whether every open conditional reads its current branch. */
function reading(stack) {
    return stack.every((level) => level.reading);
}
/** The last line of the directive on `row`: a directive continued with `\` spans the lines that follow. */
function continuedTo(text, starts, row) {
    let last = row;
    while (/\\\s*$/.test(text.slice(starts[last], starts[last + 1])) &&
        last + 1 < starts.length - 1) {
        last++;
    }
    return last;
}
/** Follow one directive's effect on the open conditionals: `#if` opens one, `#elif`/`#else` moves to its next branch, `#endif` closes it. */
function enterBranch(stack, keyword, condition, dialect) {
    if (keyword === "if" || keyword === "ifdef" || keyword === "ifndef") {
        const read = !skipsFirstBranch(condition, keyword, dialect);
        stack.push({ reading: read, taken: read });
    }
    else if (keyword === "elif" || keyword === "else") {
        const level = stack.at(-1);
        if (level) {
            level.reading = !level.taken;
            level.taken = true;
        }
    }
    else if (keyword === "endif") {
        stack.pop();
    }
}
/** Whether a conditional's first branch isn't read: `#if 0`, or `__cplusplus` tested in the dialect that never defines it that way. */
function skipsFirstBranch(condition, keyword, dialect) {
    const c = condition.trim();
    if (keyword === "if" && /^0\b/.test(c))
        return true;
    // `__cplusplus`, `defined(__cplusplus)`, and either negated with `!`
    const cplusplus = /^(!\s*)?(?:defined\s*\(?\s*)?__cplusplus\b/.exec(c);
    if (!cplusplus)
        return false;
    const positive = (keyword === "ifdef" || keyword === "if") && cplusplus[1] === undefined;
    return dialect === "c" ? positive : !positive;
}
/**
 * Blank the comment a directive ending at `to` opens, through the comment's
 * close at `close`, and return the row it closes on. The rest of the closing
 * line belongs to the branch the directive is in: blanked unless it is read.
 */
function blankComment(chars, starts, row, to, close, read) {
    let last = row;
    blank(chars, to, close + 2);
    while (last + 1 < starts.length - 1 && starts[last + 1] <= close)
        last++;
    if (!read)
        blank(chars, close + 2, starts[last + 1]);
    return last;
}
//# sourceMappingURL=c-cpp-macros.js.map