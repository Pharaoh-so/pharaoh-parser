/**
 * Scripts embedded in another file: Vue's <script> blocks today, and Svelte's
 * <script> or Astro's frontmatter would fit the same way. The script is laid
 * over the file: every character outside its blocks becomes a space and line
 * breaks stay. The result parses with the file's own rows and columns, so
 * every line number and position the parser reports needs no mapping back.
 */
/**
 * Blank everything outside `ranges`, keeping line breaks.
 * @param source - The whole file
 * @param ranges - The script blocks to keep (any order, not overlapping)
 * @returns A string of the same length whose rows match the file's
 */
export function blankOutside(source, ranges) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    let code = "";
    let cursor = 0;
    for (const { start, end } of sorted) {
        code += blank(source.slice(cursor, start)) + source.slice(start, end);
        cursor = end;
    }
    return code + blank(source.slice(cursor));
}
/** Replace each UTF-16 unit but \r and \n with a space, so offsets stay put. */
function blank(text) {
    return text.replace(/[^\r\n]/g, " ");
}
//# sourceMappingURL=embedded-script.js.map