/**
 * Scripts embedded in another file: Vue's <script> blocks today, and Svelte's
 * <script> or Astro's frontmatter would fit the same way. The script is laid
 * over the file: every character outside its blocks becomes a space and line
 * breaks stay. The result parses with the file's own rows and columns, so
 * every line number and position the parser reports needs no mapping back.
 */
/** The code to parse for a file, and the extension its script is written in. */
export interface ScriptSource {
    /** The file's script at its original positions: same length, same line breaks. */
    code: string;
    /** The script's extension (".ts", ".tsx", ".js", ".jsx"), which picks the grammar. */
    ext: string;
}
/** A character range [start, end) of a source string. */
export interface SourceRange {
    start: number;
    end: number;
}
/**
 * Blank everything outside `ranges`, keeping line breaks.
 * @param source - The whole file
 * @param ranges - The script blocks to keep (any order, not overlapping)
 * @returns A string of the same length whose rows match the file's
 */
export declare function blankOutside(source: string, ranges: readonly SourceRange[]): string;
//# sourceMappingURL=embedded-script.d.ts.map