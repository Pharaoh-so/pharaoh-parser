import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFile } from "../src/python-tree-sitter.js";

const FIXTURES_DIR = path.resolve(__dirname, "fixtures");
const ADVANCED_DIR = path.join(FIXTURES_DIR, "python-advanced");

describe("python parser — decorators", () => {
	const result = parseFile(
		path.join(ADVANCED_DIR, "src/decorators.py"),
		"src/decorators.py",
	);

	it("sets language and counts lines", () => {
		expect(result.language).toBe("python");
		expect(result.loc).toBe(68);
	});

	it("detects decorator functions as regular exported functions", () => {
		const myDecorator = result.functions.find((f) => f.name === "my_decorator");
		expect(myDecorator).toBeDefined();
		expect(myDecorator!.isExported).toBe(true);
		expect(myDecorator!.paramCount).toBe(1);
		expect(myDecorator!.className).toBeUndefined();
		expect(myDecorator!.jsdoc).toBe("A custom decorator.");
	});

	it("detects decorator factory as regular exported function", () => {
		const logCalls = result.functions.find((f) => f.name === "log_calls");
		expect(logCalls).toBeDefined();
		expect(logCalls!.isExported).toBe(true);
		expect(logCalls!.paramCount).toBe(1);
		expect(logCalls!.jsdoc).toBe(
			"A decorator factory (parameterized decorator).",
		);
		expect(logCalls!.signature).toBe("def log_calls(level: str)");
	});

	it("extracts @staticmethod — self not present, paramCount=0", () => {
		const createId = result.functions.find((f) => f.name === "create_id");
		expect(createId).toBeDefined();
		expect(createId!.className).toBe("Service");
		expect(createId!.paramCount).toBe(0);
		expect(createId!.isAsync).toBe(false);
		expect(createId!.jsdoc).toBe("Generate a unique ID.");
	});

	it("extracts @classmethod — cls excluded from paramCount", () => {
		const fromConfig = result.functions.find((f) => f.name === "from_config");
		expect(fromConfig).toBeDefined();
		expect(fromConfig!.className).toBe("Service");
		expect(fromConfig!.paramCount).toBe(1); // cls excluded, config counted
		expect(fromConfig!.signature).toContain("cls, config: dict");
	});

	it("extracts @property as a method", () => {
		const name = result.functions.find(
			(f) => f.name === "name" && f.className === "Service",
		);
		expect(name).toBeDefined();
		expect(name!.paramCount).toBe(0); // self excluded
		expect(name!.jsdoc).toBe("The service name.");
	});

	it("extracts methods with custom decorators", () => {
		const process = result.functions.find(
			(f) => f.name === "process" && f.className === "Service",
		);
		expect(process).toBeDefined();
		expect(process!.paramCount).toBe(1); // self excluded
		expect(process!.jsdoc).toBe("Process data with a custom decorator.");
	});

	it("extracts methods with stacked decorators", () => {
		const handle = result.functions.find(
			(f) => f.name === "handle" && f.className === "Service",
		);
		expect(handle).toBeDefined();
		expect(handle!.paramCount).toBe(1); // self excluded
		expect(handle!.jsdoc).toBe("Handle a request with stacked decorators.");
	});

	it("extracts the Service class with all 5 methods", () => {
		const service = result.classes.find((c) => c.name === "Service");
		expect(service).toBeDefined();
		expect(service!.isExported).toBe(true);
		expect(service!.methods).toEqual([
			"create_id",
			"from_config",
			"name",
			"process",
			"handle",
		]);
		expect(service!.loc).toBe(28);
		expect(service!.complexity).toBe(5);
	});

	it("extracts standalone decorated function", () => {
		const fn = result.functions.find((f) => f.name === "standalone_decorated");
		expect(fn).toBeDefined();
		expect(fn!.isExported).toBe(true);
		expect(fn!.paramCount).toBe(1);
		expect(fn!.className).toBeUndefined();
		expect(fn!.lineStart).toBe(58);
	});

	it("extracts double-decorated standalone function", () => {
		const fn = result.functions.find((f) => f.name === "double_decorated");
		expect(fn).toBeDefined();
		expect(fn!.isExported).toBe(true);
		expect(fn!.paramCount).toBe(2);
		expect(fn!.lineStart).toBe(65);
	});

	it("exports decorator functions and the class", () => {
		const exportNames = result.exports.map((e) => e.name);
		expect(exportNames).toContain("my_decorator");
		expect(exportNames).toContain("log_calls");
		expect(exportNames).toContain("Service");
		expect(exportNames).toContain("standalone_decorated");
		expect(exportNames).toContain("double_decorated");
		expect(exportNames).toHaveLength(5);
	});

	it("detects functools import", () => {
		const imp = result.imports.find((i) => i.source === "functools");
		expect(imp).toBeDefined();
		expect(imp!.symbols).toContain("wraps");
		expect(imp!.isNamespace).toBe(false);
	});
});

