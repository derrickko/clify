# clify Conventions

Rules and contracts for generated CLI repos. Rigid contracts (error format, `.clify.json` shape) must be followed exactly. Flexible guidance (command structure, nesting) should be adapted to the API.

---

## CLI Command Structure

Generated CLIs use the resource-action pattern:

```
<api>-cli <resource> <action> [flags]
```

### Standard Actions

Map HTTP methods to actions:

| HTTP Method | Action | Notes |
|-------------|--------|-------|
| GET (collection) | `list` | Returns array |
| GET (single) | `get` | Requires `--id` |
| POST (create) | `create` | |
| PUT/PATCH | `update` | Requires `--id` |
| DELETE | `delete` | Requires `--id` |

### Non-CRUD Actions

When an endpoint doesn't map to standard CRUD, use the API's own verb:

```
stripe-cli charges capture --id ch_xxx
github-cli repos merge-upstream --repo owner/name
twilio-cli messages send --to +1234567890 --from +0987654321
```

Don't force non-CRUD actions into CRUD semantics. If the API calls it "verify", the action is `verify`.

### Nesting Depth

Cap at two levels: `<resource> <action>` or `<resource> <sub-resource> <action>`.

Flatten anything deeper with flags:

```
# Good (2 levels):
github-cli repos pulls list --repo owner/name

# Bad (3 levels):
github-cli repos pulls comments list --repo owner/name

# Good (flattened):
github-cli pull-comments list --repo owner/name --pull 42
```

### Resource Naming

- Use the API's own terminology (kebab-case if multi-word)
- Don't rename to camelCase or PascalCase
- Hyphenated names are fine: `api-keys`, `pull-requests`

---

## Global Flags

Every command supports these flags. They are parsed before resource routing.

| Flag | Type | Default | Behavior |
|------|------|---------|----------|
| `--json` | boolean | true when piped | Structured JSON output |
| `--dry-run` | boolean | false | Show request without executing |
| `--help`, `-h` | boolean | false | Show usage |
| `--version`, `-v` | boolean | false | Print version |
| `--verbose` | boolean | false | Include request/response headers |
| `--all` | boolean | false | Auto-paginate (fetch all pages) |

### Global Flag Parsing

Global flags must be separated from per-command flags before parsing. Use a known-set filter — do NOT use `parseArgs` with `strict: false` for global parsing, as it consumes unknown flags as booleans and breaks per-command string flags.

```js
const GLOBAL_FLAGS = new Set(["--json", "--dry-run", "--help", "-h", "--version", "-v", "--verbose", "--all"]);
const globalArgv = [];
const remainingArgv = [];
for (const arg of process.argv.slice(2)) {
  if (GLOBAL_FLAGS.has(arg)) globalArgv.push(arg);
  else remainingArgv.push(arg);
}
```

---

## Per-Command Flags

Generated from the API's documented parameters:

| Parameter Type | Flag Style |
|---------------|------------|
| Path params | `--id`, `--repo` (required) |
| Query params | Optional flags |
| Body fields | Individual flags |
| Raw JSON body | `--body` escape hatch |

### Special Flags

| Flag | When | Behavior |
|------|------|----------|
| `--all` | List endpoints with pagination | Auto-paginate |
| `--file <path>` | Upload endpoints | Read file, use FormData |
| `--output <path>` | Binary response endpoints | Write response to file |
| `--body <json>` | Any mutating endpoint | Raw JSON body (overrides individual flags) |

### Pagination

Return one page by default. Include `next_cursor` in JSON output when more pages exist. `--all` fetches every page and returns the combined result.

---

## Structured Error Output

When `--json` is active (or stdout is piped), errors emit:

```json
{
  "type": "error",
  "code": "rate_limited",
  "message": "Rate limited. Retry after 30s.",
  "retryable": true,
  "retryAfter": 30
}
```

### Error Taxonomy

