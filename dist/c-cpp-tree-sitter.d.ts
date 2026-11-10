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
 * @param onTree - Optional: also receives the syntax tree before it is freed
 * @returns The file's functions, classes, includes, exports and scalar macros
 */
export declare function parseFile(absolutePath: string, relativePath: string, onTree?: OnTree): ParsedFile;
//# sourceMappingURL=c-cpp-tree-sitter.d.ts.map