import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  CLI_CWD,
  createTempHome,
  parseJsonOutput,
  runBuiltCli,
} from "../helpers/cli.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

describe("packaged CLI smoke", () => {
  let home: string;

  beforeAll(() => {
    const build = spawnSync("npm", ["run", "-s", "build"], {
      cwd: CLI_CWD,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (build.status !== 0) {
      throw new Error(
        `Build failed (exit ${build.status}):\n${build.stderr}\n${build.stdout}`,
      );
    }
    home = createTempHome("pp-smoke-dist-");
  }, 120_000);

  // ── Preserved original tests (split into two) ───────────────────────────

  test("dist binary runs in agent mode with JSON envelopes", () => {
    const statusResult = runBuiltCli(["--agent", "status"], {
      home,
      timeoutMs: 60_000,
    });
    expect(statusResult.status).toBe(0);
    expect(statusResult.stderr.trim()).toBe("");

    const statusJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      configExists: boolean;
    }>(statusResult.stdout);
    expect(statusJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(statusJson.success).toBe(true);
    expect(statusJson.configExists).toBe(false);
  });

  test("unknown command returns JSON error envelope from dist", () => {
    const unknownResult = runBuiltCli(["--agent", "not-a-command"], {
      home,
      timeoutMs: 60_000,
    });
    expect(unknownResult.status).toBe(2);
    expect(unknownResult.stderr.trim()).toBe("");

    const unknownJson = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      errorCode: string;
      error: { category: string };
    }>(unknownResult.stdout);
    expect(unknownJson.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(unknownJson.success).toBe(false);
    expect(unknownJson.errorCode).toBe("INPUT_ERROR");
    expect(unknownJson.error.category).toBe("INPUT");
  });

  // ── Binary boot ──────────────────────────────────────────────────────────

  describe("binary boot", () => {
    test("--version outputs semantic version string", () => {
      const result = runBuiltCli(["--version"], { home });
      expect(result.status).toBe(0);
      const lastLine = result.stdout.trim().split(/\n/g).pop();
      expect(lastLine).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("--help outputs usage text to stdout", () => {
      const result = runBuiltCli(["--help"], { home });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("privacy-pools");
      expect(result.stdout).toContain("deposit");
      expect(result.stdout).toContain("withdraw");
    });
  });

  // ── Read-only agent paths ────────────────────────────────────────────────

  describe("read-only agent paths", () => {
    test("status --agent: JSON success on stdout, stderr empty", () => {
      const result = runBuiltCli(["--agent", "status"], { home });
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
      }>(result.stdout);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
    });

    test("guide --agent: JSON success on stdout, stderr empty", () => {
      const result = runBuiltCli(["--agent", "guide"], { home });
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        guide: string;
      }>(result.stdout);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(typeof json.guide).toBe("string");
    });

    test("capabilities --agent: JSON success on stdout, stderr empty", () => {
      const result = runBuiltCli(["--agent", "capabilities"], { home });
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        commands: unknown[];
      }>(result.stdout);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.commands.length).toBeGreaterThan(0);
    });
  });

  // ── Transaction fail-fast (safety-sensitive) ─────────────────────────────

  describe("transaction fail-fast", () => {
    test("deposit --agent (no args): INPUT_ERROR exit 2", () => {
      const result = runBuiltCli(["--agent", "deposit"], { home });
      expect(result.status).toBe(2);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        errorCode: string;
        error: { category: string };
      }>(result.stdout);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.error.category).toBe("INPUT");
    });

    test("withdraw --agent (no args): INPUT_ERROR exit 2", () => {
      const result = runBuiltCli(["--agent", "withdraw"], { home });
      expect(result.status).toBe(2);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        errorCode: string;
        error: { category: string };
      }>(result.stdout);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.error.category).toBe("INPUT");
    });

    test("ragequit --agent (no args): INPUT_ERROR exit 2", () => {
      const result = runBuiltCli(["--agent", "ragequit"], { home });
      expect(result.status).toBe(2);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        errorCode: string;
        error: { category: string };
      }>(result.stdout);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.error.category).toBe("INPUT");
    });
  });

  // ── Stream boundary contracts ────────────────────────────────────────────

  describe("stream boundary contracts", () => {
    test("human-mode error: stderr has error text, stdout is empty", () => {
      const result = runBuiltCli(["not-a-command"], { home });
      expect(result.status).toBe(2);
      expect(result.stderr.toLowerCase()).toContain("unknown command");
      expect(result.stdout.trim()).toBe("");
    });

    test("JSON-mode success: stdout has JSON, stderr is empty", () => {
      const result = runBuiltCli(["--json", "status"], { home });
      expect(result.status).toBe(0);
      const json = JSON.parse(result.stdout.trim());
      expect(json.success).toBe(true);
      expect(result.stderr.trim()).toBe("");
    });

    test("JSON-mode error: stdout has JSON, stderr is empty", () => {
      const result = runBuiltCli(["--agent", "not-a-command"], { home });
      expect(result.status).toBe(2);
      const json = JSON.parse(result.stdout.trim());
      expect(json.success).toBe(false);
      expect(result.stderr.trim()).toBe("");
    });
  });

  // ── Packaging sanity ─────────────────────────────────────────────────────

  describe("packaging sanity", () => {
    test("schemaVersion matches source constant across commands", () => {
      const statusResult = runBuiltCli(["--agent", "status"], { home });
      const capsResult = runBuiltCli(["--agent", "capabilities"], { home });
      const errResult = runBuiltCli(["--agent", "not-a-command"], { home });

      const statusJson = parseJsonOutput<{ schemaVersion: string }>(statusResult.stdout);
      const capsJson = parseJsonOutput<{ schemaVersion: string }>(capsResult.stdout);
      const errJson = parseJsonOutput<{ schemaVersion: string }>(errResult.stdout);

      expect(statusJson.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(capsJson.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(errJson.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    });

    test("success envelopes have success=true, error envelopes have success=false", () => {
      const okResult = runBuiltCli(["--agent", "status"], { home });
      const errResult = runBuiltCli(["--agent", "deposit"], { home });

      const okJson = parseJsonOutput<{ success: boolean }>(okResult.stdout);
      const errJson = parseJsonOutput<{ success: boolean; errorCode: string }>(errResult.stdout);

      expect(okJson.success).toBe(true);
      expect(errJson.success).toBe(false);
      expect(typeof errJson.errorCode).toBe("string");
    });
  });
}, 180_000);