| Code | Retryable | HTTP Status | Meaning |
|------|-----------|-------------|---------|
| `auth_missing` | no | — | No API key in `.env` |
| `auth_invalid` | no | 401 | Key rejected |
| `validation_error` | no | 400, 422 | Bad request |
| `not_found` | no | 404 | Resource doesn't exist |
| `forbidden` | no | 403 | Insufficient permissions |
| `conflict` | no | 409 | State conflict |
| `rate_limited` | yes | 429 | Too many requests |
| `server_error` | yes | 5xx | API server error |
| `network_error` | yes | — | Connection failed/timeout |
| `timeout` | yes | — | Request exceeded timeout |

### Rules

- `retryAfter` is optional on ALL retryable errors (not just `rate_limited`)
- Parse `Retry-After` header when present on any retryable error
- CLI never retries — retry logic lives in the SKILL.md wrapper (agent decides)
- Human-readable format uses `console.error` (stderr), not stdout
- Exit code is always 1 for errors

---

## `.clify.json` Shape

Every generated repo has this at the root:

```json
{
  "apiName": "github",
  "docsUrl": "https://docs.github.com/en/rest",
  "crawledUrls": ["https://docs.github.com/en/rest/repos", "..."],
  "contentHash": "sha256:abc123...",
  "generatedAt": "2026-04-06T12:00:00Z",
  "clifyVersion": "0.1.0",
  "nodeMinVersion": "20"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `apiName` | string | Lowercase, kebab-case API name |
| `docsUrl` | string | Original URL provided by user |
| `crawledUrls` | string[] | All URLs fetched during generation |
| `contentHash` | string | `sha256:<hex>` of combined fetched content |
| `generatedAt` | string | ISO 8601 timestamp |
| `clifyVersion` | string | Version of clify that generated this |
| `nodeMinVersion` | string | Minimum Node.js version |

### Sync Behavior

**Preserved across sync:** `.clify.json`, `knowledge/`, `.env`
**Regenerated on sync:** everything else

---

## .env Rules

- Generated CLI reads `.env` from the REPO ROOT only (not CWD, not `$HOME`)
- Use `node:fs` to read — no dotenv library
- Don't override existing env vars (shell takes precedence)
- Strip quotes from values
- Skip blank lines and `#` comments
- `.env.example` documents required keys with placeholder values
- `.env` is gitignored
- Auth env var name: `<API_NAME>_API_KEY` (uppercase, underscores)

---

## Setup Convention

Setup lives in the generated SKILL.md — no CLI binary changes. The LLM follows API-specific instructions to collect credentials, validate auth, and detect defaults before executing any command. See `skill-skeleton.md` for the full template.

### `.env.example` Annotations

Structured `@tag` comments above each env var. The CLI's `.env` loader already skips `#` comments, so annotations are invisible to the CLI.

| Tag | Meaning | Example |
|-----|---------|---------|
| `@required` | Setup must collect this | `# @required` |
| `@optional` | Improves UX but not strictly needed | `# @optional` |
| `@how-to-get <url-or-instruction>` | Where to obtain the value | `# @how-to-get https://dashboard.example.com/api-keys` |
| `@format <pattern>` | Expected format | `# @format act_XXXXXXXXX` |
| `@validation-command <resource> <action>` | CLI command to validate this credential | `# @validation-command users me` |
| `@detect-command <resource> <action>` | CLI command that lists possible values | `# @detect-command workspaces list` |

Example:

```env
# @required
# @how-to-get https://dashboard.example.com/api-keys
# @validation-command users me
EXAMPLE_API_KEY=your_api_key_here

# @optional
# @format ws_XXXXXXXXX
# @detect-command workspaces list
EXAMPLE_WORKSPACE_ID=ws_your_workspace_id_here
```

### `.clify.json` Setup Fields

Add `auth` and `defaults` to the existing schema:

