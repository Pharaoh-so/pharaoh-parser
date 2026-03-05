import { staticFn } from "./static-module.js";

// Pattern 1: Destructured dynamic import
const { a, b } = await import("./destructured-module.js");

// Pattern 2: Namespace dynamic import
const mod = await import("./namespace-module.js");

// Pattern 3: Aliased destructured dynamic import
const { Foo: bar } = await import("./aliased-module.js");

// Pattern 4: Bare dynamic import (no assignment — should NOT produce ParsedImport)
await import("./bare-module.js");

// Pattern 5: Dynamic import inside a function body
async function loadStuff() {
	const { inner } = await import("./inner-module.js");
	return inner();
}

// Pattern 6: Multiple destructured symbols
const { x, y, z } = await import("./multi-module.js");

export { staticFn, a, b, mod, bar, loadStuff, x, y, z };