describe("python parser — inheritance", () => {
	const result = parseFile(
		path.join(ADVANCED_DIR, "src/inheritance.py"),
		"src/inheritance.py",
	);

	it("sets language and counts lines", () => {
		expect(result.language).toBe("python");
		expect(result.loc).toBe(88);
	});

	it("detects 7 classes", () => {
		expect(result.classes).toHaveLength(7);
		const names = result.classes.map((c) => c.name);
		expect(names).toEqual([
			"Animal",
			"Dog",
			"Serializable",
			"Printable",
			"SmartDog",
			"Shape",
			"Circle",
		]);
	});

	it("all classes are exported (no __all__, no _ prefix)", () => {
		for (const cls of result.classes) {
			expect(cls.isExported).toBe(true);
		}
	});

	it("parser does NOT set extends field for Python classes", () => {
		// This is a known limitation — the Python parser doesn't capture superclasses
		const dog = result.classes.find((c) => c.name === "Dog");
		expect(dog).toBeDefined();
		expect(dog!.extends).toBeUndefined();

		const smartDog = result.classes.find((c) => c.name === "SmartDog");
		expect(smartDog).toBeDefined();
		expect(smartDog!.extends).toBeUndefined();
	});

	it("extracts Animal methods", () => {
		const animal = result.classes.find((c) => c.name === "Animal");
		expect(animal!.methods).toEqual(["speak", "move"]);
		expect(animal!.loc).toBe(10);
		expect(animal!.complexity).toBe(2);
	});

	it("extracts Dog methods (overridden speak + new fetch)", () => {
		const dog = result.classes.find((c) => c.name === "Dog");
		expect(dog!.methods).toEqual(["speak", "fetch"]);
		expect(dog!.loc).toBe(10);
		expect(dog!.complexity).toBe(2);
	});

	it("Dog.fetch excludes self from paramCount", () => {
		const fetch = result.functions.find(
			(f) => f.name === "fetch" && f.className === "Dog",
		);
		expect(fetch).toBeDefined();
		expect(fetch!.paramCount).toBe(1);
		expect(fetch!.jsdoc).toBe("Fetch an item.");
	});

	it("extracts SmartDog (multiple inheritance) with one method", () => {
		const smartDog = result.classes.find((c) => c.name === "SmartDog");
		expect(smartDog!.methods).toEqual(["tricks"]);
		expect(smartDog!.loc).toBe(6);
		expect(smartDog!.complexity).toBe(1);
	});

	it("extracts Shape (ABC) with abstract and non-abstract methods", () => {
		const shape = result.classes.find((c) => c.name === "Shape");
		expect(shape!.methods).toEqual(["area", "perimeter", "describe"]);
		expect(shape!.loc).toBe(16);
		expect(shape!.complexity).toBe(3);
	});

	it("extracts Circle with __init__ and concrete methods", () => {
		const circle = result.classes.find((c) => c.name === "Circle");
		expect(circle!.methods).toEqual(["__init__", "area", "perimeter"]);
		expect(circle!.loc).toBe(13);
		expect(circle!.complexity).toBe(3);
	});

	it("Circle.__init__ has paramCount=1 (self excluded)", () => {
		const init = result.functions.find(
			(f) => f.name === "__init__" && f.className === "Circle",
		);
		expect(init).toBeDefined();
		expect(init!.paramCount).toBe(1);
		expect(init!.signature).toContain("radius: float");
	});

	it("exports all 7 classes", () => {
		const classExports = result.exports.filter((e) => e.kind === "class");
		expect(classExports).toHaveLength(7);
	});

	it("detects abc import", () => {
		const imp = result.imports.find((i) => i.source === "abc");
		expect(imp).toBeDefined();
		expect(imp!.symbols).toContain("ABC");
		expect(imp!.symbols).toContain("abstractmethod");
	});
});

