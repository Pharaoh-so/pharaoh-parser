import { add, multiply } from "./utils/helpers";

export function main(): void {
	const result = add(1, 2);
	const product = multiply(3, 4);
	console.log(result, product);
}

export default main;
