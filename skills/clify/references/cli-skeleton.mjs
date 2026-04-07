// clify CLI skeleton — adapt to target API. See conventions.md for contracts.
// Section ordering and function signatures are the contract.
// Lines marked "<-- adapt" must change per API.

import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// --- ESM preamble (every generated CLI uses this) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;

// --- .env loader (zero deps, repo root only) ---
// Don't override existing env vars — user's shell takes precedence.
function loadEnv() {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

// --- Global flag separation (known-set filter) ---
// Manual split so per-command flags aren't consumed as booleans.
const GLOBAL_FLAGS = new Set([
  "--json", "--dry-run", "--help", "-h", "--version", "-v", "--verbose", "--all"
]);
const rawArgs = process.argv.slice(2);
const globalArgv = [];
const remainingArgv = [];
for (const arg of rawArgs) {
  if (GLOBAL_FLAGS.has(arg)) globalArgv.push(arg);
  else remainingArgv.push(arg);
}

const { values: globalFlags } = parseArgs({
  args: globalArgv,
  options: {
    json:      { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help:      { type: "boolean", short: "h", default: false },
    version:   { type: "boolean", short: "v", default: false },
    verbose:   { type: "boolean", default: false },
    all:       { type: "boolean", default: false },
  },
  strict: true,
});
const positionals = remainingArgv;
const jsonOutput = globalFlags.json || !process.stdout.isTTY;

// --- Output helpers ---
// output() for success data, errorOut() for structured errors.
function output(data) {
  if (jsonOutput) {
    console.log(JSON.stringify(data));
  } else {
    for (const [key, val] of Object.entries(data)) {
      if (typeof val === "object" && val !== null) {
        console.log(`${key}:`);
        for (const [k, v] of Object.entries(val)) console.log(`  ${k}: ${v}`);
      } else {
        console.log(`${key}: ${val}`);
      }
    }
  }
}

function errorOut(code, message, opts = {}) {
  const err = { type: "error", code, message, retryable: opts.retryable ?? false };
  if (opts.retryAfter != null) err.retryAfter = opts.retryAfter;
  if (jsonOutput) {
    console.log(JSON.stringify(err));
  } else {
    console.error(`Error [${code}]: ${message}`);
  }
  process.exit(1);
}

// --- apiRequest() — single HTTP function for all endpoints ---
// Handles: auth check, dry-run preview, verbose logging, error taxonomy mapping.
const BASE_URL = "https://api.example.com"; // <-- adapt per API
async function apiRequest(method, path, { body, query } = {}) {
  const apiKey = process.env.EXAMPLE_API_KEY; // <-- adapt env var name
  if (!apiKey) errorOut("auth_missing", "EXAMPLE_API_KEY not set. Add it to .env or export it.");

  let url = `${BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v != null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`, // <-- adapt auth scheme
    "Content-Type": "application/json",
  };

  if (globalFlags["dry-run"]) {
    output({ type: "dry_run", request: { method, url, headers: { ...headers, Authorization: "Bearer ***" }, ...(body && { body }) } });
    process.exit(0);
  }
  if (globalFlags.verbose) console.error(`> ${method} ${url}`);

  let res;
  try {
    res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    errorOut("network_error", `Connection failed: ${err.message}`, { retryable: true });
  }

  if (globalFlags.verbose) console.error(`< ${res.status} ${res.statusText}`);

  if (!res.ok) {
    let detail = "";
    try { const b = await res.json(); detail = b.message || b.error || JSON.stringify(b); } catch { detail = res.statusText; }
    const statusMap = {
      400: { code: "validation_error", retryable: false },
      401: { code: "auth_invalid",     retryable: false },
      403: { code: "forbidden",        retryable: false },
      404: { code: "not_found",        retryable: false },
      409: { code: "conflict",         retryable: false },
      422: { code: "validation_error", retryable: false },
      429: { code: "rate_limited",     retryable: true },
    };
    const mapped = statusMap[res.status] || (res.status >= 500 ? { code: "server_error", retryable: true } : { code: "validation_error", retryable: false });
    const opts = { retryable: mapped.retryable };
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter && mapped.retryable) opts.retryAfter = parseInt(retryAfter, 10) || undefined;
    errorOut(mapped.code, detail, opts);
  }

  if (res.status === 204) return null;
  return res.json();
}

// --- Pagination helper ---
// Returns one page by default. --all auto-paginates.
// Adapt cursor field name per API (cursor, page, offset, etc.).
async function paginated(path, query = {}) {
  if (!globalFlags.all) return apiRequest("GET", path, { query });
  let allData = [], cursor;
  do {
    const q = { ...query };
    if (cursor) q.cursor = cursor;
    const data = await apiRequest("GET", path, { query: q });
    const items = data.data || data;
    allData = allData.concat(Array.isArray(items) ? items : [items]);
    cursor = data.next_cursor || null;
  } while (cursor);
  return { data: allData };
}

