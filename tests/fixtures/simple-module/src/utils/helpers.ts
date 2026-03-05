export function add(a: number, b: number): number {
	return a + b;
}

export const multiply = (a: number, b: number): number => a * b;

function privateHelper(x: string): string {
	return x.toUpperCase();
}

export async function fetchData(url: string): Promise<string> {
	const res = await fetch(url);
	return res.text();
}