describe("python parser — nested functions", () => {
	const result = parseFile(
		path.join(ADVANCED_DIR, "src/nested.py"),
		"src/nested.py",
	);

	it("sets language and counts lines", () => {
		expect(result.language).toBe("python");
		expect(result.loc).toBe(47);
	});

	it("only detects top-level functions, NOT inner/nested functions", () => {
		// The parser only extracts top-level and class-level functions.
		// Inner functions (closures, helpers) are not detected — this is by design.
		const names = result.functions.map((f) => f.name);
		expect(names).toEqual([
			"outer_function",
			"make_multiplier",
			"deeply_nested",
			"method_with_inner",
		]);
	});

	it("does NOT detect inner_add, multiplier, level_one, level_two, helper", () => {
		const innerNames = [
			"inner_add",
			"multiplier",
			"level_one",
			"level_two",
			"helper",
		];
		for (const name of innerNames) {
			expect(result.functions.find((f) => f.name === name)).toBeUndefined();
		}
	});

	it("outer_function includes inner function lines in its loc", () => {
		const outer = result.functions.find((f) => f.name === "outer_function");
		expect(outer!.lineStart).toBe(9);
		expect(outer!.lineEnd).toBe(16);
		expect(outer!.loc).toBe(8);
		expect(outer!.paramCount).toBe(1);
	});

	it("make_multiplier has no return type annotation", () => {
		const factory = result.functions.find((f) => f.name === "make_multiplier");
		expect(factory!.signature).toBe("def make_multiplier(factor: int)");
		expect(factory!.paramCount).toBe(1);
	});

	it("deeply_nested spans 9 lines", () => {
		const deep = result.functions.find((f) => f.name === "deeply_nested");
		expect(deep!.loc).toBe(9);
		expect(deep!.paramCount).toBe(0);
	});

	it("extracts class with a method that has inner functions", () => {
		const cls = result.classes.find((c) => c.name === "WithNestedMethods");
		expect(cls).toBeDefined();
		expect(cls!.methods).toEqual(["method_with_inner"]);
		expect(cls!.isExported).toBe(true);

		const method = result.functions.find((f) => f.name === "method_with_inner");
		expect(method!.className).toBe("WithNestedMethods");
		expect(method!.paramCount).toBe(0); // self excluded
	});

	it("exports top-level functions and the class", () => {
		const exportNames = result.exports.map((e) => e.name);
		expect(exportNames).toEqual([
			"outer_function",
			"make_multiplier",
			"deeply_nested",
			"WithNestedMethods",
		]);
	});
});

