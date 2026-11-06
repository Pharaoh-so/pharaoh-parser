import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Language, type Node, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);

// Resolve WASM paths via require.resolve — works in pnpm virtual store + Docker
// web-tree-sitter has strict ESM exports, so resolve main entry + dirname.
// dirname, not stripping "/package.json": Windows paths end in "\package.json".
const wasmDir = dirname(require.resolve("web-tree-sitter"));
const pyDir = dirname(require.resolve("tree-sitter-python/package.json"));
const tsWasm = fileURLToPath(
	new URL("../grammars/tree-sitter-typescript.wasm", import.meta.url),
);
const tsxWasm = fileURLToPath(
	new URL("../grammars/tree-sitter-tsx.wasm", import.meta.url),
);

// Validate WASM files exist before attempting to load — fail fast with clear diagnostics
const requiredWasm: [string, string][] = [
	[`${wasmDir}/web-tree-sitter.wasm`, "web-tree-sitter"],
	[tsWasm, "tree-sitter-typescript"],
	[tsxWasm, "tree-sitter-typescript (tsx)"],
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

export const tsLanguage = await Language.load(tsWasm);
export const tsxLanguage = await Language.load(tsxWasm);
export const pyLanguage = await Language.load(
	`${pyDir}/tree-sitter-python.wasm`,
);

export { Parser };
export type SyntaxNode = Node;
