import { processItems } from "./services/processor";
import type { Config } from "./types";

const defaultConfig: Config = { mode: "lenient" };

export async function run(items: string[]): Promise<string[]> {
	return processItems(items, defaultConfig);
}

export default run;
