/**
 * Compute aggregate class metrics from its methods.
 * loc = lineEnd - lineStart + 1, complexity = sum of method complexities.
 */
export function computeClassMetrics(className, lineStart, lineEnd, functions) {
    const loc = lineEnd - lineStart + 1;
    let complexity = 0;
    for (const fn of functions) {
        if (fn.className === className) {
            complexity += fn.complexity;
        }
    }
    return { loc, complexity };
}
//# sourceMappingURL=types.js.map