describe("python parser — complex imports", () => {
	const result = parseFile(
		path.join(ADVANCED_DIR, "src/imports_complex.py"),
		"src/imports_complex.py",
	);

	it("sets language and counts lines", () => {
		expect(result.language).toBe("python");
		expect(result.loc).toBe(46);
	});

	it("detects plain `import os`", () => {
		const imp = result.imports.find(
			(i) => i.source === "os" && i.isNamespace === true,
		);
		expect(imp).toBeDefined();
		expect(imp!.symbols).toEqual(["os"]);
		expect(imp!.line).toBe(8);
	});

	it("detects aliased `import json as j`", () => {
		const imp = result.imports.find(
			(i) => i.source === "json" && i.symbols.includes("j"),
		);
		expect(imp).toBeDefined();
		expect(imp!.isNamespace).toBe(true);
		expect(imp!.line).toBe(11);
	});

	it("detects star import `from os.path import *`", () => {
		const imp = result.imports.find((i) => i.source === "os.path");
		expect(imp).toBeDefined();
		expect(imp!.symbols).toContain("*");
		expect(imp!.isNamespace).toBe(true);
		expect(imp!.line).toBe(14);
	});

	it("detects multi-line parenthesized import from typing", () => {
		const imp = result.imports.find((i) => i.source === "typing");
		expect(imp).toBeDefined();
		expect(imp!.symbols).toContain("Any");
		expect(imp!.symbols).toContain("Dict");
		expect(imp!.symbols).toContain("List");
		expect(imp!.symbols).toContain("Optional");
		expect(imp!.symbols).toContain("Union");
		expect(imp!.line).toBe(17);
	});

	it("detects relative import `from . import decorators`", () => {
		const imp = result.imports.find(
			(i) => i.source === "." && i.symbols.includes("decorators"),
		);
		expect(imp).toBeDefined();
		expect(imp!.isNamespace).toBe(false);
		expect(imp!.line).toBe(26);
	});

	it("detects parent relative import `from .. import src`", () => {
		const imp = result.imports.find(
			(i) => i.source === ".." && i.symbols.includes("src"),
		);
		expect(imp).toBeDefined();
		expect(imp!.line).toBe(27);
	});

	it("detects relative from-import `from .inheritance import Animal, Dog`", () => {
		const imp = result.imports.find((i) => i.source === ".inheritance");
		expect(imp).toBeDefined();
		expect(imp!.symbols).toContain("Animal");
		expect(imp!.symbols).toContain("Dog");
		expect(imp!.line).toBe(28);
	});

	it("does NOT detect conditional imports inside try/except", () => {
		// The parser only processes top-level children of the module.
		// Imports inside try/except blocks are NOT detected — this is a known limitation.
		const ujsonImport = result.imports.find(
			(i) => i.source === "ujson" || i.symbols.includes("json_lib"),
		);
		expect(ujsonImport).toBeUndefined();
	});

	it("detects multi-symbol import from collections", () => {
		const imp = result.imports.find((i) => i.source === "collections");
		expect(imp).toBeDefined();
		expect(imp!.symbols).toContain("OrderedDict");
		expect(imp!.symbols).toContain("defaultdict");
		expect(imp!.symbols).toContain("namedtuple");
	});

	it("detects aliased from-import `from datetime import datetime as dt, timedelta as td`", () => {
		const imp = result.imports.find((i) => i.source === "datetime");
		expect(imp).toBeDefined();
		// aliased imports: datetime→dt, timedelta→td — the parser stores alias names
		expect(imp!.symbols).toContain("dt");
		expect(imp!.symbols).toContain("td");
		expect(imp!.line).toBe(40);
	});

	it("has 9 total imports (conditional imports excluded)", () => {
		expect(result.imports).toHaveLength(9);
	});

	it("has one function (use_imports)", () => {
		expect(result.functions).toHaveLength(1);
		expect(result.functions[0].name).toBe("use_imports");
		expect(result.functions[0].isExported).toBe(true);
		expect(result.functions[0].paramCount).toBe(0);
	});
});

