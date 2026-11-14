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

	it("keeps complete call chains inside await and operators outside typed tags", () => {
		const precedence = fileURLToPath(
			new URL("fixtures/typescript-grammar/precedence.ts", import.meta.url),
		);
		parseFile(precedence, `precedence.${extension}`, (root) => {
			expect(root.hasError).toBe(false);
			const bodies = root
				.descendantsOfType("arrow_function")
				.map((arrow) => arrow.childForFieldName("body"));
			expect(bodies.map((body) => body?.type)).toEqual([
				"await_expression",
				"await_expression",
				"await_expression",
			]);
			expect(bodies.map((body) => body?.firstNamedChild?.text)).toEqual([
				"fetch().json()",
				"f()()",
				'load<typeof import("./types")>().json()',
			]);

			const [constructed] = root.descendantsOfType("new_expression");
			expect(constructed.childForFieldName("constructor")?.text).toBe(
				"Factory",
			);
			expect(constructed.childForFieldName("type_arguments")?.text).toBe(
				"<Row>",
			);
			expect(constructed.childForFieldName("arguments")?.text).toBe("()");

			const [addition] = root.descendantsOfType("binary_expression");
			const [negation] = root.descendantsOfType("unary_expression");
			const tags = [
				addition.childForFieldName("right"),
				negation.childForFieldName("argument"),
			];
			for (const tag of tags) {
				expect(tag?.type).toBe("call_expression");
				expect(tag?.childForFieldName("function")?.text).toBe("tag");
				expect(tag?.childForFieldName("arguments")?.type).toBe(
					"template_string",
				);
			}
		});
	});

	it("composes import types with type arguments, indexes and keyof", () => {
		const imports = fileURLToPath(
			new URL("fixtures/typescript-grammar/import-types.ts", import.meta.url),
		);
		const result = parseFile(imports, `import-types.${extension}`, (root) => {
			expect(root.hasError).toBe(false);
			const generics = root.descendantsOfType("generic_type");
			expect(
				generics.map((node) => node.childForFieldName("name")?.text),
			).toEqual([
				"Promise",
				'import("./harness").WorkerResult',
				'import("./map").Pair',
				'import("./map").Pair',
			]);
			expect(generics[1]?.childForFieldName("name")?.type).toBe(
				"member_expression",
			);
			const lookups = root.descendantsOfType("lookup_type");
			expect(lookups.map((node) => node.firstNamedChild?.text)).toEqual([
				'import("./map").MapResult',
				'import("./map").Pair<string, number>',
			]);
			const [keyof] = root.descendantsOfType("index_type_query");
			expect(keyof?.parent?.type).toBe("intersection_type");
			expect(keyof?.firstNamedChild?.text).toBe('import("./map").MapResult');
		});
		expect(result.functions.map((fn) => fn.signature)).toEqual([
			'function fork(\n\tmsg: import("./worker").Request,\n): Promise<import("./harness").WorkerResult<import("./worker").Payload>>',
		]);
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

it.each(["js", "jsx", "mjs", "cjs"])(
	"parses a comparison ending in a template in .%s",
	(extension) => {
		const comparison = fileURLToPath(
			new URL("fixtures/typescript-grammar/comparison.js", import.meta.url),
		);
		parseFile(comparison, `comparison.${extension}`, (root) => {
			expect(root.hasError).toBe(false);
			const [expression] = root.descendantsOfType("binary_expression");
			expect(expression.childForFieldName("operator")?.text).toBe(">");
			expect(expression.childForFieldName("left")?.type).toBe(
				"binary_expression",
			);
			expect(expression.childForFieldName("right")?.type).toBe(
				"template_string",
			);
			expect(root.descendantsOfType("call_expression")).toHaveLength(0);
		});
	},
);
