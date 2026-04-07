<h1 align="center">clify</h1>

<p align="center">
  <strong>Paste a URL. Get a CLI.</strong>
</p>

<p align="center">
  A Claude Code plugin that turns any API documentation into a self-updating CLI repo.
</p>

<p align="center">
  <a href="https://github.com/derrickko/clify/blob/main/LICENSE"><img src="https://img.shields.io/github/license/derrickko/clify?style=flat" alt="License"></a>
  <a href="#install"><img src="https://img.shields.io/badge/Claude_Code-plugin-blueviolet?style=flat" alt="Claude Code plugin"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat" alt="Node 20+">
</p>

---

```
You: /clify https://developer.calendly.com/api-docs

Claude: Fetching docs... detected REST API.
        Crawling 8 doc pages...

        Detected API: Calendly
        Base URL: https://api.calendly.com
        Auth: Bearer token via CALENDLY_API_KEY

        Resources (15 endpoints):
          events:           list, get, cancel
          scheduling-links: list, create
          users:            get, list
          invitees:         list, get, no-show
          webhooks:         list, get, create, delete
          organizations:    get, invite

        CLI name: calendly-cli

        Recommendations:
        1. Include all 6 resources — small enough to ship as one CLI.
        2. Map DELETE /scheduled_events/{uuid} → events cancel (not
           events delete) — Calendly treats this as a cancellation.

        Before generating, one question:
        Docs show both OAuth and Personal Access Token auth.
        Recommendation: Personal Access Token only — simpler for
        CLI/agent use. OK?

You: yes, ship it

Claude: Generated ./calendly-cli/ with:
          - 6 resources, 15 actions
          - CLI: bin/calendly-cli.mjs
          - Skills: skills/calendly/SKILL.md, skills/sync/SKILL.md
          - Tests: 15 passing

        Install as Claude Code plugin:
          claude plugin add ./calendly-cli
```

## Install

```
/plugin marketplace add derrickko/clify
/plugin install clify@derrickko-clify
```

Or from a local clone:

```bash
git clone https://github.com/derrickko/clify.git
```
```
/plugin add ./clify
```

## What You Get

One command produces a complete, installable repo:

```
calendly-cli/
    ├── bin/calendly-cli.mjs          ← zero-dep CLI (Node.js built-ins only)
    ├── skills/calendly/SKILL.md      ← Claude Code skill with guided setup
    ├── skills/sync/SKILL.md          ← detects doc changes, regenerates
    ├── knowledge/                    ← patterns learned from usage
    ├── test/smoke.test.mjs           ← structural tests (pass without API key)
    ├── .claude-plugin/               ← plugin registration
    ├── AGENTS.md                     ← Codex / OpenAI agent instructions
    ├── .clify.json                   ← metadata + content hash for sync
    ├── .env.example                  ← annotated credential template
    ├── package.json
    └── LICENSE (MIT)
```

The generated CLI works three ways:

| Mode | How | Example |
|------|-----|---------|
| **Standalone** | Run directly from terminal | `calendly-cli events list --status active` |
| **Claude Code plugin** | Install and use conversationally | `"cancel all my Calendly events for next Friday"` |
| **Codex / agent** | Reads AGENTS.md for autonomous use | Agent runs CLI commands with structured JSON output |

## Features

| | Feature | Details |
|-|---------|---------|
| **Zero deps** | Generated CLIs use only Node.js built-ins | No `node_modules`, no supply chain risk |
| **Any format** | OpenAPI specs parsed directly; HTML/Markdown crawled and extracted | Structured specs preferred for accuracy |
| **Self-update** | `/sync` re-crawls docs, diffs content hashes, regenerates on change | Knowledge files preserved across syncs |
| **Guided setup** | Generated skill walks through auth + defaults on first use | Auto-detects pervasive parameters (e.g., `workspace_id`) |
| **Knowledge system** | Learns gotchas, patterns, and shortcuts as you use the CLI | Agents consult knowledge before every command |
| **Smoke tests** | Every generated repo ships with structural tests | Tests pass with no API key — validates CLI shape, not API responses |
| **Agent-native** | Structured JSON output, error taxonomy, three-level `--help` | Agents discover flags at runtime via `--help` |
| **Consulted generation** | Shows parsed endpoints and recommendations before writing code | You approve, override, or refine before anything is generated |

## Usage

```
/clify <api-docs-url>
```

That's it. clify fetches, parses, asks you to confirm, generates, and tests.

### Examples

```bash
# From OpenAPI specs (highest accuracy)
/clify https://api.example.com/openapi.json

# From HTML documentation
/clify https://developer.calendly.com/api-docs

# From Markdown docs
/clify https://raw.githubusercontent.com/org/repo/main/docs/api.md
```

