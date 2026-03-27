import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CLI_CWD,
  type CliRunOptions,
  type CliRunResult,
  createTempHome,
  parseJsonOutput,
} from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { npmBin } from "../helpers/npm-bin.ts";
import {
  killSyncGateRpcServer,
  launchSyncGateRpcServer,
  type SyncGateRpcServer,
} from "../helpers/sync-gate-rpc-server.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import { createBuiltWorkspaceSnapshot } from "../helpers/workspace-snapshot.ts";
import {
  interruptChildProcess,
  terminateChildProcess,
} from "../helpers/process.ts";
import { waitForWorkflowSnapshotPhase } from "../helpers/workflow-snapshot.ts";
import { CHAINS, NATIVE_ASSET_ADDRESS } from "../../src/config/chains.ts";
import {
  JSON_SCHEMA_VERSION,
  jsonContractDocRelativePath,
} from "../../src/utils/json.ts";

const PACKAGED_SMOKE_POOL =
  "0x1234567890abcdef1234567890abcdef12345678" as const;

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

interface PackedArtifact {
  packageRoot: string;
  binPath: string;
  filePaths: Set<string>;
}

function sourcePackageJson(): {
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
} {
  return JSON.parse(
    readFileSync(join(CLI_CWD, "package.json"), "utf8"),
  ) as {
    bin?: string | Record<string, string>;
    dependencies?: Record<string, string>;
  };
}

