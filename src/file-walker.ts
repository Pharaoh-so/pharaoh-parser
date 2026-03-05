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

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".py"]);

const TEST_PATH_RE =
	/(?:\.(test|spec)\.(ts|tsx|js|jsx)$|(?:^|\/)(__tests__|__mocks__|fixtures)\/|^tests?\/|\/tests?\/|\.stories\.(ts|tsx)$)/;

/** Classify a file path as test/non-test for reachability analysis. */
export function isTestFile(filePath: string): boolean {
	return TEST_PATH_RE.test(filePath);
}

export interface WalkedFile {
	absolutePath: string;
	relativePath: string;
}

export function walkFiles(repoRoot: string): WalkedFile[] {
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
	walkDir(repoRoot, repoRoot, ig, results);
	return results;
}

function walkDir(
	dir: string,
	repoRoot: string,
	ig: ReturnType<typeof ignore>,
	results: WalkedFile[],
): void {
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
		} else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
			results.push({ absolutePath, relativePath });
		}
	}
}
