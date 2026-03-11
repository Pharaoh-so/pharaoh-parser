# TypeScript Decorator Tracing — Implementation Plan

**Issue:** https://github.com/Pharaoh-so/pharaoh-parser/issues/8
**Date:** 2026-03-11

## Problem

TypeScript decorators (`@Cached`, `@Controller`, `@Get()`, etc.) are not extracted by the TS parser. This causes:
- `check_reachability` false negatives for decorated functions
- `get_unused_code` flagging decorated functions as dead code
- Entry point detection missing decorator-registered handlers (NestJS `@Get()`, `@Post()`)

## Design Decisions

### AST Structure (verified via tree-sitter inspection)

- **Class decorators**: `decorator` nodes are direct children of `class_declaration` (before `class` keyword)
- **Method decorators**: `decorator` nodes are siblings of `method_definition` inside `class_body` — NOT children of the method
- **Standalone function decorators**: Cause `ERROR` nodes (TC39 spec only supports class/class-element decorators) — **skip these**

### Approach: Forward-scan accumulator (Issue 1)

In the `extractClass` body loop, accumulate `decorator` nodes into a buffer. When a `method_definition` is hit, flush the buffer as that method's decorators. This matches the Python parser's pattern.

### Type changes (Issue 2)

- Add `decorators?: string[]` to `ParsedClass` interface
- Update JSDoc on existing `ParsedFunction.decorators` to be language-agnostic

### What NOT to do

- Do NOT share `extractDecorators` between Python and TS parsers (different AST structures)
- Do NOT extract standalone function decorators (ERROR nodes, non-standard)
- Do NOT add decorator handling to the `extractFromNode` method_definition path (unreachable)
- Do NOT filter decorator arguments for secrets (match Python behavior, 500-char truncation is sufficient)

## Implementation

### 1. `src/types.ts`

Add to `ParsedClass`:
```ts
decorators?: string[];
```

Update `ParsedFunction.decorators` JSDoc from "for Python functions" to language-agnostic.

### 2. `src/tree-sitter.ts`

#### `extractClass` (line 514)

Collect class-level decorators in the existing `node.children` loop (alongside heritage extraction):
```ts
const classDecorators: string[] = [];
for (const child of node.children) {
    if (child.type === "decorator") {
        let text = child.text.trim();
        if (text.length > 500) text = `${text.slice(0, 497)}...`;
        classDecorators.push(text);
    } else if (child.type === "class_heritage") {
        // ... existing heritage extraction
    }
}
```

Add to `classes.push({...})`:
```ts
decorators: classDecorators.length > 0 ? classDecorators : undefined,
```

Modify the body loop (line 553) to accumulate method decorators:
```ts
let pendingDecorators: string[] = [];
for (const child of bodyNode.children) {
    if (child.type === "decorator") {
        let text = child.text.trim();
        if (text.length > 500) text = `${text.slice(0, 497)}...`;
        pendingDecorators.push(text);
    } else if (child.type === "method_definition") {
        const methodName = child.childForFieldName("name");
        if (methodName) {
            methods.push(methodName.text);
            extractMethod(child, source, functions, name,
                pendingDecorators.length > 0 ? pendingDecorators : undefined);
        }
        pendingDecorators = [];
    }
}
```

#### `extractMethod` (line 494)

Add optional `decorators` parameter:
```ts
function extractMethod(
    node: SyntaxNode,
    source: string,
    functions: ParsedFunction[],
    className: string,
    decorators?: string[],
): void {
```

Spread into the function push:
```ts
functions.push({
    name,
    ...buildFunctionMetadata(node, source),
    ...buildPropsMetadata(node),
    isExported: false,
    className,
    ...(decorators ? { decorators } : {}),
});
```

### 3. Test fixture: `tests/fixtures/ts-decorators/src/decorated.ts`

Cover these patterns:
1. Class decorator: `@Controller('/users')`
2. Simple call decorator: `@Get()`
3. Decorator with args: `@Cached({ ttl: 60 })`
4. Stacked decorators: `@Get()` + `@Cached({...})` on same method
5. Member-expression decorator: `@app.route('/path')`
6. Simple identifier decorator: `@Injectable` (no parens)
7. Undecorated method (proves `decorators` is undefined)
8. Undecorated class (proves class decorators undefined)
9. Exported decorated class

### 4. Tests in `tests/parser-improvements.test.ts`

Add `describe("typescript decorator extraction", ...)` block with tests matching Python decorator test quality:

- Class decorator extraction (`toEqual` with hardcoded values)
- Method decorator extraction (single, with args, stacked)
- Member-expression decorator
- Simple identifier decorator
- Decorator ordering (stacked — source order preserved)
- Undecorated method/class (decorators is `undefined`)
- Exported decorated class

All assertions use `toEqual` with hardcoded expected values. No `.toBeDefined()` alone, no `.toContain()` when order matters.

## Truncation

Match Python's 500-char limit on decorator text. Use inline `500`/`497` — don't extract a shared constant.

## Verification

- `pnpm test` — all existing + new tests pass
- `pnpm run quality` (if available) — clean
- Run `bin/inspect.js` on the fixture directory to visually confirm decorator output
