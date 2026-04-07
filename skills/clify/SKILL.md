---
name: clify
description: Generate a self-updating CLI repo from an API documentation URL. Use when the user says "/clify <url>", "generate a CLI for this API", or wants to create agent-friendly API wrappers.
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - WebFetch
  - WebSearch
  - Edit
  - AskUserQuestion
  - Agent
---

# clify — Generate CLI Repos from API Docs

Generate a complete, self-updating CLI repo from an API documentation URL. The output is installable as a Claude Code plugin, Codex agent, or standalone Node.js CLI.

## Triggers

Use when the user:
- Says `/clify <url>`
- Asks to "generate a CLI for this API"
- Wants to create an agent-friendly API wrapper
- Provides an API documentation URL and asks for a CLI

## Prerequisites

- Node.js >= 20 (for `fetch`, `parseArgs`)
- Internet access (to fetch API docs)

## Read References Before Generating

Before generating any code, read these files:

1. **Conventions:** `references/conventions.md` — contracts and rules for generated output
2. **CLI skeleton:** `references/cli-skeleton.mjs` — annotated code pattern for the CLI executable
3. **Test skeleton:** `references/smoke-test-skeleton.mjs` — annotated code pattern for smoke tests
4. **Skill skeleton:** `references/skill-skeleton.md` — annotated template for the generated SKILL.md (includes setup flow)

Adapt the patterns to the target API — don't copy verbatim.

## Pipeline

### Step 1: Fetch the docs

Fetch the user-provided URL:

```
WebFetch <url>
```

### Step 2: Detect format

Check if the response is a structured API spec:

- **OpenAPI/Swagger:** JSON or YAML with an `openapi` or `swagger` key → parse the spec directly. Skip crawling — structured specs are far more accurate than crawled HTML.
- **HTML/Markdown docs:** Proceed to Step 3 (crawl).

For OpenAPI specs, extract directly:
- Base URL from `servers[0].url`
- Auth scheme from `securityDefinitions` or `components.securitySchemes`
- All paths, methods, parameters, request bodies, responses
- Group endpoints by the first path segment (resource)

### Step 3: Crawl (HTML/Markdown docs only)

If the docs are HTML or Markdown (not a structured spec):

1. Read the fetched content and identify links that point to more API documentation
2. Distinguish doc links from navigation, marketing, and changelog links
3. Fetch identified doc links up to depth 2 (configurable)
4. Deduplicate by URL (normalize trailing slashes, strip query params)
5. Rate-limit: wait 1 second between fetches
6. Combine all fetched content into a single document

**Edge cases:**
- JS-rendered SPA with empty content → warn user: "This appears to be a JavaScript-rendered page. Consider providing an OpenAPI spec URL instead."
- Auth-required docs → ask user for cookies or headers, pass them on subsequent fetches
- 404/timeout on sub-pages → skip with warning, continue with available content

**Recovery:** If crawled content is minimal (<500 chars or zero endpoint signatures found), stop and ask the user via `AskUserQuestion`:
- "Crawling returned very little usable content. Do you have an OpenAPI/Swagger spec URL, or can you paste the API reference directly?"
- Do NOT proceed to Step 4 with insufficient content — parsing will fail silently.

### Step 4: Parse

From the combined doc content, extract a structured API specification:

- **API name** (from title, branding, or domain)
- **Base URL**
- **Auth scheme** (Bearer token, API key header, Basic auth, OAuth2, etc.)
- **Auth env var name** (e.g., `GITHUB_TOKEN`, `STRIPE_API_KEY`)
- **Endpoints** — for each:
  - HTTP method
  - Path (with path params identified)
  - Description
  - Parameters (path, query, body) with types and required flags
  - Response shape (if documented)
- **Resources** — group endpoints by resource (first path segment)
- **Actions** — map each endpoint to a resource-action pair following conventions

**Completeness check** — after parsing, assess the spec:

