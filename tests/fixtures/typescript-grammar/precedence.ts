export const first = async () => await fetch().json();
export const second = async () => await f()();
export const generic = async () =>
	await load<typeof import("./types")>().json();
export const addition = a + tag<Row[]>`message`;
export const negation = !tag<Row[]>`message`;
export const constructed = new Factory<Row>();
