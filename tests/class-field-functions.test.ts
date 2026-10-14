import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFile } from "../src/tree-sitter.js";

const FIXTURE = path.resolve(__dirname, "fixtures/class-fields/controller.ts");

// Express and DI-style classes bind handlers with class fields
// (`createApiUser = async (req, res) => { ... }`). They were invisible: a
// controller parsed to just its constructor, so every handler body and its
// calls were missing from the graph.
describe("class fields holding functions", () => {
	const result = parseFile(FIXTURE, "src/controller.ts");
	const byName = (name: string) =>
		result.functions.find((f) => f.name === name);

	it("reports arrow and function-expression fields as methods of their class", () => {
		expect(byName("createApiUser")).toMatchObject({
			className: "ApiUserController",
			isAsync: true,
			isExported: false,
			lineStart: 11,
			lineEnd: 13,
			paramCount: 2,
		});
		expect(byName("handleLegacy")).toMatchObject({
			className: "ApiUserController",
			lineStart: 15,
			lineEnd: 17,
		});
		expect(byName("deleteApiUser")).toMatchObject({
			className: "ApiUserController",
			isAsync: false,
			decorators: ["@Log()"],
		});
	});

	it("keeps data fields out and lists function fields among the class's methods", () => {
		expect(byName("limit")).toBeUndefined();
		const cls = result.classes.find((c) => c.name === "ApiUserController");
		expect(cls?.methods).toEqual([
			"constructor",
			"createApiUser",
			"handleLegacy",
			"deleteApiUser",
			"save",
		]);
	});
});
