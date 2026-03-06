import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { Language, type Node, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);

// Resolve WASM paths via require.resolve — works in pnpm virtual store + Docker
// web-tree-sitter has strict ESM exports, so resolve main entry + dirname
const wasmDir = dirname(require.resolve("web-tree-sitter"));
// biome-ignore format: keep on one line so knip detects the dependency
const tsDir = require.resolve("tree-sitter-typescript/package.json").replace(/\/package\.json$/, "");
const pyDir = require
	.resolve("tree-sitter-python/package.json")
	.replace(/\/package\.json$/, "");

// Validate WASM files exist before attempting to load — fail fast with clear diagnostics
const requiredWasm: [string, string][] = [
	[`${wasmDir}/web-tree-sitter.wasm`, "web-tree-sitter"],
	[`${tsDir}/tree-sitter-typescript.wasm`, "tree-sitter-typescript"],
	[`${tsDir}/tree-sitter-tsx.wasm`, "tree-sitter-typescript (tsx)"],
	[`${pyDir}/tree-sitter-python.wasm`, "tree-sitter-python"],
];
for (const [path, label] of requiredWasm) {
	if (!existsSync(path)) {
		throw new Error(`WASM file not found for ${label}: ${path}`);
	}
}

try {
	await Parser.init({
		locateFile: (name: string) => `${wasmDir}/${name}`,
	});
} catch (err) {
	throw new Error(
		`web-tree-sitter WASM init failed: ${err instanceof Error ? err.message : String(err)}`,
	);
}

export const tsLanguage = await Language.load(
	`${tsDir}/tree-sitter-typescript.wasm`,
);
export const tsxLanguage = await Language.load(`${tsDir}/tree-sitter-tsx.wasm`);
export const pyLanguage = await Language.load(
	`${pyDir}/tree-sitter-python.wasm`,
);

export { Parser };
export type SyntaxNode = Node;
