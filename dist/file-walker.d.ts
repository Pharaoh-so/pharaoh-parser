/** Classify a file path as test/non-test for reachability analysis. */
export declare function isTestFile(filePath: string): boolean;
export interface WalkedFile {
    /** Native path, for reading the file. */
    absolutePath: string;
    /** Repo-relative with forward slashes on every OS, as ParsedFile.path records it. */
    relativePath: string;
}
export declare function walkFiles(repoRoot: string): WalkedFile[];
//# sourceMappingURL=file-walker.d.ts.map