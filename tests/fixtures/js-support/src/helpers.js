/**
 * A helper that adds two numbers.
 */
function add(a, b) {
	return a + b;
}

const multiply = (a, b) => a * b;

class Calculator {
	constructor(initial) {
		this.value = initial;
	}

	add(n) {
		this.value += n;
		return this;
	}

	reset() {
		this.value = 0;
	}
}

module.exports = { add, multiply, Calculator };
