import { beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_CWD,
  type CliRunOptions,
  type CliRunResult,
  createTempHome,
  parseJsonOutput,
} from "../helpers/cli.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
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

function packedFilePaths(): Set<string> {
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
  return new Set((manifest[0]?.files ?? []).map((entry) => entry.path));
}

interface PackedArtifact {
  packageRoot: string;
  binPath: string;
}

function packAndExtractCli(): PackedArtifact {
  const packDir = createTrackedTempDir("pp-smoke-pack-");
  const extractDir = createTrackedTempDir("pp-smoke-extract-");

  const pack = spawnSync(
    "npm",
    ["pack", CLI_CWD, "--ignore-scripts", "--silent"],
    { cwd: packDir, encoding: "utf8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
  );
  expect(pack.status).toBe(0);

  const tarballName = pack.stdout.trim().split(/\r?\n/g).pop()?.trim();
  expect(tarballName).toBeTruthy();

  const tarballPath = join(packDir, tarballName!);
  const extract = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  expect(extract.status).toBe(0);

  const packageRoot = join(extractDir, "package");
  // Reuse the repo's already-installed runtime deps so packaged smoke executes
  // the packed artifact deterministically without adding registry/network flake.
  symlinkSync(
    join(CLI_CWD, "node_modules"),
    join(packageRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const pkg = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as { bin?: string | Record<string, string> };
  const binEntry =
    typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["privacy-pools"];

  expect(typeof binEntry).toBe("string");

  return {
    packageRoot,
    binPath: join(packageRoot, binEntry!),
  };
}

function runPackagedCli(
  packed: PackedArtifact,
  args: string[],
  options: CliRunOptions = {},
): CliRunResult {
  const home = options.home ?? createTempHome();
  const timeoutMs = options.timeoutMs ?? 20_000;
  const start = Date.now();

  const result = spawnSync("node", [packed.binPath, ...args], {
    cwd: packed.packageRoot,
    env: {
      ...process.env,
      PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
      ...options.env,
    },
    encoding: "utf8",
    input: options.input,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  const elapsedMs = Date.now() - start;
  const timedOut =
    result.status === null &&
    result.signal === "SIGTERM" &&
    typeof result.error?.message === "string" &&
    result.error.message.includes("ETIMEDOUT");

  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    elapsedMs,
    timedOut,
    errorMessage: result.error?.message,
  };
}

describe("packaged CLI smoke", () => {
  let home: string;
  let packed: PackedArtifact;

  beforeAll(() => {
    if (!existsSync(`${CLI_CWD}/dist/index.js`)) {
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
    }
    packed = packAndExtractCli();
    home = createTempHome("pp-smoke-dist-");
  }, 240_000);

  const runSmokeCli = (args: string[], options: CliRunOptions = {}) =>
    runPackagedCli(packed, args, options);

  // ── Binary boot ──────────────────────────────────────────────────────────

  describe("binary boot", () => {
    test("--version outputs semantic version string", () => {
      const result = runSmokeCli(["--version"], { home });
      expect(result.status).toBe(0);
      const lastLine = result.stdout.trim().split(/\n/g).pop();
      expect(lastLine).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("--help outputs usage text to stdout", () => {
      const result = runSmokeCli(["--help"], { home });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("privacy-pools");
      expect(result.stdout).toContain("deposit");
      expect(result.stdout).toContain("withdraw");
    });
  });

  // ── Read-only agent paths ────────────────────────────────────────────────

  describe("read-only agent paths", () => {
    test("status --agent: JSON success on stdout, stderr empty", () => {
      const result = runSmokeCli(["--agent", "status"], { home });
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
      const result = runSmokeCli(["--agent", "guide"], { home });
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
      const result = runSmokeCli(["--agent", "capabilities"], { home });
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
      const result = runSmokeCli(["--agent", "deposit"], { home });
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
      const result = runSmokeCli(["--agent", "withdraw"], { home });
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
      const result = runSmokeCli(["--agent", "ragequit"], { home });
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
      const result = runSmokeCli(
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
      const result = runSmokeCli(
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
      const result = runSmokeCli(["not-a-command"], { home });
      expect(result.status).toBe(2);
      expect(result.stderr.toLowerCase()).toContain("unknown command");
      expect(result.stdout.trim()).toBe("");
    });

    test("JSON-mode success: stdout has JSON, stderr is empty", () => {
      const result = runSmokeCli(["--json", "status"], { home });
      expect(result.status).toBe(0);
      const json = parseJsonOutput<{ success: boolean }>(result.stdout);
      expect(json.success).toBe(true);
      expect(result.stderr.trim()).toBe("");
    });

    test("JSON-mode error: stdout has JSON error envelope, stderr is empty", () => {
      const result = runSmokeCli(["--agent", "not-a-command"], { home });
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
      const statusResult = runSmokeCli(["--agent", "status"], { home });
      const capsResult = runSmokeCli(["--agent", "capabilities"], { home });
      const errResult = runSmokeCli(["--agent", "not-a-command"], { home });

      const statusJson = parseJsonOutput<{ schemaVersion: string }>(statusResult.stdout);
      const capsJson = parseJsonOutput<{ schemaVersion: string }>(capsResult.stdout);
      const errJson = parseJsonOutput<{ schemaVersion: string }>(errResult.stdout);

      expect(statusJson.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(capsJson.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(errJson.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    });

    test("success envelopes have success=true, error envelopes have success=false", () => {
      const okResult = runSmokeCli(["--agent", "status"], { home });
      const errResult = runSmokeCli(["--agent", "deposit"], { home });

      const okJson = parseJsonOutput<{ success: boolean }>(okResult.stdout);
      const errJson = parseJsonOutput<{ success: boolean; errorCode: string }>(errResult.stdout);

      expect(okJson.success).toBe(true);
      expect(errJson.success).toBe(false);
      expect(typeof errJson.errorCode).toBe("string");
    });
  });

  // ── Packaged artifact ──────────────────────────────────────────────────────

  test("npm pack includes dist entry point and package.json without orphaned command/output artifacts", () => {
    const filePaths = packedFilePaths();
    const packedCommandNames = packedBaseNames(filePaths, "dist/commands/");
    const packedOutputNames = packedBaseNames(filePaths, "dist/output/");
    const sourcePkg = JSON.parse(
      readFileSync(join(CLI_CWD, "package.json"), "utf8"),
    ) as { bin?: unknown; dependencies?: unknown };
    const packedPkg = JSON.parse(
      readFileSync(join(packed.packageRoot, "package.json"), "utf8"),
    ) as { bin?: unknown; dependencies?: unknown };

    expect(filePaths.has("dist/index.js")).toBe(true);
    expect(filePaths.has("package.json")).toBe(true);
    expect(filePaths.has("scripts/start-built-cli.mjs")).toBe(true);
    expect(packedCommandNames).toEqual(sourceBaseNames("src/commands"));
    expect(packedOutputNames).toEqual(sourceBaseNames("src/output"));
    expect(packedPkg.bin).toEqual(sourcePkg.bin);
    expect(packedPkg.dependencies).toEqual(sourcePkg.dependencies);
  }, 30_000);

  test("npm pack includes docs referenced by shipped docs and capabilities", () => {
    const filePaths = packedFilePaths();

    expect(filePaths.has("AGENTS.md")).toBe(true);
    expect(filePaths.has("CHANGELOG.md")).toBe(true);
    expect(filePaths.has("docs/reference.md")).toBe(true);
    expect(filePaths.has("skills/privacy-pools-cli/SKILL.md")).toBe(true);
    expect(filePaths.has("skills/privacy-pools-cli/reference.md")).toBe(true);

    const capabilities = runSmokeCli(["--agent", "capabilities"], { home });
    expect(capabilities.status).toBe(0);
    const json = parseJsonOutput<{
      documentation?: {
        reference?: string;
        agentGuide?: string;
        changelog?: string;
      };
    }>(capabilities.stdout);

    expect(filePaths.has(json.documentation?.reference ?? "")).toBe(true);
    expect(filePaths.has(json.documentation?.agentGuide ?? "")).toBe(true);
    expect(filePaths.has(json.documentation?.changelog ?? "")).toBe(true);
  }, 30_000);
}, 300_000);
