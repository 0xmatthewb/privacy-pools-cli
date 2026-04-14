import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CLI_CWD,
  type CliRunOptions,
  createTempHome,
  parseJsonOutput,
} from "../helpers/cli.ts";
import { assertUnknownCommandAgentContract } from "../helpers/agent-contract.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { npmBin } from "../helpers/npm-bin.ts";
import { cleanupTrackedTempDir, createTrackedTempDir } from "../helpers/temp.ts";
import {
  cleanupWorkspaceSnapshot,
  createBuiltWorkspaceSnapshot,
} from "../helpers/workspace-snapshot.ts";
import {
  JSON_SCHEMA_VERSION,
  jsonContractDocRelativePath,
} from "../../src/utils/json.ts";

const PREPARED_CLI_TARBALL = process.env.PP_INSTALL_CLI_TARBALL?.trim() || null;
const PACK_RETRY_DELAY_MS = 250;
const PACKAGED_SMOKE_INSTALL_MODE =
  process.env.PP_PACKAGED_SMOKE_INSTALL?.trim() === "1";

function collectRelativeFiles(rootDir: string, relativeDir = ""): string[] {
  const currentDir = relativeDir ? join(rootDir, relativeDir) : rootDir;
  const entries = readdirSync(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const childRelativePath = relativeDir
      ? join(relativeDir, entry.name)
      : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectRelativeFiles(rootDir, childRelativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(childRelativePath);
    }
  }

  return files;
}

interface PackedArtifact {
  extractRoot: string;
  packageRoot: string;
  binPath: string;
  filePaths: Set<string>;
}

function runPackCommand(packRoot: string) {
  return spawnSync(
    npmBin(),
    ["pack", "--ignore-scripts", "--silent"],
    {
      cwd: packRoot,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: buildChildProcessEnv(),
    },
  );
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runPackWithRetries(
  packRoot: string,
  attempts: number = 3,
): ReturnType<typeof spawnSync> {
  let lastResult = runPackCommand(packRoot);

  for (let attempt = 1; attempt < attempts && lastResult.status !== 0; attempt += 1) {
    sleepSync(PACK_RETRY_DELAY_MS);
    lastResult = runPackCommand(packRoot);
  }

  return lastResult;
}

function assertSuccessfulPack(
  packRoot: string,
  pack: ReturnType<typeof spawnSync>,
): string {
  if (pack.status !== 0) {
    throw new Error(
      [
        `npm pack failed in ${packRoot} (exit ${pack.status ?? "null"})`,
        pack.signal ? `signal: ${pack.signal}` : null,
        pack.error ? `error: ${pack.error.message}` : null,
        pack.stderr?.trim() ? `stderr:\n${pack.stderr.trim()}` : null,
        pack.stdout?.trim() ? `stdout:\n${pack.stdout.trim()}` : null,
      ].filter(Boolean).join("\n\n"),
    );
  }

  const tarballName = pack.stdout.trim().split(/\r?\n/g).pop()?.trim();
  expect(tarballName).toBeTruthy();
  return tarballName!;
}

function installPackagedProdDependencies(packageRoot: string): void {
  const npmCacheDir = createTrackedTempDir("pp-smoke-npm-cache-");
  try {
    const install = spawnSync(
      npmBin(),
      [
        "install",
        "--ignore-scripts",
        "--omit=dev",
        "--omit=optional",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        "--prefer-offline",
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        timeout: 240_000,
        maxBuffer: 10 * 1024 * 1024,
        env: buildChildProcessEnv({
          npm_config_cache: npmCacheDir,
        }),
      },
    );
    expect(install.status).toBe(0);
  } finally {
    cleanupTrackedTempDir(npmCacheDir);
  }
}

function linkPackagedRuntimeDependencies(packageRoot: string): void {
  const sourceNodeModules = join(CLI_CWD, "node_modules");
  const targetNodeModules = join(packageRoot, "node_modules");

  expect(existsSync(sourceNodeModules)).toBe(true);
  symlinkSync(
    sourceNodeModules,
    targetNodeModules,
    process.platform === "win32" ? "junction" : "dir",
  );
}

function preparePackagedRuntime(packageRoot: string): void {
  // Full installability is already covered by the install-profile release
  // verification. This packed-smoke lane focuses on the packed artifact itself and
  // can usually reuse the repo's dependency tree to stay fast.
  if (PACKAGED_SMOKE_INSTALL_MODE) {
    installPackagedProdDependencies(packageRoot);
    return;
  }

  linkPackagedRuntimeDependencies(packageRoot);
}

function packAndExtractCli(
  packRoot: string | null,
  options: { tarballPath?: string } = {},
): PackedArtifact {
  const extractDir = createTrackedTempDir("pp-smoke-extract-");
  const preparedTarballPath = options.tarballPath?.trim();
  let tarballPath = preparedTarballPath ?? "";
  let localPackRoot: string | null = null;

  if (!tarballPath) {
    localPackRoot = packRoot ?? createBuiltWorkspaceSnapshot();
    const pack = runPackWithRetries(localPackRoot);

    const tarballName = assertSuccessfulPack(localPackRoot, pack);
    tarballPath = join(localPackRoot, tarballName!);
  }

  try {
    const extract = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: buildChildProcessEnv(),
    });
    expect(extract.status).toBe(0);

    const packageRoot = join(extractDir, "package");
    preparePackagedRuntime(packageRoot);

    const filePaths = new Set(collectRelativeFiles(packageRoot));

    const pkg = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { bin?: string | Record<string, string> };
    const binEntry =
      typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["privacy-pools"];

    expect(typeof binEntry).toBe("string");

    return {
      extractRoot: extractDir,
      packageRoot,
      binPath: join(packageRoot, binEntry!),
      filePaths,
    };
  } finally {
    if (localPackRoot) {
      cleanupWorkspaceSnapshot(localPackRoot);
    }
  }
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
    env: buildChildProcessEnv({
      PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
      ...options.env,
    }),
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

