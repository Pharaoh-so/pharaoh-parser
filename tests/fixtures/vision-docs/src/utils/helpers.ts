/**
 * Add two numbers together and return the sum.
 */
export function add(a: number, b: number): number {
	return a + b;
}

/** Multiply two numbers */
export const multiply = (a: number, b: number): number => a * b;

function privateHelper(x: string): string {
	return x.toUpperCase();
}

/**
 * Fetch data from a remote URL.
 * Makes an HTTP GET request and returns the response body as text.
 * This is used by the router module to proxy external API calls.
 */
export async function fetchData(url: string): Promise<string> {
	const res = await fetch(url);
	return res.text();
}
