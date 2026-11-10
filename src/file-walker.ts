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
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".vue",
]);

/**
 * File extensions read as C or C++, lower-case. Walked only on request (see
 * walkFiles): a caller that has no C/C++ parser must not be handed these files.
 */
export const C_CPP_EXTENSIONS = new Set([
	...[".c", ".h"],
	...[".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx", ".ipp", ".inl"],
]);

const JS_EXT = "(?:[cm]?[jt]sx?)";
const C_EXT = "(?:c|cc|cpp|cxx)";
const TEST_PATH_RE = new RegExp(
	[
		// x.test.ts, x.spec.tsx, x.test.mts, and NestJS's app.e2e-spec.ts
		// (not any "-spec"/"-test" suffix: ab-test.ts, openapi-spec.ts are code)
		`\\.(?:test|spec)\\.${JS_EXT}$`,
		`[.-]e2e-spec\\.${JS_EXT}$`,
		// test directories and fixtures
		"(?:^|/)(?:__tests__|__mocks__|fixtures)/",
		// end-to-end suites: specs plus their page objects and helpers
		"(?:^|/)(?:e2e|cypress)/",
		"^tests?/",
		"/tests?/",
		// test-support modules: x.mock.ts, x.mocks.ts, test-utils.ts, testUtils.ts, setupTests.ts
		`\\.mocks?\\.${JS_EXT}$`,
		`(?:^|/)(?:test[-_]?(?:utils?|helpers?|setup)|setup[-_]?tests)\\.${JS_EXT}$`,
		// Python: test_x.py, x_test.py, conftest.py
		"(?:^|/)test_[^/]*\\.py$",
		"_test\\.py$",
		"(?:^|/)conftest\\.py$",
		// C and C++: x_test.cc, x_unittest.cpp, test_x.c
		`_(?:test|unittest)\\.${C_EXT}$`,
		`(?:^|/)test_[^/]*\\.${C_EXT}$`,
		// Storybook
		"\\.stories\\.(?:ts|tsx)$",
	].join("|"),
	"i",
);

/** Classify a file path as test/non-test for reachability analysis. */
export function isTestFile(filePath: string): boolean {
	return TEST_PATH_RE.test(filePath);
}

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
export function walkFiles(
	repoRoot: string,
	options: { cpp?: boolean } = {},
): WalkedFile[] {
	const ig = ignore();

	// Load .gitignore if present
	const gitignorePath = path.join(repoRoot, ".gitignore");
	if (fs.existsSync(gitignorePath)) {
		const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
		ig.add(gitignoreContent);
	}

	// Add hardcoded ignores
	ig.add(HARDCODED_IGNORES);

	const results: WalkedFile[] = [];
	walkDir(repoRoot, repoRoot, ig, results, options.cpp ?? false);
	return results;
}

function walkDir(
	dir: string,
	repoRoot: string,
	ig: ReturnType<typeof ignore>,
	results: WalkedFile[],
	cpp: boolean,
): void {
	const entries = fs.readdirSync(dir, { withFileTypes: true });

	for (const entry of entries) {
		const absolutePath = path.join(dir, entry.name);
		// Windows separators would miss the test-file patterns and every import
		// that resolves to this file downstream.
		const relativePath = path
			.relative(repoRoot, absolutePath)
			.split(path.sep)
			.join("/");

		// Check ignore before recursing
		if (ig.ignores(relativePath)) {
			continue;
		}

		if (entry.isDirectory()) {
			walkDir(absolutePath, repoRoot, ig, results, cpp);
		} else if (
			entry.isFile() &&
			(SOURCE_EXTENSIONS.has(path.extname(entry.name)) ||
				(cpp && C_CPP_EXTENSIONS.has(path.extname(entry.name).toLowerCase())))
		) {
			results.push({ absolutePath, relativePath });
		}
	}
}
