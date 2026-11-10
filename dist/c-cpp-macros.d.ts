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
export declare const ATTRIBUTE_MACROS: ReadonlySet<string>;
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
export declare function collectAttributeMacros(sources: Iterable<string>): Set<string>;
/** Start offset of each line, and the text's length as a last entry. */
export declare function lineStarts(text: string): number[];
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
export declare function blankMacros(text: string, rows: Iterable<number> | "all", onlyKnown?: boolean, repoMacros?: ReadonlySet<string>): string;
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
export declare function firstBranches(text: string, dialect: "c" | "cpp"): string;
//# sourceMappingURL=c-cpp-macros.d.ts.map