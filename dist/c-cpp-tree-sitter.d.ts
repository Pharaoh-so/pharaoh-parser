export { collectAttributeMacros } from "./c-cpp-macros.js";
import { type OnTree } from "./parser-shared.js";
import { type ParsedFile } from "./types.js";
export { C_CPP_EXTENSIONS } from "./file-walker.js";
/**
 * Parses a C or C++ file into its structural metadata.
 *
 * Functions are definitions (a body): free functions, methods defined in their
 * class and `A::f` defined outside it, each with `className` set to the class.
 * Overloads are separate functions with the same name. A prototype defines
 * nothing: outside a class it is an export of the header, inside one it is a
 * name in the class's `methods`. An `#include` is an import whose source is
 * the path as written, in angle brackets for a system header. A function is
 * exported unless it is `static` at file scope or inside an unnamed namespace.
 *
 * @param absolutePath - The file to read
 * @param relativePath - Its path in the repo, as recorded in the result
 * A file the grammar cannot read as written (an unknown attribute macro, an
 * `#if` whose branches each hold half a statement) is read again through
 * rewrites that blank macros (see recover); what that read finds is marked
 * `recovered`, and onTree then receives its tree.
 *
 * @param onTree - Optional: also receives the syntax tree before it is freed
 * @param options - Optional: the repo's attribute macros, and the recovery budget
 * @returns The file's functions, classes, includes, exports and scalar macros
 */
export declare function parseFile(absolutePath: string, relativePath: string, onTree?: OnTree, options?: CppParseOptions): ParsedFile;
/**
 * Text one file's recovery may reparse in all. A 100 KB file gets 10
 * reparses, a 1 MB file one; the worst single file in curl, redis and fmt
 * took 0.4-1.4 s on a loaded machine. On the corpus, a larger budget read no
 * more files cleanly.
 */
export declare const RECOVERY_BYTES = 1000000;
/**
 * How many times recovery may reparse a file of `size` characters: the budget
 * in bytes over the file's size, at most MAX_REPARSES. Bytes, not
 * milliseconds, so the same file gets the same reads on any machine.
 *
 * @param size - The file's length
 * @param recoveryBytes - The text recovery may reparse in all
 * @returns The number of reparses allowed (0: no recovery)
 */
export declare function recoveryReparses(size: number, recoveryBytes?: number): number;
/** What parseFile may be told about the repo, and how much recovery may cost. */
export interface CppParseOptions {
    /** The repo's attribute macros (collectAttributeMacros), blanked where an attribute sits. */
    repoMacros?: ReadonlySet<string>;
    /** Bytes recovery may reparse for this file (RECOVERY_BYTES unless set); 0 turns it off. */
    recoveryBytes?: number;
}
//# sourceMappingURL=c-cpp-tree-sitter.d.ts.map