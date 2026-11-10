/**
 * File extensions read as C or C++, lower-case. Walked only on request (see
 * walkFiles): a caller that has no C/C++ parser must not be handed these files.
 */
export declare const C_CPP_EXTENSIONS: Set<string>;
/** Classify a file path as test/non-test for reachability analysis. */
export declare function isTestFile(filePath: string): boolean;
export interface WalkedFile {
    /** Native path, for reading the file. */
    absolutePath: string;
    /** Repo-relative with forward slashes on every OS, as ParsedFile.path records it. */
    relativePath: string;
}
/**
 * Lists a repository's source files, skipping ignored directories.
 * @param repoRoot - The repository's root directory
 * @param options - `cpp: true` also lists C and C++ files (see C_CPP_EXTENSIONS)
 * @returns Each file's native and repo-relative path
 */
export declare function walkFiles(repoRoot: string, options?: {
    cpp?: boolean;
}): WalkedFile[];
//# sourceMappingURL=file-walker.d.ts.map