describe("packed CLI smoke", () => {
  let home: string;
  let packed: PackedArtifact | null = null;

  beforeAll(() => {
    packed = PREPARED_CLI_TARBALL
      ? packAndExtractCli(null, {
          tarballPath: resolve(PREPARED_CLI_TARBALL),
        })
      : packAndExtractCli(null);
    home = createTempHome("pp-smoke-dist-");
  }, 240_000);

  afterAll(() => {
    if (packed) {
      cleanupTrackedTempDir(packed.extractRoot);
    }
  });

  const runSmokeCli = (args: string[], options: CliRunOptions = {}) =>
    runPackagedCli(packed!, args, options);

  describe("binary boot", () => {
    test("packed tarball includes bundled proving artifacts", () => {
      for (const artifact of [
        "assets/circuits/v1.2.0/commitment.wasm",
        "assets/circuits/v1.2.0/commitment.zkey",
        "assets/circuits/v1.2.0/commitment.vkey",
        "assets/circuits/v1.2.0/withdraw.wasm",
        "assets/circuits/v1.2.0/withdraw.zkey",
        "assets/circuits/v1.2.0/withdraw.vkey",
      ]) {
        expect(packed.filePaths.has(artifact)).toBe(true);
      }
    });

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

    test("capabilities --agent boots from the packed package and advertises shipped docs", () => {
      const result = runSmokeCli(["--agent", "capabilities"], { home });
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");

      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        commands: unknown[];
        documentation?: {
          reference?: string;
          agentGuide?: string;
          changelog?: string;
          runtimeUpgrades?: string;
          jsonContract?: string;
        };
      }>(result.stdout);

      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(json.commands.length).toBeGreaterThan(0);
      expect(packed.filePaths.has(json.documentation?.reference ?? "")).toBe(true);
      expect(packed.filePaths.has(json.documentation?.agentGuide ?? "")).toBe(true);
      expect(packed.filePaths.has(json.documentation?.changelog ?? "")).toBe(true);
      expect(packed.filePaths.has(json.documentation?.runtimeUpgrades ?? "")).toBe(true);
      expect(packed.filePaths.has(json.documentation?.jsonContract ?? "")).toBe(true);
    });

    test("status --agent --no-check executes through the packed js runtime path", () => {
      const result = runSmokeCli(["--agent", "status", "--no-check"], { home });
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");

      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        configExists: boolean;
      }>(result.stdout);

      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(true);
      expect(typeof json.configExists).toBe("boolean");
    });

    test("packed js runtime keeps structured unknown-command errors", () => {
      assertUnknownCommandAgentContract(
        runSmokeCli(["--agent", "not-a-command"], { home }),
      );
    });
  });

  test("npm pack keeps the packed runtime bootable and self-contained", () => {
    expect(packed.filePaths.has("dist/index.js")).toBe(true);
    expect(packed.filePaths.has("package.json")).toBe(true);
    expect(packed.filePaths.has("scripts/start-built-cli.mjs")).toBe(true);
    expect(packed.filePaths.has("dist/commands")).toBe(false);
    expect(packed.filePaths.has("dist/output")).toBe(false);
    expect(packed.binPath.endsWith("dist/index.js")).toBe(true);
  }, 30_000);

  test("npm pack includes bundled docs and runtime-owned shipped assets", () => {
    expect(packed.filePaths.has("AGENTS.md")).toBe(true);
    expect(packed.filePaths.has("CHANGELOG.md")).toBe(true);
    expect(packed.filePaths.has("docs/contracts/README.md")).toBe(true);
    expect(packed.filePaths.has("docs/contracts/cli-json-contract.current.json")).toBe(true);
    expect(packed.filePaths.has(jsonContractDocRelativePath())).toBe(true);
    expect(packed.filePaths.has("docs/contracts/cli-json-contract.v1.6.0.json")).toBe(false);
    expect(packed.filePaths.has("docs/reference.md")).toBe(true);
    expect(packed.filePaths.has("docs/runtime-upgrades.md")).toBe(true);
    expect(packed.filePaths.has("skills/privacy-pools-cli/SKILL.md")).toBe(true);
    expect(packed.filePaths.has("skills/privacy-pools-cli/reference.md")).toBe(true);
  }, 30_000);
}, 300_000);
