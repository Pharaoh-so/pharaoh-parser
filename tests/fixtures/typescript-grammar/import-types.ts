// Import types as a generic's name, an indexed access's object and keyof's operand.
export function fork(
	msg: import("./worker").Request,
): Promise<import("./harness").WorkerResult<import("./worker").Payload>> {
	return run(msg);
}

export interface Done {
	cloneTimings?: import("./map").MapResult["cloneTimings"];
	keys: keyof import("./map").MapResult & string;
	firsts: import("./map").Pair<string, number>["left"][];
}

export type Alias = import("./map").Pair<string, number>;
