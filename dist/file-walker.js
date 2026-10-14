import fs from "node:fs";
import path from "node:path";
import ignore from "ignore";
const HARDCODED_IGNORES = [
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    ".tox",
    ".mypy_cache",
    ".pytest_cache",
];
const SOURCE_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
]);
const JS_EXT = "(?:[cm]?[jt]sx?)";
const TEST_PATH_RE = new RegExp([
    // x.test.ts, x.spec.tsx, x.test.mts, and NestJS's app.e2e-spec.ts
    // (not any "-spec"/"-test" suffix: ab-test.ts, openapi-spec.ts are code)
    `\\.(?:test|spec)\\.${JS_EXT}$`,
    `[.-]e2e-spec\\.${JS_EXT}$`,
    // test directories and fixtures
    "(?:^|/)(?:__tests__|__mocks__|fixtures)/",
    "^tests?/",
    "/tests?/",
    // test-support modules: x.mock.ts, x.mocks.ts, test-utils.ts, testUtils.ts, setupTests.ts
    `\\.mocks?\\.${JS_EXT}$`,
    `(?:^|/)(?:test[-_]?(?:utils?|helpers?|setup)|setup[-_]?tests)\\.${JS_EXT}$`,
    // Python: test_x.py, x_test.py, conftest.py
    "(?:^|/)test_[^/]*\\.py$",
    "_test\\.py$",
    "(?:^|/)conftest\\.py$",
    // Storybook
    "\\.stories\\.(?:ts|tsx)$",
].join("|"), "i");
/** Classify a file path as test/non-test for reachability analysis. */
export function isTestFile(filePath) {
    return TEST_PATH_RE.test(filePath);
}
export function walkFiles(repoRoot) {
    const ig = ignore();
    // Load .gitignore if present
    const gitignorePath = path.join(repoRoot, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
        const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
        ig.add(gitignoreContent);
    }
    // Add hardcoded ignores
    ig.add(HARDCODED_IGNORES);
    const results = [];
    walkDir(repoRoot, repoRoot, ig, results);
    return results;
}
function walkDir(dir, repoRoot, ig, results) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const absolutePath = path.join(dir, entry.name);
        const relativePath = path.relative(repoRoot, absolutePath);
        // Check ignore before recursing
        if (ig.ignores(relativePath)) {
            continue;
        }
        if (entry.isDirectory()) {
            walkDir(absolutePath, repoRoot, ig, results);
        }
        else if (entry.isFile() &&
            SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            results.push({ absolutePath, relativePath });
        }
    }
}
//# sourceMappingURL=file-walker.js.map