function linkDeclaredProdDependencies(packageRoot: string): void {
  const sourcePkg = sourcePackageJson();
  const nodeModulesRoot = join(packageRoot, "node_modules");
  mkdirSync(nodeModulesRoot, { recursive: true });

  for (const depName of Object.keys(sourcePkg.dependencies ?? {})) {
    const sourcePath = join(CLI_CWD, "node_modules", depName);
    const targetPath = join(nodeModulesRoot, depName);

    if (depName.startsWith("@")) {
      mkdirSync(join(nodeModulesRoot, depName.split("/")[0]!), { recursive: true });
    }

    symlinkSync(
      sourcePath,
      targetPath,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}

async function waitForCondition<T>(
  label: string,
  fn: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs: number = 15_000,
  intervalMs: number = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null && value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function packAndExtractCli(packRoot: string): PackedArtifact {
  const extractDir = createTrackedTempDir("pp-smoke-extract-");

  const pack = spawnSync(
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
  expect(pack.status).toBe(0);

  const tarballName = pack.stdout.trim().split(/\r?\n/g).pop()?.trim();
  expect(tarballName).toBeTruthy();

  const tarballPath = join(packRoot, tarballName!);
  const extract = spawnSync("tar", ["-xzf", tarballPath, "-C", extractDir], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    env: buildChildProcessEnv(),
  });
  expect(extract.status).toBe(0);

  const packageRoot = join(extractDir, "package");
  // Keep smoke deterministic and offline by linking only declared prod deps.
  // This still catches undeclared direct runtime imports that a full
  // workspace node_modules symlink would mask.
  linkDeclaredProdDependencies(packageRoot);

  const listedFiles = spawnSync("tar", ["-tzf", tarballPath], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    env: buildChildProcessEnv(),
  });
  expect(listedFiles.status).toBe(0);
  const filePaths = new Set(
    listedFiles.stdout
      .trim()
      .split(/\r?\n/g)
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.replace(/^package\//, "")),
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
    filePaths,
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

function writeWorkflow(home: string, workflow: Record<string, unknown>): void {
  const workflowDir = join(home, ".privacy-pools", "workflows");
  mkdirSync(workflowDir, { recursive: true });
  writeFileSync(
    join(workflowDir, `${workflow.workflowId as string}.json`),
    JSON.stringify(workflow, null, 2),
    "utf8",
  );
}

describe("packaged CLI smoke", () => {
  let home: string;
  let packed: PackedArtifact;
  let syncGateRpc: SyncGateRpcServer | null = null;

  beforeAll(async () => {
    const packRoot = createBuiltWorkspaceSnapshot();
    packed = packAndExtractCli(packRoot);
    home = createTempHome("pp-smoke-dist-");
    syncGateRpc = await launchSyncGateRpcServer({
      chainId: CHAINS.sepolia.id,
      entrypoint: CHAINS.sepolia.entrypoint,
      poolAddress: PACKAGED_SMOKE_POOL,
      scope: 12345n,
      assetAddress: NATIVE_ASSET_ADDRESS,
      assetSymbol: "ETH",
      assetDecimals: 18,
      gasPrice: 1n,
      nativeBalance: 0n,
      validDepositLog: true,
    });
  }, 240_000);

  afterAll(async () => {
    if (syncGateRpc) {
      await killSyncGateRpcServer(syncGateRpc);
    }
  });

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

    test("describe --agent: JSON success on stdout, stderr empty", () => {
      const result = runSmokeCli(["--agent", "describe", "withdraw", "quote"], {
        home,
      });
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        command: string;
        usage: string;
      }>(result.stdout);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(true);
      expect(json.command).toBe("withdraw quote");
      expect(json.usage).toBe("withdraw quote <amount|asset> [amount]");
    });
  });

  describe("init happy path", () => {
    test("init --agent --show-mnemonic succeeds from the packed artifact", () => {
      const initHome = createTempHome("pp-smoke-init-");
      const initResult = runSmokeCli(
        ["--agent", "init", "--show-mnemonic", "--default-chain", "sepolia"],
        { home: initHome, timeoutMs: 60_000 },
      );
      expect(initResult.status).toBe(0);
      expect(initResult.stderr.trim()).toBe("");

      const initJson = parseJsonOutput<{
        success: boolean;
        defaultChain: string;
        recoveryPhrase?: string;
      }>(initResult.stdout);
      expect(initJson.success).toBe(true);
      expect(initJson.defaultChain).toBe("sepolia");
      expect(typeof initJson.recoveryPhrase).toBe("string");
      expect(initJson.recoveryPhrase?.trim().split(/\s+/).length).toBe(24);

      const statusResult = runSmokeCli(["--agent", "status"], { home: initHome });
      expect(statusResult.status).toBe(0);
      const statusJson = parseJsonOutput<{
        success: boolean;
        configExists: boolean;
        recoveryPhraseSet: boolean;
      }>(statusResult.stdout);
      expect(statusJson.success).toBe(true);
      expect(statusJson.configExists).toBe(true);
      expect(statusJson.recoveryPhraseSet).toBe(true);
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

    test("flow start --agent without --to: INPUT_ERROR exit 2", () => {
      const result = runSmokeCli(["--agent", "flow", "start", "0.1", "ETH"], { home });
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

  describe("saved flow smoke", () => {
    test("flow start --new-wallet persists an awaiting_funding workflow from the packed artifact", async () => {
      const flowHome = createTempHome("pp-smoke-flow-start-");
      const exportPath = join(flowHome, "workflow-wallet.txt");
      const initResult = runSmokeCli(
        ["--agent", "init", "--show-mnemonic", "--default-chain", "sepolia"],
        { home: flowHome, timeoutMs: 60_000 },
      );
      expect(initResult.status).toBe(0);

      const child = spawn(
        "node",
        [
          packed.binPath,
          "--agent",
          "--chain",
          "sepolia",
          "--rpc-url",
          syncGateRpc!.url,
          "flow",
          "start",
          "0.1",
          "ETH",
          "--to",
          "0x4444444444444444444444444444444444444444",
          "--new-wallet",
          "--export-new-wallet",
          exportPath,
        ],
        {
          cwd: packed.packageRoot,
          env: buildChildProcessEnv({
            PRIVACY_POOLS_HOME: join(flowHome, ".privacy-pools"),
          }),
          stdio: "ignore",
        },
      );

      try {
        const snapshot = await waitForWorkflowSnapshotPhase(flowHome, "awaiting_funding");
        const backupText = await waitForCondition(
          "workflow wallet backup",
          () => (existsSync(exportPath) ? readFileSync(exportPath, "utf8") : null),
        );
        expect(backupText).toContain("Privacy Pools Flow Wallet");
        expect(snapshot.workflowId).toBeTruthy();
        expect(snapshot.phase).toBe("awaiting_funding");
        expect(snapshot.walletMode).toBe("new_wallet");
        expect(snapshot.backupConfirmed).toBe(true);
        expect(snapshot.requiredNativeFunding).toBeTruthy();
        expect(snapshot.depositTxHash).toBeNull();

        await interruptChildProcess(child);

        const statusResult = runSmokeCli(["--agent", "flow", "status", "latest"], {
          home: flowHome,
        });
        expect(statusResult.status).toBe(0);
        const statusJson = parseJsonOutput<{
          success: boolean;
          workflowId: string;
          phase: string;
          walletMode: string;
        }>(statusResult.stdout);
        expect(statusJson.success).toBe(true);
        expect(statusJson.workflowId).toBe(snapshot.workflowId);
        expect(statusJson.phase).toBe("awaiting_funding");
        expect(statusJson.walletMode).toBe("new_wallet");
      } finally {
        await terminateChildProcess(child);
      }
    });

    test("flow status latest --agent reads the saved workflow from the packed artifact", () => {
      const flowHome = createTempHome("pp-smoke-flow-status-");
      writeWorkflow(flowHome, {
        schemaVersion: "1.5.0",
        workflowId: "wf-latest",
        createdAt: "2026-03-24T12:00:00.000Z",
        updatedAt: "2026-03-24T12:05:00.000Z",
        phase: "paused_declined",
        chain: "sepolia",
        asset: "ETH",
        assetDecimals: 18,
        depositAmount: "10000000000000000",
        recipient: "0x4444444444444444444444444444444444444444",
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
        depositTxHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        depositBlockNumber: "12345",
        depositExplorerUrl: "https://example.test/deposit",
        committedValue: "9950000000000000",
        aspStatus: "declined",
      });

      const result = runSmokeCli(["--agent", "flow", "status", "latest"], {
        home: flowHome,
      });
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");

      const json = parseJsonOutput<{
        success: boolean;
        mode: string;
        action: string;
        workflowId: string;
        phase: string;
      }>(result.stdout);
      expect(json.success).toBe(true);
      expect(json.mode).toBe("flow");
      expect(json.action).toBe("status");
      expect(json.workflowId).toBe("wf-latest");
      expect(json.phase).toBe("paused_declined");
    });

    test("flow watch latest --agent resolves the newest saved workflow", () => {
      const flowHome = createTempHome("pp-smoke-flow-watch-");
      writeWorkflow(flowHome, {
        schemaVersion: "1.5.0",
        workflowId: "wf-older",
        createdAt: "2026-03-24T12:00:00.000Z",
        updatedAt: "2026-03-24T12:00:00.000Z",
        phase: "completed",
        chain: "sepolia",
        asset: "ETH",
        assetDecimals: 18,
        depositAmount: "10000000000000000",
        recipient: "0x4444444444444444444444444444444444444444",
        poolAccountId: "PA-1",
        poolAccountNumber: 1,
      });
      writeWorkflow(flowHome, {
        schemaVersion: "1.5.0",
        workflowId: "wf-latest",
        createdAt: "2026-03-24T12:00:00.000Z",
        updatedAt: "2026-03-24T12:10:00.000Z",
        phase: "completed",
        chain: "sepolia",
        asset: "ETH",
        assetDecimals: 18,
        depositAmount: "10000000000000000",
        recipient: "0x4444444444444444444444444444444444444444",
        poolAccountId: "PA-2",
        poolAccountNumber: 2,
        withdrawTxHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        withdrawBlockNumber: "12399",
        withdrawExplorerUrl: "https://example.test/withdraw",
      });

      const result = runSmokeCli(["--agent", "flow", "watch", "latest"], {
        home: flowHome,
      });
      expect(result.status).toBe(0);
      expect(result.stderr.trim()).toBe("");

      const json = parseJsonOutput<{
        success: boolean;
        workflowId: string;
        phase: string;
      }>(result.stdout);
      expect(json.success).toBe(true);
      expect(json.workflowId).toBe("wf-latest");
      expect(json.phase).toBe("completed");
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
    const packedCommandNames = packedBaseNames(packed.filePaths, "dist/commands/");
    const packedOutputNames = packedBaseNames(packed.filePaths, "dist/output/");
    const sourcePkg = sourcePackageJson() as { bin?: unknown; dependencies?: unknown };
    const packedPkg = JSON.parse(
      readFileSync(join(packed.packageRoot, "package.json"), "utf8"),
    ) as { bin?: unknown; dependencies?: unknown };

    expect(packed.filePaths.has("dist/index.js")).toBe(true);
    expect(packed.filePaths.has("package.json")).toBe(true);
    expect(packed.filePaths.has("scripts/start-built-cli.mjs")).toBe(true);
    expect(packedCommandNames).toEqual(sourceBaseNames("src/commands"));
    expect(packedOutputNames).toEqual(sourceBaseNames("src/output"));
    expect(packedPkg.bin).toEqual(sourcePkg.bin);
    expect(packedPkg.dependencies).toEqual(sourcePkg.dependencies);
  }, 30_000);

  test("npm pack includes docs referenced by shipped docs and capabilities", () => {
    expect(packed.filePaths.has("AGENTS.md")).toBe(true);
    expect(packed.filePaths.has("CHANGELOG.md")).toBe(true);
    expect(packed.filePaths.has(jsonContractDocRelativePath())).toBe(true);
    expect(packed.filePaths.has("docs/reference.md")).toBe(true);
    expect(packed.filePaths.has("docs/runtime-upgrades.md")).toBe(true);
    expect(packed.filePaths.has("skills/privacy-pools-cli/SKILL.md")).toBe(true);
    expect(packed.filePaths.has("skills/privacy-pools-cli/reference.md")).toBe(true);

    const capabilities = runSmokeCli(["--agent", "capabilities"], { home });
    expect(capabilities.status).toBe(0);
    const json = parseJsonOutput<{
      documentation?: {
        reference?: string;
        agentGuide?: string;
        changelog?: string;
        runtimeUpgrades?: string;
        jsonContract?: string;
      };
    }>(capabilities.stdout);

    expect(packed.filePaths.has(json.documentation?.reference ?? "")).toBe(true);
    expect(packed.filePaths.has(json.documentation?.agentGuide ?? "")).toBe(true);
    expect(packed.filePaths.has(json.documentation?.changelog ?? "")).toBe(true);
    expect(packed.filePaths.has(json.documentation?.runtimeUpgrades ?? "")).toBe(true);
    expect(packed.filePaths.has(json.documentation?.jsonContract ?? "")).toBe(true);
  }, 30_000);
}, 300_000);
