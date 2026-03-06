/** Classify a file path as test/non-test for reachability analysis. */
export declare function isTestFile(filePath: string): boolean;
export interface WalkedFile {
    absolutePath: string;
    relativePath: string;
}
export declare function walkFiles(repoRoot: string): WalkedFile[];
//# sourceMappingURL=file-walker.d.ts.map