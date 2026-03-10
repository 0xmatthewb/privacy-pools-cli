import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import {
  CLI_CWD,
  createTempHome,
  parseJsonOutput,
  runBuiltCli,
} from "../helpers/cli.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

function packedBaseNames(paths: Set<string>, prefix: string): string[] {
  return Array.from(new Set(
    Array.from(paths)
      .filter((path): path is string => typeof path === "string" && path.startsWith(prefix))
      .filter((path) => path.endsWith(".js") || path.endsWith(".d.ts"))
      .map((path) => path.slice(prefix.length).replace(/(\.d)?\.ts$|\.js$/g, "")),
  )).sort();
}

function sourceBaseNames(dir: string): string[] {
  return readdirSync(`${CLI_CWD}/${dir}`)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => name.replace(/\.ts$/g, ""))
    .sort();
}

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
        mode: string;
        help: string;
      }>(result.stdout);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("help");
      expect(typeof json.help).toBe("string");
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
        success: boolean;
        errorCode: string;
        error: { category: string };
      }>(result.stdout);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.error.category).toBe("INPUT");
    });
  });

  // ── Offline network paths ────────────────────────────────────────────────

  describe("offline network paths", () => {
    const OFFLINE_ENV = { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" };

    test("pools --agent (offline): structured error envelope", () => {
      const result = runBuiltCli(
        ["--agent", "pools", "--chain", "mainnet"],
        { home, env: OFFLINE_ENV },
      );
      expect(result.status).toBeGreaterThan(0);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        success: boolean;
        errorCode: string;
        error: { category: string };
      }>(result.stdout);
      expect(json.success).toBe(false);
      expect(typeof json.errorCode).toBe("string");
      expect(typeof json.error.category).toBe("string");
    });

    test("stats --agent (offline): structured error envelope", () => {
      const result = runBuiltCli(
        ["--agent", "stats", "--chain", "mainnet"],
        { home, env: OFFLINE_ENV },
      );
      expect(result.status).toBeGreaterThan(0);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        success: boolean;
        errorCode: string;
        error: { category: string };
      }>(result.stdout);
      expect(json.success).toBe(false);
      expect(typeof json.errorCode).toBe("string");
      expect(typeof json.error.category).toBe("string");
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
      const json = parseJsonOutput<{ success: boolean }>(result.stdout);
      expect(json.success).toBe(true);
      expect(result.stderr.trim()).toBe("");
    });

    test("JSON-mode error: stdout has JSON error envelope, stderr is empty", () => {
      const result = runBuiltCli(["--agent", "not-a-command"], { home });
      expect(result.status).toBe(2);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        success: boolean;
        errorCode: string;
        error: { category: string };
      }>(result.stdout);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.error.category).toBe("INPUT");
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

  // ── Packaged artifact ──────────────────────────────────────────────────────

  test("npm pack includes dist entry point and package.json without orphaned command/output artifacts", () => {
    const pack = spawnSync(
      "npm",
      ["pack", "--dry-run", "--ignore-scripts", "--json", "--silent"],
      { cwd: CLI_CWD, encoding: "utf8", timeout: 30_000 },
    );
    expect(pack.status).toBe(0);
    const output = `${pack.stdout}\n${pack.stderr}`.trim();
    const jsonStart = output.indexOf("[");
    const jsonEnd = output.lastIndexOf("]");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    expect(jsonEnd).toBeGreaterThan(jsonStart);

    const manifest = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as Array<{
      files?: Array<{ path?: string }>;
    }>;
    const filePaths = new Set((manifest[0]?.files ?? []).map((entry) => entry.path));
    const packedCommandNames = packedBaseNames(filePaths, "dist/commands/");
    const packedOutputNames = packedBaseNames(filePaths, "dist/output/");

    expect(filePaths.has("dist/index.js")).toBe(true);
    expect(filePaths.has("package.json")).toBe(true);
    expect(packedCommandNames).toEqual(sourceBaseNames("src/commands"));
    expect(packedOutputNames).toEqual(sourceBaseNames("src/output"));
  }, 30_000);
}, 180_000);
