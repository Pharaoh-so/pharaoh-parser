export interface Widget {
	items: import("./types").Thing[];
}

export const tagged = /* 🗺️ */ db.query<Row[]>`SELECT ${lookup()}`;
export const plain = load<typeof import("./types")>();
export const awaited = async () => await load<typeof import("./types")>();
// biome-ignore format: Exercise the unparenthesized awaited spread.
export const spread = async () => ({ ...await load<typeof import("./types")>() });
const runtime = await import("./runtime");
export { runtime };
export const ordinaryComparison = lhs < rhs > limit;
export const importComparison = lhs < typeof import("./runtime") > limit;