### Generated CLI in Action

Every generated CLI follows the same resource-action pattern:

```bash
# CRUD operations map naturally
calendly-cli events list --status active --json
calendly-cli webhooks create --url https://hook.example.com --events invitee.created
calendly-cli scheduling-links create --owner-uri <user-uri> --max-event-count 1

# Global flags work on every command
calendly-cli invitees list --event <uri> --all     # auto-paginate
calendly-cli events get --uuid <uuid> --verbose    # show request/response details

# Three-level help for runtime discovery
calendly-cli --help                                # list all resources
calendly-cli events --help                         # list actions for events
calendly-cli events cancel --help                  # show flags with descriptions

# Structured errors for agents
calendly-cli events cancel --uuid bad
# → { "type": "error", "code": "not_found", "message": "...", "retryable": false }
```

### Self-Update

When the API changes, the generated `/sync` skill keeps your CLI current:

```
/sync
→ "3 new endpoints, 1 removed, 2 modified"
→ Regenerates CLI + skills
→ Runs smoke tests
→ Reviews knowledge/ for stale entries
```

Content hashes in `.clify.json` track exactly what changed. Knowledge files survive regeneration, so your learned patterns carry forward.

### Knowledge System

As agents use the generated CLI, they write down what they learn:

```yaml
# knowledge/upload-content-type.md
---
type: gotcha
command: "files upload"
learned: 2026-04-06
confidence: high
---
Upload endpoint returns 422 if Content-Type header is missing.
Always include --content-type application/octet-stream for binary uploads.
```

Four knowledge types: **gotcha** (error → recovery), **pattern** (common flag combos), **shortcut** (multi-step workflows), **quirk** (API contradicts docs). The generated skill reads all knowledge files before every command, so accumulated patterns carry forward without touching code.

## How It Works

clify is a pure Claude Code skill with no runtime dependencies. The generation pipeline:

1. **Fetch** — pulls the docs URL
2. **Detect** — checks for OpenAPI/Swagger (parsed directly) vs HTML/Markdown (crawled up to depth 2)
3. **Parse** — extracts endpoints, auth scheme, resource structure, pervasive parameters
4. **Consult** — presents findings with opinionated recommendations; you confirm before generating
5. **Generate** — writes all files following rigid conventions ([`conventions.md`](skills/clify/references/conventions.md))
6. **Validate** — runs smoke tests, scans for leaked secrets, self-reviews generated skills
7. **Report** — summary + install command

OpenAPI specs skip crawling entirely — structured data means higher accuracy and fewer questions.

<details>
<summary>Error taxonomy in generated CLIs</summary>

Every generated CLI maps HTTP errors to a standard taxonomy that agents can act on programmatically:

| Code | Retryable | When |
|------|-----------|------|
| `auth_missing` | No | No API key in `.env` |
| `auth_invalid` | No | Key rejected (401) |
| `validation_error` | No | Bad request (400, 422) |
| `not_found` | No | Resource doesn't exist (404) |
| `forbidden` | No | Insufficient permissions (403) |
| `conflict` | No | State conflict (409) |
| `rate_limited` | Yes | Too many requests (429) |
| `server_error` | Yes | API server error (5xx) |
| `network_error` | Yes | Connection failed |
| `timeout` | Yes | Request exceeded timeout |

Retry logic lives in the skill wrapper, not the CLI — the agent decides when and how to retry.

</details>

<details>
<summary>Generated CLI conventions</summary>

All generated CLIs follow the same contracts:

- **Resource-action pattern:** `<cli> <resource> <action> [flags]`
- **Standard CRUD mapping:** `list`, `get`, `create`, `update`, `delete`
- **Non-CRUD verbs:** use the API's own terminology (`send`, `verify`, `cancel`)
- **Nesting cap:** 2 levels max; deeper paths flatten to flags
- **Global flags:** `--json`, `--dry-run`, `--help`, `--version`, `--verbose`, `--all`
- **Per-action flags:** declared via `_flags` metadata — single source of truth for both parsing and help text
- **`.env` loading:** reads from repo root only, never overrides shell env vars
- **Pagination:** one page by default, `--all` auto-paginates
- **`--body <json>`:** escape hatch on every mutating endpoint

See [`conventions.md`](skills/clify/references/conventions.md) for the full specification.

</details>

## Contributing

Contributions welcome.

- [Report a bug](https://github.com/derrickko/clify/issues/new?labels=bug)
- [Request a feature](https://github.com/derrickko/clify/issues/new?labels=enhancement)

## License

[MIT](LICENSE)