describe("python parser — type annotations", () => {
	const result = parseFile(
		path.join(ADVANCED_DIR, "src/type_annotations.py"),
		"src/type_annotations.py",
	);

	it("sets language and counts lines", () => {
		expect(result.language).toBe("python");
		expect(result.loc).toBe(65);
	});

	it("preserves complex type annotations in signatures", () => {
		const optional = result.functions.find((f) => f.name === "simple_optional");
		expect(optional!.signature).toBe(
			"def simple_optional(x: Optional[int] = None) -> Optional[str]",
		);
		expect(optional!.paramCount).toBe(1);

		const union = result.functions.find((f) => f.name === "union_params");
		expect(union!.signature).toBe(
			"def union_params(value: Union[str, int, float]) -> Union[bool, None]",
		);
		expect(union!.paramCount).toBe(1);

		const dict = result.functions.find((f) => f.name === "complex_dict");
		expect(dict!.signature).toBe(
			"def complex_dict(data: Dict[str, List[int]]) -> Dict[str, Any]",
		);
		expect(dict!.paramCount).toBe(1);

		const tuple = result.functions.find((f) => f.name === "tuple_return");
		expect(tuple!.signature).toBe(
			"def tuple_return(x: int, y: int) -> Tuple[int, int, int]",
		);
		expect(tuple!.paramCount).toBe(2);

		const callable = result.functions.find((f) => f.name === "callable_param");
		expect(callable!.signature).toBe(
			"def callable_param(fn: Callable[[int, int], int], a: int, b: int) -> int",
		);
		expect(callable!.paramCount).toBe(3);
	});

	it("simple_optional has complexity 2 (if branch)", () => {
		const fn = result.functions.find((f) => f.name === "simple_optional");
		expect(fn!.complexity).toBe(2);
	});

	it("detects generic class Container with 3 methods", () => {
		const container = result.classes.find((c) => c.name === "Container");
		expect(container).toBeDefined();
		expect(container!.methods).toEqual(["__init__", "get", "map"]);
		expect(container!.isExported).toBe(true);
		expect(container!.loc).toBe(13);
		expect(container!.complexity).toBe(3);
	});

	it("Container.get excludes self, has paramCount=0", () => {
		const get = result.functions.find(
			(f) => f.name === "get" && f.className === "Container",
		);
		expect(get!.paramCount).toBe(0);
		expect(get!.signature).toBe("def get(self) -> T");
	});

	it("Container.map has paramCount=1 (self excluded)", () => {
		const map = result.functions.find(
			(f) => f.name === "map" && f.className === "Container",
		);
		expect(map!.paramCount).toBe(1);
	});

	it("detects MultiGeneric with 2 methods", () => {
		const mg = result.classes.find((c) => c.name === "MultiGeneric");
		expect(mg).toBeDefined();
		expect(mg!.methods).toEqual(["__init__", "pair"]);
		expect(mg!.loc).toBe(10);
		expect(mg!.complexity).toBe(2);
	});

	it("MultiGeneric.__init__ has paramCount=2 (self excluded)", () => {
		const init = result.functions.find(
			(f) => f.name === "__init__" && f.className === "MultiGeneric",
		);
		expect(init!.paramCount).toBe(2);
		expect(init!.signature).toContain("key: K, value: V");
	});

	it("exports 5 functions and 2 classes", () => {
		const fnExports = result.exports.filter((e) => e.kind === "function");
		const clsExports = result.exports.filter((e) => e.kind === "class");
		expect(fnExports).toHaveLength(5);
		expect(clsExports).toHaveLength(2);
		expect(clsExports.map((e) => e.name)).toEqual([
			"Container",
			"MultiGeneric",
		]);
	});
});

