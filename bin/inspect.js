#!/usr/bin/env node

/**
 * pharaoh-inspect — See exactly what Pharaoh extracts from your codebase.
 *
 * Usage:
 *   node --import=tsx bin/inspect.js /path/to/your/repo
 *   node --import=tsx bin/inspect.js /path/to/your/repo --output result.json
 *
 * Or via npm script:
 *   npm run inspect -- /path/to/your/repo
 *
 * Output: JSON showing all structural metadata Pharaoh would extract.
 * No source code is captured — only function names, signatures, imports,
 * exports, complexity scores, and body hashes (one-way SHA-256).
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";

// Parse CLI arguments
const args = process.argv.slice(2);
const repoPath = args.find((a) => !a.startsWith("--"));
const outputFlag = args.indexOf("--output");
const outputPath = outputFlag !== -1 ? args[outputFlag + 1] : null;

if (!repoPath) {
	console.error("Usage: pharaoh-inspect /path/to/your/repo [--output file.json]");
	console.error("");
	console.error("Outputs JSON showing all structural metadata Pharaoh extracts.");
	console.error("No source code is captured.");
	process.exit(1);
}

const resolvedPath = resolve(repoPath);

// Validate directory exists
if (!existsSync(resolvedPath) || !statSync(resolvedPath).isDirectory()) {
	console.error(`Error: "${resolvedPath}" is not a valid directory.`);
	process.exit(1);
}

// Lazy-load heavy deps
const [
	{ walkFiles: walk },
	{ parseFile: parseTsFile },
	{ parseFile: parsePyFile },
	{ detectModules },
] = await Promise.all([
	import("../src/file-walker.js"),
	import("../src/tree-sitter.js"),
	import("../src/python-tree-sitter.js"),
	import("../src/module-detector.js"),
]);

// Walk and parse
const walkedFiles = walk(resolvedPath);
const files = [];
let parseFailures = 0;

for (const file of walkedFiles) {
	try {
		const isPython = file.relativePath.endsWith(".py");
		const parsed = isPython
			? parsePyFile(file.absolutePath, file.relativePath)
			: parseTsFile(file.absolutePath, file.relativePath);
		files.push(parsed);
	} catch (err) {
		parseFailures++;
		console.error(`  [warn] Failed to parse ${file.relativePath}: ${err.message}`);
	}
}

if (files.length === 0) {
	console.error(`No TypeScript or Python files found in "${resolvedPath}".`);
	process.exit(0);
}

// Detect module boundaries
const repoName = basename(resolvedPath);
const modules = detectModules(files, repoName, resolvedPath);

// Read version from package.json
let version = "unknown";
try {
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
	version = pkg.version;
} catch {}

const result = {
	metadata: {
		parserVersion: version,
		repoPath: resolvedPath,
		repoName,
		fileCount: files.length,
		parseFailures,
		timestamp: new Date().toISOString(),
	},
	files,
	modules,
};

const json = JSON.stringify(result, null, 2);

if (outputPath) {
	writeFileSync(resolve(outputPath), json, "utf-8");
	console.error(`Wrote ${files.length} files to ${outputPath}`);
} else {
	console.log(json);
}