| Gap | Action |
|---|---|
| <3 endpoints found | Flag as "incomplete spec" — present what you found in Step 5 and ask user to fill gaps |
| Auth scheme missing or unclear | Ask in Step 5 — don't guess. Default to Bearer if docs show `Authorization` header examples |
| No base URL found | Infer from doc URL domain, confirm in Step 5 |
| Response shapes undocumented | Acceptable — note in generated SKILL.md as "response shape unspecified" |
| >50 endpoints detected | Flag as "large API" — in Step 5, offer to generate all or focus on a resource subset |

Do NOT silently proceed with an incomplete spec. Step 5 exists to resolve gaps with the user.

**Pervasive parameter scan:** After extracting endpoints, identify parameters that appear in >50% of non-list endpoints (excluding standard pagination: `limit`, `offset`, `cursor`, `page`, `after`, `before`). These become "default candidates" — values the user should configure once in `.env` rather than pass on every command. For each candidate, check if there's a `list` or `get` action for the matching resource (e.g., `workspaces list` for `workspace_id`) — record it as the detection command.

### Step 5: Consult and recommend

This step has two phases: **present findings with recommendations**, then **ask clarifying questions** using `AskUserQuestion`. Use your judgment — not every API needs every question. Only ask what matters for this specific API.

#### 5a: Present findings and recommendations

Present the parsed spec with opinionated recommendations. Every recommendation must include a **why**.

```
Detected API: **<API Name>**
Base URL: https://api.example.com
Auth: Bearer token via EXAMPLE_API_KEY

Resources (X endpoints):
  <resource-1>   — list, get, create, update, delete
  <resource-2>   — list, get, create, verify
  <resource-3>   — list, create, delete

CLI name: <api-name>-cli
Output: ./<api-name>-cli/
```

If pervasive parameter scan (Step 4) found default candidates, present them:

```
Setup defaults (parameters used across many endpoints):
  - `workspace_id` (used in 80% of endpoints) → ACME_WORKSPACE_ID
    Discoverable via: workspaces list
  Recommendation: include in setup flow
```

If no defaults were detected, note: "Setup: auth only (no pervasive parameters detected)."

Then present recommendations as a numbered list. Each must include a **why**:

```
Recommendations:

1. **CLI name: `<api-name>-cli`** — matches the API's brand name and
   npm naming convention.

2. **Drop `<resource>` resource** — only 1 endpoint, beta-flagged in
   docs, response shape undocumented. Can add later via sync.

3. **Map `POST /<resource>` → `<resource> <verb>`** (not `<resource>
   create`) — the API's own docs call this "<Verb> <Resource>".
   Use their verb.
```

#### 5b: Ask clarifying questions

Use `AskUserQuestion` to resolve ambiguities that would affect the generated output. Ask only what you can't confidently decide from the docs alone. Batch related questions into a single ask when possible.

**When to ask** (use judgment — skip if the answer is obvious from the docs):

| Signal from docs | Question to consider |
|---|---|
| Large API (50+ endpoints) | Which resources to include? Or generate all? Recommend chunking by resource group if >100 |
| Small API (1–3 endpoints) | Confirm this is the full API — may be a single resource with no need for resource routing |
| Multiple auth schemes (API key + OAuth) | Which auth flow to support? |
| Non-standard auth (mTLS, Digest, IP whitelist) | How to handle in CLI — may need a custom auth function |
| Ambiguous API name (docs say one thing, domain says another) | Confirm CLI name |
| Non-standard pagination (not cursor or offset) | Confirm strategy — cursor, offset/limit, page number, or keyset? |
| Deeply nested resources (3+ levels) | Confirm flattening approach |
| Sparse/missing response schemas | Acceptable, or should you infer from examples? |
| Deprecated endpoints still documented | Include or skip? |
| Rate limit warnings in docs | Seed a knowledge file for it? |
| Webhooks or streaming endpoints | Include as commands or out of scope? |
| Existing output directory | Overwrite or abort? |
| Incomplete parse (flagged from Step 4) | Present what was found, ask user to fill gaps or provide better docs |

