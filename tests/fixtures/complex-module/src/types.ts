export interface Config {
	mode: "strict" | "lenient";
	throwOnError?: boolean;
}

export type ProcessResult = {
	success: boolean;
	data: string[];
};
