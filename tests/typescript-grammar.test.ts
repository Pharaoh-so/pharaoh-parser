import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseFile } from "../src/tree-sitter.js";
import { Parser, tsLanguage, tsxLanguage } from "../src/wasm-init.js";

const fixture = fileURLToPath(
	new URL("fixtures/typescript-grammar/syntax.ts", import.meta.url),
);
const source = readFileSync(fixture, "utf-8");

describe.each([
	{ extension: "ts", language: tsLanguage },
	{ extension: "tsx", language: tsxLanguage },
])("TypeScript grammar (.$extension)", ({ extension, language }) => {
	it("parses import types and typed calls without losing source positions", () => {
		const result = parseFile(fixture, `syntax.${extension}`, (root) => {
			expect(root.hasError).toBe(false);

			const [property] = root.descendantsOfType("property_signature");
			const array = property.childForFieldName("type")?.firstNamedChild;
			expect(array?.type).toBe("array_type");
			expect(array?.firstNamedChild?.text).toBe('import("./types").Thing');

			const calls = root.descendantsOfType("call_expression");
			const tag = calls.find(
				(call) => call.childForFieldName("function")?.text === "db.query",
			);
			expect(tag?.childForFieldName("type_arguments")?.text).toBe("<Row[]>");
			expect(tag?.childForFieldName("arguments")?.type).toBe("template_string");
			expect(tag?.descendantsOfType("template_substitution")[0]?.text).toBe(
				"${lookup()}",
			);
			expect(tag?.startIndex).toBe(source.indexOf("db.query"));
			expect(tag?.endIndex).toBe(
				source.indexOf(";", source.indexOf("db.query")),
			);

			const loads = calls.filter(
				(call) => call.childForFieldName("function")?.text === "load",
			);
			expect(loads.map((call) => call.parent?.type)).toEqual([
				"variable_declarator",
				"await_expression",
				"await_expression",
			]);
			expect(loads[2]?.parent?.parent?.type).toBe("spread_element");
			for (const call of loads) {
				const type = call.childForFieldName("type_arguments")?.firstNamedChild;
				expect(type?.type).toBe("type_query");
				expect(type?.text).toBe('typeof import("./types")');
			}

			const values = root
				.descendantsOfType("variable_declarator")
				.slice(-2)
				.map((declaration) => declaration.childForFieldName("value"));
			expect(values.map((value) => value?.type)).toEqual([
				"binary_expression",
				"binary_expression",
			]);
		});
		expect(result.imports.map((item) => item.source)).toEqual(["./runtime"]);
	});

	it("reports genuinely malformed TypeScript", () => {
		const parser = new Parser();
		parser.setLanguage(language);
		const tree = parser.parse("const broken: = ;");
		try {
			expect(tree?.rootNode.hasError).toBe(true);
		} finally {
			tree?.delete();
			parser.delete();
		}
	});
});