// --- Flag registry ---
// Each resource declares _flags: a map of action → flag specs.
// Used by BOTH parseArgs (runtime) and showHelp (discovery).
// { type, required?, description } — type is "string" or "boolean".
function toParseArgs(flags) {
  const options = {};
  for (const [name, spec] of Object.entries(flags)) {
    options[name] = { type: spec.type };
  }
  return options;
}

function checkRequired(flags, values) {
  const missing = Object.entries(flags)
    .filter(([name, spec]) => spec.required && !values[name])
    .map(([name]) => `--${name}`);
  if (missing.length) errorOut("validation_error", `Required: ${missing.join(", ")}`);
}

// --- Resource handlers (one object per resource) ---
// _flags is the single source of truth for per-action flags.
// Action handlers read from _flags via toParseArgs().
const things = {
  _flags: {
    list: {},
    get: {
      id: { type: "string", required: true, description: "Thing ID" },
    },
    create: {
      name: { type: "string", required: true, description: "Thing name" },
      body: { type: "string", description: "Raw JSON body (overrides flags)" },
    },
  },
  async list() {
    const data = await paginated("/things");
    output(data);
  },
  async get(args) {
    const { values } = parseArgs({ args, options: toParseArgs(things._flags.get), strict: true });
    checkRequired(things._flags.get, values);
    output(await apiRequest("GET", `/things/${values.id}`));
  },
  async create(args) {
    const { values } = parseArgs({ args, options: toParseArgs(things._flags.create), strict: true });
    const payload = values.body ? JSON.parse(values.body) : (() => {
      checkRequired(things._flags.create, values);
      return { name: values.name };
    })();
    output(await apiRequest("POST", "/things", { body: payload }));
  },
};

// --- Resource registry (routing table) ---
const resources = { things };

// --- Help text (generated from registry + _flags) ---
// Three levels: no args → all resources, resource → actions, resource action → flags.
function showHelp(resource, action) {
  // Action-level: show flags for a specific action
  if (resource && action && resources[resource]?._flags?.[action]) {
    const flags = resources[resource]._flags[action];
    console.log(`Usage: example-cli ${resource} ${action} [flags]\n`);
    if (Object.keys(flags).length === 0) {
      console.log("No action-specific flags.");
    } else {
      console.log("Flags:");
      for (const [name, spec] of Object.entries(flags)) {
        const req = spec.required ? " (required)" : "";
        console.log(`  --${name.padEnd(16)} ${spec.description || ""}${req}`);
      }
    }
    return;
  }
  // Resource-level: show actions
  if (resource && resources[resource]) {
    const actionNames = Object.keys(resources[resource]).filter(k => k !== "_flags");
    console.log(`Usage: example-cli ${resource} <action> [flags]\n`);
    console.log(`Actions: ${actionNames.join(", ")}\n`);
    console.log(`Run: example-cli ${resource} <action> --help for flag details.`);
    return;
  }
  // Top-level: show all resources
  console.log(`example-cli v${VERSION}\n`);
  console.log("Usage: example-cli <resource> <action> [flags]\n");
  console.log("Resources:");
  for (const [name, res] of Object.entries(resources)) {
    const actionNames = Object.keys(res).filter(k => k !== "_flags");
    console.log(`  ${name.padEnd(14)} ${actionNames.join(", ")}`);
  }
  console.log("\nGlobal flags:");
  console.log("  --json       JSON output (default when piped)");
  console.log("  --dry-run    Show request without executing");
  console.log("  --verbose    Include request/response details");
  console.log("  --all        Auto-paginate");
  console.log("  --help, -h   Show help");
  console.log("  --version    Show version");
}

// --- Main router ---
// First two non-flag positionals are resource and action.
// Everything else passes through to the action handler.
async function main() {
  if (globalFlags.version) { console.log(VERSION); process.exit(0); }
  const resource = positionals[0]?.startsWith("-") ? undefined : positionals[0];
  const action   = positionals[1]?.startsWith("-") ? undefined : positionals[1];
  const rest     = positionals.slice(resource ? (action ? 2 : 1) : 0);

  if (globalFlags.help && resource && action) { showHelp(resource, action); process.exit(0); }
  if (globalFlags.help || !resource) { showHelp(resource); process.exit(0); }
  if (!resources[resource]) errorOut("validation_error", `Unknown resource: ${resource}. Run --help for available resources.`);
  if (!action || globalFlags.help) { showHelp(resource); process.exit(0); }
  if (!resources[resource][action]) {
    errorOut("validation_error", `Unknown action: ${resource} ${action}. Available: ${Object.keys(resources[resource]).filter(k => k !== "_flags").join(", ")}`);
  }
  await resources[resource][action](rest);
}

main().catch((err) => errorOut("network_error", err.message, { retryable: true }));
