# Vue single-file components (.vue) — Implementation Plan

**Date:** 2026-10-22
**Mode:** BIG CHANGE. Dan pre-approved the recommended option for every issue; each choice is recorded below and in the PR.

## Problem

`walkFiles` lists only TS/JS/Python extensions, so Pharaoh skips every `.vue` file and its maps miss whole components. Production data shows Vue in about 12 repos across a few accounts.

Script parsing alone is not enough. A method or component used only from the template has no caller in the script, so Pharaoh would label live Vue code unused or Dead, which is worse than skipping Vue. Template references ship in the same change.

## What the consumer does today (read from Pharaoh, not changed here)

- Pharaoh walks with this package's `walkFiles` and sends every non-`.py` file to `pharaoh-parser/tree-sitter` `parseFile` (`src/resolver/pipeline.ts:272,438`).
- Large repos read call sites from the tree `parseFile` lends through `onTree`. A caller is found by row: `fnNodeAtRow.get(fn.lineStart - 1)` must be a function-like node (`call-chain-tracer.ts:638,2691,1194`). Rows outside named functions go to `path:$module_init`.
- Small repos re-read each file from disk and parse it with their own grammar (`call-chain-tracer.ts:422-453`).
- A callee resolves through `importSymbolMap`, then `fileFunctionNames(target)`, which holds function **and class** names. So `import Foo from './Foo.vue'` resolves only if `Foo.vue` has a function or class named `Foo`.
- JSX `<Foo/>` is recorded as a call to `Foo`; `<Foo.Bar/>` as receiver `Foo`, method `Bar`. `this.x()` resolves to a method of the caller's class.
- Reachability seeds the `$module_init` of every file a reached file imports.

## Decisions

### Section 1 — Architecture

**Issue 1. Where `.vue` dispatch lives.**
- A (chosen): inside `tree-sitter.ts` `parseFile`. Pharaoh already sends every non-Python file there, so its pipeline needs no dispatch change.
- B: a separate `parseVueFile` export, plus a consumer dispatch change.
- C: a new `./vue` subpath export.

**Issue 2. Mapping script lines back to the `.vue` file.**
- A (chosen): a position-preserving mask. Every character outside the `<script>` blocks becomes a space and line breaks stay. The masked text has the file's length and rows, so the existing TS extraction returns `.vue` line numbers with no mapping step. The tree lent through `onTree` also has `.vue` rows, which the consumer's row-based caller lookup requires.
- B: parse each block alone and offset every line (a source map). This adds a mapping step to every field and gives `onTree` a tree whose rows are wrong.
- C: `compileScript` output. It rewrites the code, so lines move.

**Issue 3. Shape of template references.**
- A (chosen): a new optional `ParsedFile.templateRefs: ParsedTemplateRef[]` of `{ name, kind, line, receiver?, className? }`. It mirrors the tracer's call sites: `name` is the callee, `receiver` matches JSX `<Foo.Bar/>`, and `className` matches `ParsedFunction.className`. Template rows sit outside every function, so the consumer's existing row rule attributes them to the file's `$module_init`, which is reachable once a reached file imports the `.vue` file.
- B: write template expressions into the masked tree as code (the Volar approach), so the tracer sees calls unchanged. Expressions are not statements (`{ a: b }`, `item in items`), and fitting code into the original columns is fragile.
- C: a synthetic `render` function per SFC. It invents a function with no tree node, so the consumer's row lookup can't attribute anything to it.

**Issue 4. Component identity.**
- A (chosen): one `ParsedClass` per SFC, named after the file in PascalCase (`user-card.vue` → `UserCard`), plus a default export `{ kind: "class", isDefault: true }`. A parent's `import UserCard from './UserCard.vue'` and `<UserCard/>` then resolve the way a JSX class component does. Options API members become its methods (`className`), so `this.save()` resolves through the consumer's existing same-class rule. A default-exported class (`vue-class-component`) is the component itself.
- B: a synthetic function per component. It looks like a function the source doesn't have, and when nothing references it, it reads as unused.
- C: no component node. `<UserCard/>` edges would then have no target.

**Issue 5. Options API members the Vue runtime calls (lifecycle hooks, `watch`, `data`, `setup`, `render`).**
- A (chosen): emit them as methods of the component class, plus a `templateRefs` entry of kind `"runtime"`. They then read as used, and `this.persist()` inside `mounted` gets a caller with a class.
- B: don't emit them. Their `this.x()` calls lose class context, so a method called only from `mounted` reads as unused.
- C: emit them without refs. Every `mounted` would then read as unused.