**When NOT to ask** — don't ask about things you can confidently decide:
- Standard CRUD mapping (obvious from HTTP methods)
- kebab-case naming (convention, not a choice)
- Global flags (fixed set, not negotiable)
- File structure (convention, not a choice)

**Format:** Batch questions into a single `AskUserQuestion` call. Present your recommendation for each, so the user can just approve or override:

```
Before generating, a few questions:

1. The API has 47 endpoints across 8 resources. Generate all, or focus
   on a subset? **Recommendation: generate all** — sync can prune later,
   and the smoke tests will cover everything.

2. Docs show both API key auth and OAuth2 (for user-scoped actions).
   **Recommendation: API key only** — simpler for CLI/agent use.
   OAuth2 can be added as a knowledge file pattern later.

3. The `/v2/events` endpoints are marked "beta" with a disclaimer.
   **Recommendation: include them** but flag as beta in the SKILL.md
   help text, so agents know to expect instability.
```

Wait for the user's response before proceeding. The user can:
- Approve all recommendations
- Override specific ones
- Change the CLI name
- Add/remove resources
- Provide context the parser missed

**Conflict resolution:** If the user's response contradicts the parsed spec, prefer the user's input — they know their API better than the docs. Update the parsed spec accordingly before generating.

### Step 6: Generate

Generate all output files in `./<api-name>-cli/`. Read `references/conventions.md` first.

#### 6a: CLI executable (`bin/<api-name>-cli.mjs`)

Follow the structure in `references/cli-skeleton.mjs`. The generated CLI must satisfy these contracts:

- Zero external dependencies — Node.js built-ins only
- API key read from `.env` at repo root, never overriding shell env vars
- Global flags (`--json`, `--dry-run`, `--help`, `--verbose`, `--all`, `--version`) must not interfere with per-command flag parsing
- All HTTP calls support auth, dry-run preview, verbose logging, and error taxonomy mapping (see conventions.md)
- Per-action flags declared via `_flags` metadata — single source of truth for both `parseArgs` and `--help` output
- Three-level help: top-level (resources), resource (actions), action (flags with descriptions)
- Standard CRUD → `list`, `get`, `create`, `update`, `delete`
- Non-CRUD endpoints → use the API's own verb (e.g., `send`, `verify`, `cancel`)
- Cap nesting at 2 levels; flatten deeper paths with flags
- `--body <json>` escape hatch on every mutating action

#### 6b: Smoke tests (`test/smoke.test.mjs`)

Follow the structure in `references/smoke-test-skeleton.mjs`. Must cover every required test category from conventions.md and pass with no `.env` present.

#### 6c: API skill (`skills/<api>/SKILL.md`)

Follow the structure in `references/skill-skeleton.md`. Adapt lines marked `<-- adapt` to the target API.

The Setup section must use the validation command and detect commands identified in Steps 4-5. For auth-only APIs (no detected defaults), omit step 4 (detect defaults) from the setup flow.

Permissions must cover autonomous operation — reading knowledge, running commands, and writing learned patterns — so agents don't stall on permission prompts.

#### 6d: Supporting files

Generate these after the core CLI (6a), tests (6b), and API skill (6c) are written. Templates and schemas are in conventions.md — reference them, don't reinvent.

**Sync skill** (`skills/sync/SKILL.md`):

```yaml
---
name: sync
description: Check for API doc changes and regenerate the CLI. Use when the user says "sync", "check for updates", or "update the CLI".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - WebFetch
  - WebSearch
  - AskUserQuestion
---
```

Content: attribution line, sync workflow (read `.clify.json` → re-fetch → hash → compare → regenerate if changed → run tests → review knowledge for staleness).

**Plugin config** (`.claude-plugin/`): Generate `plugin.json` and `marketplace.json` per conventions.md plugin file schemas.

**AGENTS.md**: Setup instructions, resource/action listing, error handling summary, knowledge pointer. Keep under 50 lines.

**README.md**: Skill-focused. Attribution line, quick start, skills table (resources + actions), install-as-plugin command, global flags table, knowledge section. See conventions.md for the full template.

