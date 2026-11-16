# How complexity is counted

Every parser reports two complexity measures under one shared rule. The same logic gets the same number in TypeScript, JavaScript, Python, C and C++, apart from the few choices under [Where the languages still differ](#where-the-languages-still-differ). The values below are checked by `tests/complexity.test.ts`.

| Field | What it is |
|---|---|
| `ParsedFunction.cc` | The function's own cyclomatic complexity: 1, plus 1 per decision point, plus 1 per short-circuit operator, counted only in the function's own control flow. |
| `ParsedFile.excess` | The sum, over every function scope in the file, of how far its own complexity is over 10: Σ max(0, cc − 10). |

`ParsedFunction.complexity` is the original count and is unchanged. It counts `else` in TypeScript and JavaScript, `try`, `with` and `match` in Python, and every decision in nested functions too. New readers should use `cc`.

## Scopes

A function scope is any function form: a declaration, a method, an arrow function or function expression, a generator, a Python `def` or `lambda`, a C/C++ function definition or lambda.

- A function nested inside another one is its own scope. Its decisions count for it, never for the function around it. A callback passed inline doesn't make its caller more complex.
- `excess` counts every scope in the file, whether the parser reports it as a named function or not. Naming an inline callback leaves `excess` unchanged, and so does adding small functions. Splitting a function over 10 lowers it.
- Code outside any function (module-level statements) counts toward no scope.

## What adds one

| Construct | TypeScript / JavaScript | Python | C / C++ |
|---|---|---|---|
| `if`, and each `else if` / `elif` | +1 | +1 | +1 |
| `else` | 0 | 0 | 0 |
| Loop (`for`, `for…of`, `for…in`, range `for`, `while`, `do`) | +1 each | +1 each (`for`, `while`) | +1 each |
| A loop's `else` (Python) | | 0 | |
| Each `case` | +1 | +1 (`case` in `match`) | +1 |
| `default:` / `switch` / `match` itself | 0 | 0 | 0 |
| Each `catch` / `except` handler | +1 | +1 (`except`, `except*`) | +1 |
| `try`, `finally`, `with` | 0 | 0 | 0 |
| Conditional expression | +1 (`a ? b : c`) | +1 (`b if a else c`) | +1 (`a ? b : c`) |
| Short-circuit operator | +1 each `&&` `\|\|` `??` | +1 each `and` `or` | +1 each `&&` `\|\|` (`and` `or`, and in a fold expression); not the `&&` of an rvalue reference |
| Short-circuit assignment | +1 each `&&=` `\|\|=` `??=` | | |
| Comprehension clause | | +1 each `for` and `if` | |
| Optional chaining `?.` | 0 | | |

A chain like `a && b && c` adds two, one per operator.

## Where the languages still differ

These are choices, kept so each rule stays one line:

- **Python `match`**: every `case` adds one, including the wildcard `case _` (TS/C `default:` adds nothing). `case 1 | 2:` adds one where `case 1: case 2:` adds two, and a guard (`case x if y:`) adds one more.
- **Python defaults and annotations** count toward the function they belong to, though Python evaluates them once, when the function is defined.
- **C/C++ preprocessor conditions**: an `&&` or `||` in an `#if` inside a function body counts, as do those in a `static_assert` or `noexcept` condition.
- **Recovered C/C++ files** (`recovered: true`): a function restored from an `#else` branch counts toward `excess`, but a lambda inside it doesn't.

## Example

The same logic in three languages, each with `cc` 6 (1, plus `if`, `&&`, the loop, the inner `if` and the conditional expression):

```ts
function f(a, b, xs) {
	if (a && b) {
		for (const x of xs) {
			if (x > 0) return 1;
			else return 2;
		}
	}
	return a ? 3 : 4;
}
```

```python
def f(a, b, xs):
    if a and b:
        for x in xs:
            if x > 0:
                return 1
            else:
                return 2
    return 3 if a else 4
```

```c
int f(int a, int b, int *xs, int n) {
	if (a && b) {
		for (int i = 0; i < n; i++) {
			if (xs[i] > 0) return 1;
			else return 2;
		}
	}
	return a ? 3 : 4;
}
```