describe("python parser — lambdas, module-level code, class variables, slots", () => {
	const result = parseFile(
		path.join(ADVANCED_DIR, "src/lambdas_and_module.py"),
		"src/lambdas_and_module.py",
	);

	it("sets language and counts lines", () => {
		expect(result.language).toBe("python");
		expect(result.loc).toBe(67);
	});

	it("does NOT detect lambda assignments as functions", () => {
		// `double = lambda x: x * 2` is an assignment, not a function_definition
		const double = result.functions.find((f) => f.name === "double");
		expect(double).toBeUndefined();

		const triple = result.functions.find((f) => f.name === "triple");
		expect(triple).toBeUndefined();
	});

	it("detects regular function for contrast", () => {
		const fn = result.functions.find((f) => f.name === "real_function");
		expect(fn).toBeDefined();
		expect(fn!.isExported).toBe(true);
		expect(fn!.paramCount).toBe(1);
		expect(fn!.signature).toBe("def real_function(x: int) -> int");
		expect(fn!.jsdoc).toBe("A normal function for contrast with lambdas.");
	});

	it("detects _private_module_func as not exported", () => {
		const fn = result.functions.find((f) => f.name === "_private_module_func");
		expect(fn).toBeDefined();
		expect(fn!.isExported).toBe(false);
		expect(fn!.paramCount).toBe(0);
		expect(fn!.className).toBeUndefined();
	});

	it("detects WithClassVars class with __init__ and increment", () => {
		const cls = result.classes.find((c) => c.name === "WithClassVars");
		expect(cls).toBeDefined();
		expect(cls!.methods).toEqual(["__init__", "increment"]);
		expect(cls!.isExported).toBe(true);
		expect(cls!.loc).toBe(15);
		expect(cls!.complexity).toBe(2);
	});

	it("WithClassVars.__init__ has paramCount=1 (self excluded)", () => {
		const init = result.functions.find(
			(f) => f.name === "__init__" && f.className === "WithClassVars",
		);
		expect(init!.paramCount).toBe(1);
	});

	it("detects WithSlots class with __init__ and magnitude", () => {
		const cls = result.classes.find((c) => c.name === "WithSlots");
		expect(cls).toBeDefined();
		expect(cls!.methods).toEqual(["__init__", "magnitude"]);
		expect(cls!.isExported).toBe(true);
		expect(cls!.loc).toBe(13);
	});

	it("WithSlots.__init__ has paramCount=3 (self excluded)", () => {
		const init = result.functions.find(
			(f) => f.name === "__init__" && f.className === "WithSlots",
		);
		expect(init!.paramCount).toBe(3);
		expect(init!.signature).toContain("x: int, y: int, z: int");
	});

	it("detects EmptyClass with no methods", () => {
		const cls = result.classes.find((c) => c.name === "EmptyClass");
		expect(cls).toBeDefined();
		expect(cls!.methods).toEqual([]);
		expect(cls!.loc).toBe(3);
		expect(cls!.complexity).toBe(0);
		expect(cls!.isExported).toBe(true);
	});

	it("does NOT parse if __name__ == '__main__' block as a function", () => {
		// The if __name__ block is just a statement, not a function definition
		const mainFn = result.functions.find((f) => f.name === "__main__");
		expect(mainFn).toBeUndefined();
	});

	it("exports real_function and 3 classes, NOT lambdas or private", () => {
		const exportNames = result.exports.map((e) => e.name);
		expect(exportNames).toEqual([
			"real_function",
			"WithClassVars",
			"WithSlots",
			"EmptyClass",
		]);
	});

	it("has no imports", () => {
		expect(result.imports).toHaveLength(0);
	});

	it("detects exactly 6 functions total (1 top-level + 5 methods)", () => {
		expect(result.functions).toHaveLength(6);
		const topLevel = result.functions.filter((f) => f.className === undefined);
		const methods = result.functions.filter((f) => f.className !== undefined);
		expect(topLevel).toHaveLength(2); // real_function + _private_module_func
		expect(methods).toHaveLength(4); // 2x __init__ + increment + magnitude
	});
});

describe("python parser — __init__.py (package marker)", () => {
	const result = parseFile(
		path.join(ADVANCED_DIR, "src/__init__.py"),
		"src/__init__.py",
	);

	it("parses empty-ish package init", () => {
		expect(result.language).toBe("python");
		expect(result.loc).toBe(2);
		expect(result.functions).toHaveLength(0);
		expect(result.classes).toHaveLength(0);
		expect(result.imports).toHaveLength(0);
		expect(result.exports).toHaveLength(0);
	});
});
