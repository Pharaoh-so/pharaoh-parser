# pharaoh-parser

Open-source AST parser used by [Pharaoh](https://pharaoh.so) to extract structural metadata from TypeScript and Python codebases.

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

## What it does NOT extract

- **Source code** — function bodies are never captured
- **String literals** — API keys, URLs, config values are invisible
- **Comments** — only JSDoc/docstring first-line summaries (see note below)
- **Environment variables** — `.env` values are never read
- **Secrets** — tokens, passwords, credentials are not accessible to the parser
- **File contents** — only structural metadata is extracted

> **Note on JSDoc/docstrings:** The parser extracts the first line of JSDoc comments and Python docstrings (truncated to 200 characters) as function documentation. If your documentation contains sensitive information, the parser output will include it. This mirrors what any code review tool or IDE would show.

## Quick start

```bash
git clone https://github.com/Pharaoh-so/pharaoh-parser.git
cd pharaoh-parser
npm install
node bin/inspect.js /path/to/your/repo
```

Output: JSON to stdout showing all structural metadata for every TypeScript and Python file in the repository.

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

This parser is step 1 of Pharaoh's pipeline. The output you see here is exactly what Pharaoh ingests to build its knowledge graph. The value Pharaoh adds is everything downstream:

- **16 MCP tools** that answer architectural questions from the graph
- **Neo4j knowledge graph** with cross-file dependency resolution
- **Auto-remapping** on every git push via GitHub App webhooks
- **Multi-tenant infrastructure** with tenant isolation

The parser extracts the raw data. Pharaoh turns it into architectural intelligence.

Learn more at [pharaoh.so](https://pharaoh.so).

## Supported languages

- **TypeScript** (.ts, .tsx) via [tree-sitter-typescript](https://github.com/tree-sitter/tree-sitter-typescript)
- **Python** (.py) via [tree-sitter-python](https://github.com/tree-sitter/tree-sitter-python)

## Dependencies

| Package | Purpose |
|---------|---------|
| `web-tree-sitter` | WASM-based parser runtime |
| `tree-sitter-typescript` | TypeScript/TSX grammar |
| `tree-sitter-python` | Python grammar |
| `ignore` | .gitignore pattern matching |

Four dependencies. No network calls. No telemetry. Pure local computation.

## Running tests

```bash
npm install
npm test
```

## License

MIT
