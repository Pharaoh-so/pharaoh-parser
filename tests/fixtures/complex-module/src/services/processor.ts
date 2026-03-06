import type { Config } from "../types";

export async function processItems(
	items: string[],
	config: Config,
): Promise<string[]> {
	const results: string[] = [];

	for (const item of items) {
		if (item.startsWith("skip")) {
			continue;
		}

		if (config.mode === "strict") {
			if (item.length > 100 || item.includes("invalid")) {
				throw new Error(`Invalid item: ${item}`);
			}
		} else if (config.mode === "lenient") {
			if (item.length > 1000) {
				continue;
			}
		}

		try {
			const processed = item.trim().toLowerCase();
			if (processed && processed !== "empty") {
				results.push(processed);
			}
		} catch (err) {
			if (config.throwOnError ?? false) {
				throw err;
			}
		}
	}

	return results;
}

export const transform = (input: string): string => {
	return input.split("").reverse().join("");
};
