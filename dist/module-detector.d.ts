import type { ParsedFile } from "./types.js";
/** Structural module detected during repo parsing. Used by Cartographer pipeline. */
export interface DetectedModule {
    name: string;
    path: string;
    files: string[];
    loc: number;
}
/**
 * Infer module boundaries from directory structure.
 * Supports both flat repos (src/module/file.ts) and monorepos (packages/pkg/src/module/file.ts).
 * Uses package.json presence as workspace boundary markers.
 */
export declare function detectModules(files: ParsedFile[], _repoName: string, repoRoot?: string): DetectedModule[];
//# sourceMappingURL=module-detector.d.ts.map