# pharaoh-parser

Open-source AST parser used by [Pharaoh](https://pharaoh.so) to extract structural metadata from TypeScript, Vue and Python codebases.

**This is the exact code that runs in production.** The main Pharaoh repository consumes this package as a dependency. You can audit every line to verify what Pharaoh extracts from your code.

## What it extracts

| Extracted | Example |
|-----------|---------|
| Function names | `authenticateUser` |
| Function signatures | `async function authenticateUser(email: string, password: string): Promise<User>` |
| Line numbers | `lineStart: 15, lineEnd: 48` |
| Complexity scores | `complexity: 7` (cyclomatic) |
| Export status | `isExported: true` |
| Import statements | `{ source: "./db", symbols: ["findUser"] }` |
| Class names and methods | `{ name: "UserService", methods: ["create", "delete"] }` |
| Body hashes | `a3f8c2e1b9d04567` (one-way SHA-256 for dedup detection) |
| Module boundaries | `{ name: "auth", files: ["src/auth/login.ts", ...] }` |
| JSDoc/docstring summaries | First line, truncated to 200 chars |
| Top-level constant values | `MAX_RETRIES = 3`, `API_BASE = "https://api.example.com"` (strings and numbers up to 128 characters) |
| Decorators | `@Get("/users")`, `@app.route("/api")` |
| Vue template references | `{ name: "save", kind: "event", line: 4 }` for `@click="save"` (names and lines only). Templates the parser can't read (Pug, `src`) are reported as unverified candidates, never as references |

## What it does NOT extract

- **Source code** — function bodies are never captured
- **String literals inside functions** — only top-level constant values are captured (see above), and Pharaoh encrypts them per customer
- **Comments** — only JSDoc/docstring first-line summaries (see note below)
- **Environment variables** — `.env` values are never read
- **File contents** — only structural metadata is extracted
- **Vue template text** — only the names a template uses from its script (`save`, `UserCard`) and their line numbers

> **Note on JSDoc/docstrings:** The parser extracts the first line of JSDoc comments and Python docstrings (truncated to 200 characters) as function documentation. If your documentation contains sensitive information, the parser output will include it. This mirrors what any code review tool or IDE would show.

## Quick start

```bash
git clone https://github.com/Pharaoh-so/pharaoh-parser.git
cd pharaoh-parser
npm install
node bin/inspect.js /path/to/your/repo
```

Output: JSON to stdout showing all structural metadata for every TypeScript, Vue and Python file in the repository.

### Save to file

```bash
node bin/inspect.js /path/to/your/repo --output result.json
```

### Example output

```json
{
  "metadata": {
    "parserVersion": "1.0.0",
    "repoPath": "/home/user/my-project",
    "repoName": "my-project",
    "fileCount": 47,
    "parseFailures": 0,
    "timestamp": "2026-03-05T12:00:00.000Z"
  },
  "files": [
    {
      "path": "src/auth/login.ts",
      "language": "typescript",
      "loc": 142,
      "functions": [
        {
          "name": "authenticateUser",
          "signature": "async function authenticateUser(email: string, password: string): Promise<User>",
          "lineStart": 15,
          "lineEnd": 48,
          "loc": 34,
          "complexity": 7,
          "isExported": true,
          "isAsync": true,
          "bodyHash": "a3f8c2e1b9d04567",
          "paramCount": 2
        }
      ],
      "imports": [
        { "source": "./db", "symbols": ["findUser"], "isDefault": false, "isNamespace": false, "line": 1 }
      ],
      "exports": [
        { "name": "authenticateUser", "kind": "function", "isDefault": false }
      ],
      "classes": []
    }
  ]
}
```

## How this connects to Pharaoh

This parser is step 1 of Pharaoh's pipeline, and the extraction you can run yourself. Pharaoh's hosted pipeline reads the same temporary clone to add more: which function calls which, HTTP routes, cron schedules, database tables, event handlers, environment variable names (never their values), and each file's last-modified date and how often it changed in the last 90 days. It deletes the clone when the run ends. Function signatures, doc comments, API routes and constant values are encrypted per customer before they're stored.

What Pharaoh adds on top:

- **MCP tools** that answer architectural questions from the graph
- **Neo4j knowledge graph** with cross-file dependency resolution
- **Auto-remapping** on every git push via GitHub App webhooks
- **Multi-tenant infrastructure** with tenant isolation

The parser extracts the raw data. Pharaoh turns it into architectural intelligence.

Learn more at [pharaoh.so](https://pharaoh.so).

## Supported languages

- **TypeScript** (.ts, .tsx) via [tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript)
- **Vue** single-file components (.vue): blocks and template via [@vue/compiler-sfc](https://github.com/vuejs/core/tree/main/packages/compiler-sfc), `<script>` and `<script setup>` via tree-sitter-typescript at their line numbers in the .vue file. Composition API and Options API.
- **Python** (.py) via [tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python)

### C and C++ (experimental)

`pharaoh-parser/cpp` reads `.c`, `.h`, `.cc`, `.cpp`, `.cxx`, `.hh`, `.hpp`, `.hxx`, `.ipp` and `.inl` files with [tree-sitter-c](https://github.com/tree-sitter/tree-sitter-c) and [tree-sitter-cpp](https://github.com/tree-sitter/tree-sitter-cpp), finding definitions with each grammar's own `tags.scm` query. Pharaoh's hosted mapping does not use it yet, and `walkFiles` lists these files only when called with `{ cpp: true }`.

It extracts function and method definitions (including `A::f` defined outside its class, overloads, constructors, destructors and operators), classes, structs and unions with their bases and method names, `#include` lines, a header's prototypes as its exports, and short object-like macros as constants. It does not extract calls.

Nothing is preprocessed. A file is first read as written, both branches of every `#if` included. When that leaves a syntax error, usually an attribute macro such as `GUARDED_BY(mu)` or an `#if` whose branches each hold half a statement, the file is read again through rewrites borrowed from Doxygen's preprocessor:

- blank attribute-like macros: a known list, the repo's own attribute-only `#define`s (`collectAttributeMacros`), and upper-case macros where an attribute can sit but a value can't;
- blank an upper-case macro alone on its line;
- read one branch of each conditional.

Each rewrite keeps every line and column and is kept only if less of the file is then in error, within a per-file budget of text reparsed (`RECOVERY_BYTES`, 1 MB). What that read finds is marked `recovered: true`: it rests on guesses about what macros expand to, so calls read from it are candidates, never exact, and some can be missing. For such a file `onTree` receives the rewritten tree, which has no directives and none of the blanked branches' code, and whose `hasError` can be false: check `recovered || hasError`. `rewrittenLines` lists the lines the rewrite changed; every other line holds the text as written, though how it is read can still depend on rewritten lines around it.

Files with at least one syntax error after recovery, on four public repositories (before recovery in brackets): curl 4.1% (27%), leveldb 6.8% (25%), redis 12.1% (47%, mostly vendored code under `deps/`), fmt 37.8% (53%).

## Dependencies

| Package | Purpose |
|---------|---------|
| `web-tree-sitter` | WASM-based parser runtime |
| `tree-sitter-typescript` | TypeScript/TSX grammar |
| `tree-sitter-python` | Python grammar |
| `tree-sitter-c`, `tree-sitter-cpp` | C and C++ grammars (loaded only by `pharaoh-parser/cpp`) |
| `@vue/compiler-sfc` | Vue's own .vue parser: script blocks and the template AST (loaded only when a repo has .vue files) |
| `ignore` | .gitignore pattern matching |

Five dependencies. No network calls. No telemetry. Pure local computation.

## Running tests

```bash
npm install
npm test
```

## License

MIT
