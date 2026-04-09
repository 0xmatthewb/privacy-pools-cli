import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { generateMerkleProof } from "@0xbow/privacy-pools-core-sdk";
import { createPublicClient, http, parseAbi } from "viem";
import { resolveChain } from "../../src/utils/validation.ts";
import {
  CLI_CWD,
  cliTestInternals,
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import {
  loadSharedAnvilEnv,
  resetSharedAnvilEnv,
  type SharedAnvilEnv,
} from "../helpers/shared-anvil-env.ts";
import {
  appendInsertedStateTreeLeaf,
  approveSharedLabels,
  decodeDepositEvent,
  sharedCliEnv,
} from "../helpers/shared-anvil-cli.ts";

const scriptAvailable =
  process.platform !== "win32" &&
  spawnSync("script", ["-q", "/dev/null", "echo", "ok"], {
    encoding: "utf8",
    timeout: 5_000,
    env: buildChildProcessEnv(),
  }).status === 0;

const ANVIL_E2E_ENABLED = process.env.PP_ANVIL_E2E === "1";
const ptyAnvilTest = ANVIL_E2E_ENABLED && scriptAvailable ? test : test.skip;

const aspPostman = "0x696fe46495688fc9e99bad2daf2133b33de364ea" as const;
const dummyCid = "bafybeigdyrzt5sharedanvile2etests12345678901234567890";
const relayedRecipient = "0x4444444444444444444444444444444444444444" as const;

const entrypointAbi = parseAbi([
  "function updateRoot(uint256 _root, string _ipfsCID) returns (uint256 _index)",
]);

const depositedEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

let sharedEnv: SharedAnvilEnv | null = null;
let anvilClient: ReturnType<typeof createPublicClient> | null = null;
let chainConfig = resolveChain("sepolia");

function requireSharedEnv(): SharedAnvilEnv {
  if (!sharedEnv) {
    throw new Error("Shared Anvil environment is not initialized");
  }
  return sharedEnv;
}

function requireAnvilClient() {
  if (!anvilClient) {
    throw new Error("Anvil client is not initialized");
  }
  return anvilClient;
}

function computeMerkleRoot(leaves: readonly string[]): bigint {
  const normalized = leaves.map((leaf) => BigInt(leaf));
  const proof = generateMerkleProof(
    normalized,
    normalized[normalized.length - 1],
  );
  return BigInt((proof as { root: bigint | string }).root);
}

async function createApprovedPoolAccount(prefix: string): Promise<{
  home: string;
  poolAccountId: string;
}> {
  const home = createTempHome(prefix);
  mustInitSeededHome(home, "sepolia");

  const depositResult = runCli(
    ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
    {
      home,
      timeoutMs: 180_000,
      env: sharedCliEnv(requireSharedEnv()),
    },
  );
  if (depositResult.status !== 0) {
    throw new Error(
      `deposit failed with exit ${depositResult.status}\nstdout:\n${depositResult.stdout}\nstderr:\n${depositResult.stderr}`,
    );
  }

  const depositJson = parseJsonOutput<{
    success: boolean;
    txHash: `0x${string}`;
    poolAccountId: string;
  }>(depositResult.stdout);
  expect(depositJson.success).toBe(true);

  const depositEvent = await decodeDepositEvent({
    publicClient: requireAnvilClient(),
    txHash: depositJson.txHash,
    poolAddress: requireSharedEnv().pools.eth.poolAddress,
    depositedEventAbi,
  });
  appendInsertedStateTreeLeaf(requireSharedEnv(), "eth", depositEvent.commitment);

  await approveSharedLabels({
    env: requireSharedEnv(),
    chain: chainConfig.chain,
    entrypoint: chainConfig.entrypoint,
    entrypointAbi,
    publicClient: requireAnvilClient(),
    postmanAddress: aspPostman,
    labels: [depositEvent.label],
    root: computeMerkleRoot([depositEvent.label.toString()]),
    dummyCid,
    poolKey: "eth",
  });

  const syncedAccounts = runCli(
    ["--agent", "accounts", "--chain", "sepolia"],
    {
      home,
      timeoutMs: 180_000,
      env: sharedCliEnv(requireSharedEnv()),
    },
  );
  if (syncedAccounts.status !== 0) {
    throw new Error(
      `accounts sync failed with exit ${syncedAccounts.status}\nstdout:\n${syncedAccounts.stdout}\nstderr:\n${syncedAccounts.stderr}`,
    );
  }

  return {
    home,
    poolAccountId: depositJson.poolAccountId,
  };
}

function expectOrderedFragments(output: string, fragments: string[]): void {
  let previousIndex = -1;
  for (const fragment of fragments) {
    const index = output.indexOf(fragment);
    expect(index).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}

function sanitizeTerminalTranscript(output: string): string {
  const cleaned = output
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");

  const lines = cleaned
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  return lines.filter((line, index) => index === 0 || line !== lines[index - 1]).join("\n");
}

beforeAll(() => {
  if (!ANVIL_E2E_ENABLED) return;
  sharedEnv = loadSharedAnvilEnv();
  Object.assign(process.env, sharedCliEnv(sharedEnv));
  chainConfig = resolveChain("sepolia");
  anvilClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(sharedEnv.rpcUrl),
  });
});

beforeEach(async () => {
  if (!ANVIL_E2E_ENABLED) return;
  await resetSharedAnvilEnv(requireSharedEnv());
});

describe("proof progress PTY integration", () => {
  ptyAnvilTest("withdraw --dry-run shows proof phases in order during a real proof", async () => {
    const account = await createApprovedPoolAccount("pp-anvil-proof-progress-");
    const builtCli = cliTestInternals.resolveBuiltCliInvocation(CLI_CWD);
    const result = spawnSync("script", [
      "-q",
      "/dev/null",
      process.platform === "win32" ? "node.exe" : "node",
      builtCli.binPath,
      "--no-banner",
      "--yes",
      "withdraw",
      "--dry-run",
      "--all",
      "ETH",
      "--to",
      relayedRecipient,
      "--from-pa",
      account.poolAccountId,
      "--chain",
      "sepolia",
    ], {
      cwd: builtCli.cwd,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 20 * 1024 * 1024,
      env: buildChildProcessEnv({
        ...sharedCliEnv(requireSharedEnv()),
        NO_COLOR: "1",
        TERM: "xterm-256color",
        CI: undefined,
        PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
        PRIVACY_POOLS_CLI_STATIC_SPINNER: "1",
        PRIVACY_POOLS_HOME: join(account.home, ".privacy-pools"),
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout.trim().length).toBeGreaterThan(0);

    const normalizedOutput = sanitizeTerminalTranscript(result.stdout);
    expect(normalizedOutput).toContain("Generate withdrawal proof");
    expect(normalizedOutput).toContain("Building the relayed withdrawal proof.");
    expect(normalizedOutput).toContain(
      "Generating ZK proof... (0s) - verify circuits if needed",
    );

    const expectedPhases = [
      "verify circuits if needed",
      "build witness",
      "generate proof",
      "finalize proof",
    ];
    const observedPhases = expectedPhases.filter((phase) =>
      normalizedOutput.includes(phase)
    );
    expect(observedPhases.length).toBeGreaterThan(0);
    expect(observedPhases[0]).toBe("verify circuits if needed");
    if (observedPhases.length > 1) {
      expectOrderedFragments(normalizedOutput, observedPhases);
    }
  });
});