**Issue 6. The block-extraction dependency.**
- A (chosen): `@vue/compiler-sfc`. Its `parse()` is what Vue's own tooling uses. It already parses every template expression with Babel (`exp.ast`), splits `v-for` (`forParseResult`), and ships `walkIdentifiers`, which tracks arrow-function and destructuring scopes. It is loaded lazily, on the first `.vue` file, so non-Vue repos pay nothing for it.
- B: `@vue/compiler-dom` alone. It's lighter (21ms to load vs 65ms), but we would re-implement block splitting, `src` handling and duplicate-block rules.
- C: regex. The brief rules this out.

### Section 2 — Code quality

**Issue 7. Sharing TS extraction.**
- A (chosen): split `parseFile` into file reading plus `parseScript(source, path, ext, onTree, extend)`, used by both the TS and Vue paths. `extractFieldFunction` generalizes to take a name, so Options API pairs (`save: function () {}`) reuse it.
- B: copy the extraction into a Vue module.

**Issue 8. A default-export source leak.**
`export default { ... }` records the whole object literal as the export's `name`, method bodies included. This is existing behaviour in TS files, and every Options API component would hit it.
- A (chosen): the Vue path replaces that export with the component's class export. The TS-path fix is a separate follow-up (Vue only in this change).
- B: fix it for all TS files now. It is out of scope and changes TS output.

**Issue 9. Error handling.**
- A (chosen):
  - `parse()` is error-tolerant, so its descriptor is used even when it reports errors.
  - An expression Babel couldn't parse (`exp.ast === false`) yields no references.
  - Thrown errors propagate, and callers already count them as parse failures.
  - Nothing is silently caught.
- B: wrap the whole file in a try/catch and return an empty ParsedFile. That hides failures.

**Issue 10. Edge cases handled.**
- No `<script>`; `<script src>` (recorded as a side-effect import); TS, TSX, JS and JSX `lang`.
- Kebab-case tags; `<Foo.Bar>`; `<component :is>`; a component referencing itself by file name; custom directives (`v-focus` → `vFocus`).
- Type-only imports (not exposed to templates); `v-for` and `v-slot` destructuring; inline arrow parameters; `$event`.
- Props destructured from `defineProps` and the results of compiler macros (`defineProps`/`defineEmits`/`defineModel`/`defineSlots`/`withDefaults`), which are never references.
- Options API registries (`components`, `directives`) and `watch: { x: 'methodName' }`.
- Not handled (listed in the PR): non-HTML templates (Pug), `mixins`, and `setup()` return objects.

### Section 3 — Wiring

**Issue 11. Every export has a caller.**
- `.vue` joins `SOURCE_EXTENSIONS`.
- `parseFile` dispatches `.vue` files, which reaches `bin/inspect.js` and Pharaoh.
- `toScriptSource(path, source)` is new. It is what Pharaoh's small-repo tracer should parse in place of the raw file, and `parseFile` itself uses it.
- `ParsedTemplateRef` is exported from `./types` and the package root.

### Section 4 — Tests (written first)

Fixtures in `tests/fixtures/vue/src`, with hardcoded lines in every assertion:
- `<script>` and `<script setup>` together (TS); JS `<script setup>`; Options API in JS and in TS (`defineComponent`); a file with no script.
- A component used only in the template (PascalCase and kebab-case); a method used only from an event handler, in both APIs; an inline handler call; a `v-for` source calling a function; macros not recorded as imports or references.
- Negatives: a `v-for` variable that shadows a script function, destructured props, and `defineProps` / Options `props` names.
- Line mapping: functions, imports, constants and refs carry `.vue` lines, and the tree lent through `onTree` has `.vue` rows.
- `walkFiles` lists `.vue` files; `toScriptSource`; and the compiler's parse cache is left empty.

### Section 5 — Performance

- `@vue/compiler-sfc` loads lazily (65ms, once per process, only when a `.vue` file appears).
- `sourceMap: false` (the default builds a source map per block).
- compiler-sfc keeps an LRU of 500 descriptors, template ASTs included. Each file is parsed once, so it is cleared after every parse, keeping memory flat on large Vue repos.
- One tree per file, freed in `finally` as today.

### Section 6 — Security

- Local parsing only; no new network surface.
- `templateRefs` carry identifier names and line numbers, never template text or expressions.
- The Vue path no longer records the options object's source as an export name (Issue 8).

## Consumer follow-ups (Pharaoh repo, not changed here)

Listed in the PR body.