```json
{
  "auth": {
    "envVar": "EXAMPLE_API_KEY",
    "scheme": "bearer",
    "validationCommand": "users me"
  },
  "defaults": [
    {
      "envVar": "EXAMPLE_WORKSPACE_ID",
      "detectCommand": "workspaces list",
      "description": "Default workspace ID",
      "format": "ws_XXXXXXXXX"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `auth.envVar` | string | Env var name for the primary credential |
| `auth.scheme` | string | Auth scheme: `bearer`, `api-key-header`, `basic` |
| `auth.validationCommand` | string | Simplest read-only command that exercises auth |
| `defaults` | array | Pervasive parameters the user should configure once |
| `defaults[].envVar` | string | Env var name for this default |
| `defaults[].detectCommand` | string | Command that lists possible values |
| `defaults[].description` | string | Human-readable description |
| `defaults[].format` | string | Expected format pattern |

`auth` is required. `defaults` is optional (empty array for auth-only APIs).

### Placeholder Detection

During setup readiness check, these values mean "not set":
- Matches `your_*_here` or `*_your_*_here` (case-insensitive)
- Empty string
- The exact value from `.env.example` (e.g., `ws_your_workspace_id_here`)

---

## Knowledge File Schema

Knowledge files live in `knowledge/` in the generated repo:

```yaml
---
type: gotcha | pattern | shortcut | quirk
command: "repos list"
learned: 2026-04-06
confidence: high | medium | low
---

