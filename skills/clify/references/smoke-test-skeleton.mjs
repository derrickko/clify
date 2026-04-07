// clify smoke test skeleton — adapt to target API. See conventions.md for required test categories.
// Lines marked "<-- adapt" must change per API.

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, "..", "bin", "<api>-cli.mjs"); // <-- adapt
const ROOT = resolve(__dirname, "..");

// --- Test helpers ---
// Strip the API key env var so tests never hit the real API.
function run(...args) {
  const { API_KEY_VAR: _, ...cleanEnv } = process.env; // <-- adapt var name
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf8", env: cleanEnv, timeout: 5000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", exitCode: err.status };
  }
}

function runJson(...args) {
  const result = run("--json", ...args);
  if (result.stdout.trim()) result.parsed = JSON.parse(result.stdout.trim());
  return result;
}

// --- Required test categories ---
// Adapt assertions to match the target API's resources and actions.

describe("--version", () => {
  it("prints version from package.json", () => {
    const { stdout, exitCode } = run("--version");
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    assert.equal(stdout.trim(), pkg.version);
    assert.equal(exitCode, 0);
  });
});

describe("--help", () => {
  it("shows usage with all resources", () => {
    const { stdout, exitCode } = run();
    assert.match(stdout, /Usage:/);
    // assert.match(stdout, /<resource-name>/); <-- one per resource
    assert.equal(exitCode, 0);
  });
  it("shows resource help", () => {
    const { stdout, exitCode } = run("<resource>", "--help"); // <-- adapt
    assert.match(stdout, /Actions:/);
    assert.equal(exitCode, 0);
  });
  it("shows action-level help with flags", () => {
    const { stdout, exitCode } = run("<resource>", "<action>", "--help"); // <-- adapt to an action with flags
    assert.match(stdout, /Flags:/);
    assert.equal(exitCode, 0);
  });
});

describe("auth missing", () => {
  it("returns auth_missing error", () => {
    // Invoke any endpoint that requires auth
    const result = runJson("<resource>", "<action>" /* , ...required flags */);
    assert.equal(result.parsed.type, "error");
    assert.equal(result.parsed.code, "auth_missing");
    assert.equal(result.parsed.retryable, false);
  });
});

describe("unknown resource", () => {
  it("returns validation_error", () => {
    const result = runJson("nonexistent", "list");
    assert.equal(result.parsed.code, "validation_error");
    assert.match(result.parsed.message, /Unknown resource/);
  });
});

describe("unknown action", () => {
  it("returns validation_error", () => {
    const result = runJson("<resource>", "nonexistent"); // <-- adapt
    assert.equal(result.parsed.code, "validation_error");
    assert.match(result.parsed.message, /Unknown action/);
  });
});

describe("validation", () => {
  it("missing required flags returns validation_error", () => {
    // Use a dummy key to bypass auth, then omit required flags
    try {
      execFileSync("node", [CLI, "--json", "<resource>", "<action>"], {
        encoding: "utf8",
        env: { ...process.env, API_KEY_VAR: "test_fake_key" }, // <-- adapt
        timeout: 5000,
      });
      assert.fail("Should have thrown");
    } catch (err) {
      const parsed = JSON.parse(err.stdout.trim());
      assert.equal(parsed.code, "validation_error");
    }
  });
});

describe("no hardcoded secrets", () => {
  it("source contains no API keys", () => {
    const source = readFileSync(resolve(ROOT, "bin", "<api>-cli.mjs"), "utf8"); // <-- adapt
    // Adapt patterns to the target API's key format
    assert.doesNotMatch(source, /sk_[a-zA-Z0-9]{20,}/);
    assert.doesNotMatch(source, /Bearer [a-zA-Z0-9]{20,}/);
  });
});

describe("resource coverage", () => {
  it("all resources appear in help", () => {
    const { stdout } = run("--help");
    // for (const r of ["<resource1>", "<resource2>"]) { <-- adapt
    //   assert.match(stdout, new RegExp(r));
    // }
  });
  // Add one test per resource checking its actions appear in resource help
});