**Boilerplate**: `package.json` (with `bin` field), `.env.example` (annotated with `@tag` comments per conventions.md Setup Convention — at minimum `@required` and `@how-to-get` on the auth var), `.clify.json` (from parsed spec — include `auth` and `defaults` fields per conventions.md), `.gitignore`, `knowledge/.gitkeep`, `.docs-snapshot/`, `LICENSE` (MIT).

### Step 7: Validate

After generating all files:

1. **Contract checks:**
   - `.clify.json` matches the schema from conventions.md
   - `.claude-plugin/plugin.json` has required fields: `name`, `version`, `description`, `author`, `skills`, `capabilities`
   - `package.json` has `engines` field (single source of truth for runtime requirements)
   - `.claude-plugin/marketplace.json` has required fields: `name`, `description`, `version`, `author`, `source`
   - `name` and `version` match across `package.json`, `plugin.json`, and `marketplace.json`
   - Every entry in `plugin.json` `skills` array points to an existing SKILL.md file
   - Every generated SKILL.md contains `> Generated by [clify](https://github.com/derrickko/clify)` attribution
   - Every generated SKILL.md `allowed-tools` includes at minimum: Bash, Read, Glob (API skill adds Write, Edit, Grep; sync skill adds Write, Edit, Grep, WebFetch, WebSearch, AskUserQuestion)
   - README.md contains clify attribution and skill documentation for every resource
   - Error output in CLI source follows the taxonomy
   - Global flags are all present
   - Every resource-action is reachable
   - Generated SKILL.md contains a `## Setup` section with `### Check readiness` and `### First-time setup` subsections
   - `.env.example` has `@required` annotation on at least the auth var
   - `.clify.json` has `auth` field with `envVar`, `scheme`, and `validationCommand`
   - Every `validationCommand` and `detectCommand` in `.clify.json` maps to an actual resource-action in the generated CLI

2. **Smoke tests:**
   ```bash
   cd ./<api-name>-cli && npm test
   ```
   If tests fail, fix the generated code and re-run. Up to 3 attempts.

3. **Secret scan:**
   - Grep generated source for API key patterns (common prefixes: `sk_`, `pk_`, `re_`, `ghp_`, `Bearer [a-zA-Z0-9]{20,}`)
   - Flag any matches

4. **Self-review:**
   - Read the generated SKILL.md — does it reference every command?
   - Does it include error handling for every error code?
   - Are all resources from the parsed spec covered?

### Step 7.5: Simplify

After validation passes, spawn an Agent to review and simplify the generated code:

```
Agent: In ./<api-name>-cli/, run /simplify to review the generated code
for reuse opportunities and efficiency. Then run `npm test` to verify
all tests still pass. If tests fail, fix the issues and re-run tests
until they pass.
```

The agent runs `/simplify` in a fresh context — this gives a distinct review pass separate from the generation context. The generated code already passed Step 7 validation, so the agent has a working baseline to iterate from.

### Step 8: Report

```
Generated ./<api-name>-cli/ with:
  - X resources, Y actions
  - CLI: bin/<api-name>-cli.mjs
  - Skills: skills/<api-name>/SKILL.md, skills/sync/SKILL.md
  - Tests: Y passing

Install as Claude Code plugin:
  claude plugin add ./<api-name>-cli

The skill will guide you through setup on first use.
Or say: "set up <api-name>-cli"
```

## Important Rules

- **Zero external dependencies** in generated CLI code — only Node.js built-ins
- **Never auto-execute** generated code without smoke tests passing
- **Confirm with user** before generating (Step 5) — always show parsed endpoints
- **Adapt, don't copy** — the skeletons show patterns; generated code should match the target API's structure and terminology
- **Secrets in generated code** — explicitly strip example API keys found in docs; smoke test regex scan catches any missed
- **OpenAPI specs** — detect and parse directly (much more accurate than HTML crawling)
- **Don't proceed with incomplete data** — if crawling, parsing, or user input leaves gaps, resolve them before generating