Upload endpoint returns 422 if Content-Type header is missing.
Always include `--content-type application/octet-stream` for binary uploads.
```

### Types

| Type | Meaning | Example |
|------|---------|---------|
| `gotcha` | Error → recovery pair | "422 on upload → add Content-Type header" |
| `pattern` | Common flag combo | "`--from noreply@co.com --reply-to support@co.com`" |
| `shortcut` | Multi-step workflow promoted to compound command | "send-welcome = create contact + send email" |
| `quirk` | API contradicts docs | "Pagination uses `page` not `cursor` despite docs" |

### Rules

- SKILL.md reads all knowledge files and lets the LLM match by context
- No indexing — simple file scan (scale: tens to low hundreds per API)
- Promotion from pattern → shortcut is agent judgment, no fixed threshold
- After sync, review knowledge files for staleness (endpoint removed, behavior changed)

---

## CLI Source Conventions

### Language & Runtime

- Node.js ESM (`.mjs` extensions)
- `"type": "module"` in package.json
- `"engines": { "node": ">=20" }`
- Zero external npm dependencies
- Native `fetch` (Node 20+), `node:util` `parseArgs`, `node:fs`, `node:path`, `node:crypto`

### Code Structure

```
bin/<api>-cli.mjs        ← single file CLI, all resources
test/smoke.test.mjs      ← smoke tests
```

- Named exports where useful, but the CLI is a single executable file
- Resource handlers are plain objects (not classes)
- One `apiRequest()` function handles auth, dry-run, verbose, error mapping
- Version read from package.json (single source of truth)

### CLI Skeleton

See `cli-skeleton.mjs` for the full annotated pattern. Adapt to the target API — lines marked `<-- adapt` must change per API. The section ordering and function signatures are the contract.

### Help Text

Three levels of help, all generated from the resource registry and `_flags` — stays in sync automatically:

- `--help` — list all resources and their actions
- `<resource> --help` — list actions for that resource
- `<resource> <action> --help` — show per-action flags with required/optional and descriptions

This enables runtime discovery: an agent can call `<cli> <resource> <action> --help` to learn flags without reading the SKILL.md.

---

## Smoke Test Requirements

Smoke tests verify CLI structure, NOT API responses. They must pass with no `.env` present (no API key required).

### Required Tests

| Test | What it verifies |
|------|-----------------|
| `--version` | Prints version from package.json |
| `--help` | Shows usage with all resources listed |
| `<resource> --help` | Shows actions for each resource |
| `<resource> <action> --help` | Shows per-action flags with descriptions |
| Auth missing | Returns `auth_missing` error (not a crash) |
| `--dry-run` | Doesn't make real requests |
| Unknown resource | Returns `validation_error` with helpful message |
| Unknown action | Returns `validation_error` with available actions |
| Required flag missing | Returns `validation_error` (not crash) |
| No hardcoded secrets | Regex scan of source for API key patterns |
| Resource coverage | Every resource and action is reachable |

### Test Conventions

- Use `node:test` (`node --test test/*.test.mjs`)
- Helper: `run(...args)` → `{ stdout, stderr, exitCode }`
- Helper: `runJson(...args)` → adds `--json`, parses output
- Strip API key from env in test helper (prevent accidental real requests)
- Timeout: 5s per test (these are fast — no network calls)

### Smoke Test Skeleton

See `smoke-test-skeleton.mjs` for the full annotated pattern. Adapt resource names, actions, and required flags to the target API.

---

## Generated Repo Structure

```
<api-name>-cli/
    ├── bin/<api-name>-cli.mjs      ← CLI executable
    ├── skills/<api>/SKILL.md       ← Claude Code skill (API wrapper)
    ├── skills/sync/SKILL.md        ← self-update skill
    ├── knowledge/                  ← learned patterns (empty initially)
    ├── .claude-plugin/
    │   ├── plugin.json
    │   └── marketplace.json
    ├── .docs-snapshot/             ← raw fetched docs (gitignored)
    ├── AGENTS.md                   ← Codex/OpenAI instructions
    ├── .clify.json                 ← metadata
    ├── package.json                ← npm metadata + bin field
    ├── .env.example                ← API key template
    ├── .gitignore
    ├── test/smoke.test.mjs         ← smoke tests
    ├── LICENSE                     ← MIT
    └── README.md
```

---

## package.json for Generated Repos

```json
{
  "name": "<api-name>-cli",
  "version": "0.1.0",
  "description": "CLI for the <API Name> API. Generated by clify.",
  "type": "module",
  "bin": {
    "<api-name>-cli": "./bin/<api-name>-cli.mjs"
  },
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "test": "node --test test/*.test.mjs"
  },
  "license": "MIT"
}
```

No dependencies. No devDependencies.

---

## Plugin Files (`.claude-plugin/`)

Two files: `plugin.json` (runtime manifest) and `marketplace.json` (discovery manifest).

### Source of Truth

`package.json` is authoritative for `name`, `version`, `description`, and `engines`. Both plugin files must match `name`, `version`, and `description` exactly. Engine requirements live exclusively in `package.json` (npm standard) — plugin.json does not duplicate them. On a version bump, update all three files.

### plugin.json

Runtime manifest read by the plugin system. The plugin system reads `engines` from `package.json` — do not duplicate it here.

```json
{
  "name": "<api-name>-cli",
  "version": "0.1.0",
  "description": "CLI for the <API Name> API. Generated by clify.",
  "author": { "name": "<user>" },
  "license": "MIT",
  "skills": [
    { "name": "<api-name>", "source": "skills/<api-name>/SKILL.md" },
    { "name": "sync", "source": "skills/sync/SKILL.md" }
  ],
  "capabilities": ["network"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Must match `package.json` name |
| `version` | yes | Must match `package.json` version |
| `description` | yes | Must match `package.json` description |
| `author` | yes | `{ "name": "<user>" }`, optionally with `"url"` |
| `license` | yes | License identifier |
| `skills` | yes | Array of `{ "name", "source" }` — every SKILL.md the plugin provides |
| `capabilities` | yes | What the plugin does: `"network"`, `"codegen"`, `"file-write"` |

### marketplace.json

Flat discovery manifest for registries. One plugin per repo — no nested arrays.

```json
{
  "name": "<api-name>-cli",
  "description": "CLI for the <API Name> API. Generated by clify.",
  "version": "0.1.0",
  "author": { "name": "<user>" },
  "source": "./"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Must match `plugin.json` name |
| `description` | yes | Must match `plugin.json` description |
| `version` | yes | Must match `plugin.json` version |
| `author` | yes | Must match `plugin.json` author |
| `source` | yes | Relative path to plugin root |

### Validation (Step 7)

During generation, verify:
- All required fields are present in both files
- `name`, `version`, `description` match across `package.json`, `plugin.json`, `marketplace.json`
- Every `skills[].source` path resolves to an existing SKILL.md
