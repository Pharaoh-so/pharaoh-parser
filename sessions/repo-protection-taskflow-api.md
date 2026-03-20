# Session: Set Up Branch Protection & CI for taskflow-api

## Context

`Pharaoh-so/taskflow-api` is an open source AI framework repo that currently has:
- **No CI pipeline** (no `.github/workflows/` directory)
- **No branch protection** on `main`
- **No biome.json** config (but `biome` is a dev dependency with `npm run lint` → `biome check src/`)
- Available scripts: `build` (tsc), `test` (vitest run), `lint` (biome check src/)
- Only collaborator with write access: `0xUXDesign` (admin)
- `pharaoh-reviewer` has read access (for PR Guard)

This mirrors the state pharaoh-parser was in before we hardened it. Follow the same playbook.

## Objective

Lock down `taskflow-api` so all changes go through PRs with passing CI, only the owner can merge, and PR Guard reviews every PR architecturally.

## Steps

### 1. Create CI workflow (`.github/workflows/ci.yml`)

Create a CI pipeline matching the pharaoh-parser pattern:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run build
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm install
      - run: npm test
```

**Important:** Push this to `main` via the GitHub Contents API BEFORE setting up branch protection:
```bash
CI_CONTENT=$(base64 < .github/workflows/ci.yml)
gh api repos/Pharaoh-so/taskflow-api/contents/.github/workflows/ci.yml -X PUT \
  -f message="ci: add CI pipeline with quality and test jobs" \
  -f content="$CI_CONTENT" \
  -f branch="main" \
  --jq '.commit.sha'
```

### 2. Fix lint issues (if any)

Run `npm run lint` locally against main. If biome reports errors:
- If all errors are in test files (`noNonNullAssertion`), add a `biome.json` with overrides:
  ```json
  {
    "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
    "linter": { "enabled": true, "rules": { "recommended": true } },
    "overrides": [{ "include": ["tests/**"], "linter": { "rules": { "style": { "noNonNullAssertion": "off" } } } }]
  }
  ```
- If formatting errors exist, run `npx biome check src/ tests/ --fix` and push the formatted code.
- Push all fixes to `main` via the Contents API before enabling protection.
- **Verify CI passes** before proceeding: `gh api repos/Pharaoh-so/taskflow-api/actions/runs --jq '.workflow_runs[0] | "\(.status) | \(.conclusion)"'`

### 3. Set branch protection on `main`

Use the GitHub API directly (Rube's `GITHUB_UPDATE_BRANCH_PROTECTION` has schema issues with combined `contexts`/`checks`):

```bash
gh api repos/Pharaoh-so/taskflow-api/branches/main/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["quality", "test (18)", "test (20)", "test (22)"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": {
    "users": ["0xUXDesign"],
    "teams": [],
    "apps": []
  },
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

Key settings:
- **0 approvals required** — solo maintainer can't approve own PRs; CI is the gatekeeper
- **`enforce_admins: true`** — even the owner must go through PRs
- **`restrictions.users: ["0xUXDesign"]`** — only the owner can merge
- **`strict: true`** — branch must be up-to-date before merge

### 4. Enable PR Guard via Pharaoh

```
pharaoh_account(enable_pr_guard: ["Pharaoh-so/taskflow-api"])
```

PR Guard is already active on this repo per the current account status. Verify with:
```
pharaoh_account()
```

If it's listed under "PR Guard enabled", skip this step.

### 5. Verify everything works

1. **Check protection is active:**
   ```bash
   gh api repos/Pharaoh-so/taskflow-api/branches/main/protection --jq '{
     PR_Required: (.required_pull_request_reviews != null),
     Required_Checks: .required_status_checks.contexts,
     Enforce_Admins: .enforce_admins.enabled,
     Push_Restricted_To: [.restrictions.users[].login],
     Force_Push_Blocked: (.allow_force_pushes.enabled | not)
   }'
   ```

2. **Verify CI is green on main:**
   ```bash
   gh api repos/Pharaoh-so/taskflow-api/actions/runs --jq '.workflow_runs[0] | "\(.status) | \(.conclusion)"'
   ```

3. **Test the protection** (optional): try `git push origin main` from a local branch — it should be rejected.

## Gotchas from pharaoh-parser setup

- **Rube's `GITHUB_UPDATE_BRANCH_PROTECTION`** fails with 422 when both `contexts` and `checks` are sent. Use `gh api` directly with just `contexts`.
- **Push CI and fixes to main BEFORE enabling branch protection.** Once `enforce_admins: true` is set, you can't push directly — you'd have to temporarily disable it.
- **If you need to push after protection is enabled:** temporarily set `enforce_admins: false`, push, then immediately set it back to `true`.
- **`biome check` includes formatting**, not just lint rules. If `npm run lint` runs `biome check`, formatting violations will also fail CI.
- **CI status check names for matrix jobs** follow the pattern `test (18)`, `test (20)`, `test (22)` — include the spaces and parens exactly.

## Done when

- [ ] CI workflow exists and passes on `main`
- [ ] Branch protection requires PRs + CI checks + restricts push to owner
- [ ] `enforce_admins` is `true`
- [ ] PR Guard is enabled via Pharaoh
- [ ] Force pushes and branch deletion are blocked
