import fs from "node:fs";
import path from "node:path";
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
export function detectModules(
	files: ParsedFile[],
	_repoName: string,
	repoRoot?: string,
): DetectedModule[] {
	const moduleMap = new Map<string, DetectedModule>();

	// Detect monorepo workspace packages if repoRoot is provided
	const workspacePackages = repoRoot ? detectWorkspacePackages(repoRoot) : new Set<string>();

	for (const file of files) {
		const parts = file.path.split(path.sep);

		let moduleName: string;
		let modulePath: string;

		// Check if file belongs to a workspace package (monorepo)
		const wsPackage = findWorkspacePackage(parts, workspacePackages);
		if (wsPackage) {
			// Monorepo: packages/my-pkg/src/auth/foo.ts → module = "my-pkg/auth"
			const afterPkg = parts.slice(wsPackage.depth);
			if (afterPkg[0] === "src" && afterPkg.length > 2) {
				moduleName = `${wsPackage.name}/${afterPkg[1]}`;
				modulePath = parts.slice(0, wsPackage.depth + 2).join("/");
			} else if (afterPkg[0] === "src") {
				moduleName = wsPackage.name;
				modulePath = parts.slice(0, wsPackage.depth + 1).join("/");
			} else if (afterPkg.length > 1) {
				moduleName = `${wsPackage.name}/${afterPkg[0]}`;
				modulePath = parts.slice(0, wsPackage.depth + 1).join("/");
			} else {
				moduleName = wsPackage.name;
				modulePath = parts.slice(0, wsPackage.depth).join("/");
			}
		} else if (parts[0] === "src" && parts.length > 2) {
			// Flat repo: src/foo/bar.ts → module = "foo"
			moduleName = parts[1];
			modulePath = `src/${parts[1]}`;
		} else if (parts[0] === "src") {
			moduleName = "root";
			modulePath = "src";
		} else if (parts.length > 1) {
			// Non-src top-level dir
			moduleName = parts[0];
			modulePath = parts[0];
		} else {
			// Root-level file
			moduleName = "root";
			modulePath = ".";
		}

		const existing = moduleMap.get(moduleName);
		if (existing) {
			existing.files.push(file.path);
			existing.loc += file.loc;
		} else {
			moduleMap.set(moduleName, {
				name: moduleName,
				path: modulePath,
				files: [file.path],
				loc: file.loc,
			});
		}
	}

	return Array.from(moduleMap.values());
}

/**
 * Detect workspace package directories by looking for package.json files
 * in common monorepo patterns (packages/*, apps/*, libs/*).
 */
function detectWorkspacePackages(repoRoot: string): Set<string> {
	const packages = new Set<string>();
	const monorepoPatterns = ["packages", "apps", "libs", "modules"];

	for (const dir of monorepoPatterns) {
		const dirPath = path.join(repoRoot, dir);
		try {
			const entries = fs.readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					const pkgJson = path.join(dirPath, entry.name, "package.json");
					if (fs.existsSync(pkgJson)) {
						// Store as "packages/my-pkg" (relative path prefix)
						packages.add(`${dir}/${entry.name}`);
					}
				}
			}
			// ALLOWED-CATCH: workspace directory doesn't exist — skip
		} catch {}
	}

	return packages;
}

/**
 * Check if file path parts match a workspace package.
 * Returns the package name and depth (number of path segments consumed).
 */
function findWorkspacePackage(
	parts: string[],
	packages: Set<string>,
): { name: string; depth: number } | null {
	if (parts.length < 2) return null;

	// Check "packages/my-pkg" pattern (2 segments)
	const candidate = `${parts[0]}/${parts[1]}`;
	if (packages.has(candidate)) {
		return { name: parts[1], depth: 2 };
	}

	return null;
}
