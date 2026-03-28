import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createPublicClient, decodeFunctionData, http, parseAbi } from "viem";
import { generateMerkleProof } from "@0xbow/privacy-pools-core-sdk";
import { POA_PORTAL_URL } from "../../src/config/chains.ts";
import { resolveChain } from "../../src/utils/validation.ts";
import { privacyPoolRagequitAbi } from "../../src/utils/unsigned-flows.ts";
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
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
  setSharedLabelReviewStatus,
} from "../helpers/shared-anvil-cli.ts";
import { CARGO_AVAILABLE, ensureNativeShellBinary } from "../helpers/native.ts";

const ANVIL_E2E_ENABLED = process.env.PP_ANVIL_E2E === "1";
const anvilTest = ANVIL_E2E_ENABLED ? test : test.skip;
const nativeAnvilTest = ANVIL_E2E_ENABLED && CARGO_AVAILABLE ? test : test.skip;

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
let nativeBinary: string | null = null;

function requireSharedEnv(): SharedAnvilEnv {
  if (!sharedEnv) throw new Error("Shared Anvil environment is not initialized");
  return sharedEnv;
}

function requireAnvilClient() {
  if (!anvilClient) throw new Error("Anvil client is not initialized");
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

function createAnvilHome(prefix: string): string {
  const home = createTempHome(prefix);
  mustInitSeededHome(home, "sepolia");
  return home;
}

function runAnvilCli(home: string, args: string[], timeoutMs = 180_000) {
  return runCli(args, {
    home,
    timeoutMs,
    env: sharedCliEnv(requireSharedEnv()),
  });
}

function requireNativeBinary(): string {
  if (!nativeBinary) {
    throw new Error("Native shell binary is not initialized");
  }
  return nativeBinary;
}

function runNativeAnvilCli(home: string, args: string[], timeoutMs = 180_000) {
  return runCli(args, {
    home,
    timeoutMs,
    env: {
      ...sharedCliEnv(requireSharedEnv()),
      PRIVACY_POOLS_CLI_BINARY: requireNativeBinary(),
    },
  });
}

function expectSuccessStatus(
  result: { status: number | null; stdout: string; stderr: string },
  label: string,
): void {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

function parseSuccessfulAgentResult<T>(
  home: string,
  args: string[],
  label: string,
  timeoutMs?: number,
): T {
  const result = runAnvilCli(home, args, timeoutMs);
  expectSuccessStatus(result, label);
  return parseJsonOutput<T>(result.stdout);
}

function parseSuccessfulNativeAgentResult<T>(
  home: string,
  args: string[],
  label: string,
  timeoutMs?: number,
): T {
  const result = runNativeAnvilCli(home, args, timeoutMs);
  expectSuccessStatus(result, label);
  return parseJsonOutput<T>(result.stdout);
}

async function approveEthLabel(label: bigint): Promise<void> {
  await approveSharedLabels({
    env: requireSharedEnv(),
    chain: chainConfig.chain,
    entrypoint: chainConfig.entrypoint,
    entrypointAbi,
    publicClient: requireAnvilClient(),
    postmanAddress: aspPostman,
    labels: [label],
    root: computeMerkleRoot([label.toString()]),
    dummyCid,
    poolKey: "eth",
  });
}

async function createDepositedPoolAccount(prefix: string): Promise<{
  home: string;
  poolAccountId: string;
  txHash: `0x${string}`;
  label: bigint;
}> {
  const home = createAnvilHome(prefix);
  const depositJson = parseSuccessfulAgentResult<{
    success: boolean;
    txHash: `0x${string}`;
    poolAccountId: string;
  }>(
    home,
    ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
    "deposit",
  );
  expect(depositJson.success).toBe(true);

  const depositEvent = await decodeDepositEvent({
    publicClient: requireAnvilClient(),
    txHash: depositJson.txHash,
    poolAddress: requireSharedEnv().pools.eth.poolAddress,
    depositedEventAbi,
  });
  appendInsertedStateTreeLeaf(requireSharedEnv(), "eth", depositEvent.commitment);

  return {
    home,
    poolAccountId: depositJson.poolAccountId,
    txHash: depositJson.txHash,
    label: depositEvent.label,
  };
}

beforeAll(async () => {
  if (!ANVIL_E2E_ENABLED) return;
  if (CARGO_AVAILABLE) {
    nativeBinary = ensureNativeShellBinary();
  }
  sharedEnv = loadSharedAnvilEnv();
  Object.assign(process.env, sharedCliEnv(sharedEnv));
  chainConfig = resolveChain("sepolia");
  anvilClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(sharedEnv.rpcUrl),
  });
  await resetSharedAnvilEnv(sharedEnv);
});

beforeEach(async () => {
  if (!ANVIL_E2E_ENABLED) return;
  await resetSharedAnvilEnv(requireSharedEnv());
});

describe("Anvil E2E", () => {
  anvilTest("deposit -> sync -> accounts -> ragequit -> sync", async () => {
    const deposit = await createDepositedPoolAccount("pp-anvil-eth-ragequit-");

    const pendingAccounts = parseSuccessfulAgentResult<{
      pendingCount: number;
      accounts: Array<{ poolAccountId: string }>;
    }>(
      deposit.home,
      ["--agent", "accounts", "--pending-only", "--chain", "sepolia"],
      "accounts pending",
    );
    expect(pendingAccounts.pendingCount).toBeGreaterThan(0);
    expect(pendingAccounts.accounts.some((account) => account.poolAccountId === deposit.poolAccountId)).toBe(true);

    const ragequitJson = parseSuccessfulAgentResult<{
      success: boolean;
      operation: string;
      txHash: string;
    }>(
      deposit.home,
      [
        "--agent",
        "ragequit",
        "ETH",
        "--from-pa",
        deposit.poolAccountId,
        "--chain",
        "sepolia",
      ],
      "ragequit",
    );
    expect(ragequitJson.success).toBe(true);
    expect(ragequitJson.operation).toBe("ragequit");
    expect(ragequitJson.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    parseSuccessfulAgentResult(
      deposit.home,
      ["--agent", "sync", "--asset", "ETH", "--chain", "sepolia"],
      "sync after ragequit",
    );

    const accountsAfterRagequit = parseSuccessfulAgentResult<{
      accounts: Array<{ poolAccountId: string; status: string }>;
      balances: Array<{ asset: string; balance: string }>;
    }>(
      deposit.home,
      ["--agent", "accounts", "--details", "--chain", "sepolia"],
      "accounts after ragequit",
    );
    expect(
      accountsAfterRagequit.accounts.some(
        (account) =>
          account.poolAccountId === deposit.poolAccountId &&
          account.status === "exited",
      ),
    ).toBe(true);
    expect(
      accountsAfterRagequit.balances.some(
        (balance) => balance.asset === "ETH" && balance.balance !== "0",
      ),
    ).toBe(false);

    const history = parseSuccessfulAgentResult<{
      events: Array<{ type: string; poolAccountId: string }>;
    }>(
      deposit.home,
      ["--agent", "history", "--chain", "sepolia"],
      "history after ragequit",
    );
    expect(
      history.events.some(
        (event) =>
          event.type === "ragequit" &&
          event.poolAccountId === deposit.poolAccountId,
      ),
    ).toBe(true);
  });

  anvilTest("deposit -> approve -> withdraw (relayed) -> sync", async () => {
    const deposit = await createDepositedPoolAccount("pp-anvil-eth-withdraw-");
    await approveEthLabel(deposit.label);

    const withdrawJson = parseSuccessfulAgentResult<{
      success: boolean;
      operation: string;
      mode: string;
      txHash: string;
      remainingBalance: string;
    }>(
      deposit.home,
      [
        "--agent",
        "withdraw",
        "--all",
        "ETH",
        "--to",
        relayedRecipient,
        "--from-pa",
        deposit.poolAccountId,
        "--chain",
        "sepolia",
      ],
      "withdraw",
      300_000,
    );
    expect(withdrawJson.success).toBe(true);
    expect(withdrawJson.operation).toBe("withdraw");
    expect(withdrawJson.mode).toBe("relayed");
    expect(withdrawJson.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(withdrawJson.remainingBalance).toBe("0");

    parseSuccessfulAgentResult(
      deposit.home,
      ["--agent", "sync", "--asset", "ETH", "--chain", "sepolia"],
      "sync after withdraw",
    );

    const accountsAfterWithdraw = parseSuccessfulAgentResult<{
      accounts: Array<{ poolAccountId: string; status: string }>;
      balances: Array<{ asset: string; balance: string }>;
    }>(
      deposit.home,
      ["--agent", "accounts", "--details", "--chain", "sepolia"],
      "accounts after withdraw",
    );
    expect(
      accountsAfterWithdraw.accounts.some(
        (account) =>
          account.poolAccountId === deposit.poolAccountId &&
          account.status === "spent",
      ),
    ).toBe(true);
    expect(
      accountsAfterWithdraw.balances.some(
        (balance) => balance.asset === "ETH" && balance.balance !== "0",
      ),
    ).toBe(false);

    const history = parseSuccessfulAgentResult<{
      events: Array<{ type: string; poolAccountId: string }>;
    }>(
      deposit.home,
      ["--agent", "history", "--chain", "sepolia"],
      "history after withdraw",
    );
    expect(
      history.events.some(
        (event) =>
          event.type === "withdrawal" &&
          event.poolAccountId === deposit.poolAccountId,
      ),
    ).toBe(true);
  });

  anvilTest("flow start -> approved watch -> completed", async () => {
    const home = createAnvilHome("pp-anvil-eth-flow-");
    const flowJson = parseSuccessfulAgentResult<{
      success: boolean;
      mode: string;
      action: string;
      workflowId: string;
      depositTxHash: `0x${string}`;
    }>(
      home,
      [
        "--agent",
        "flow",
        "start",
        "0.01",
        "ETH",
        "--to",
        relayedRecipient,
        "--chain",
        "sepolia",
      ],
      "flow start",
      300_000,
    );
    expect(flowJson.success).toBe(true);
    expect(flowJson.mode).toBe("flow");
    expect(flowJson.action).toBe("start");

    const depositEvent = await decodeDepositEvent({
      publicClient: requireAnvilClient(),
      txHash: flowJson.depositTxHash,
      poolAddress: requireSharedEnv().pools.eth.poolAddress,
      depositedEventAbi,
    });
    appendInsertedStateTreeLeaf(requireSharedEnv(), "eth", depositEvent.commitment);
    await approveEthLabel(depositEvent.label);

    const watched = parseSuccessfulAgentResult<{
      success: boolean;
      phase: string;
      withdrawTxHash: string;
    }>(
      home,
      ["--agent", "flow", "watch", "latest", "--chain", "sepolia"],
      "flow watch",
      300_000,
    );
    expect(watched.success).toBe(true);
    expect(watched.phase).toBe("completed");
    expect(watched.withdrawTxHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  nativeAnvilTest("native launcher: deposit -> sync -> accounts -> ragequit -> sync", async () => {
    const deposit = await createDepositedPoolAccount("pp-anvil-native-eth-ragequit-");

    const pendingAccounts = parseSuccessfulNativeAgentResult<{
      pendingCount: number;
      accounts: Array<{ poolAccountId: string }>;
    }>(
      deposit.home,
      ["--agent", "accounts", "--pending-only", "--chain", "sepolia"],
      "native accounts pending",
    );
    expect(pendingAccounts.pendingCount).toBeGreaterThan(0);
    expect(
      pendingAccounts.accounts.some(
        (account) => account.poolAccountId === deposit.poolAccountId,
      ),
    ).toBe(true);

    const ragequitJson = parseSuccessfulNativeAgentResult<{
      success: boolean;
      operation: string;
      txHash: string;
    }>(
      deposit.home,
      [
        "--agent",
        "ragequit",
        "ETH",
        "--from-pa",
        deposit.poolAccountId,
        "--chain",
        "sepolia",
      ],
      "native ragequit",
    );
    expect(ragequitJson.success).toBe(true);
    expect(ragequitJson.operation).toBe("ragequit");
    expect(ragequitJson.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    parseSuccessfulNativeAgentResult(
      deposit.home,
      ["--agent", "sync", "--asset", "ETH", "--chain", "sepolia"],
      "native sync after ragequit",
    );

    const accountsAfterRagequit = parseSuccessfulNativeAgentResult<{
      accounts: Array<{ poolAccountId: string; status: string }>;
      balances: Array<{ asset: string; balance: string }>;
    }>(
      deposit.home,
      ["--agent", "accounts", "--details", "--chain", "sepolia"],
      "native accounts after ragequit",
    );
    expect(
      accountsAfterRagequit.accounts.some(
        (account) =>
          account.poolAccountId === deposit.poolAccountId &&
          account.status === "exited",
      ),
    ).toBe(true);
    expect(
      accountsAfterRagequit.balances.some(
        (balance) => balance.asset === "ETH" && balance.balance !== "0",
      ),
    ).toBe(false);

    const history = parseSuccessfulNativeAgentResult<{
      events: Array<{ type: string; poolAccountId: string }>;
    }>(
      deposit.home,
      ["--agent", "history", "--chain", "sepolia"],
      "native history after ragequit",
    );
    expect(
      history.events.some(
        (event) =>
          event.type === "ragequit" &&
          event.poolAccountId === deposit.poolAccountId,
      ),
    ).toBe(true);
  });

  nativeAnvilTest("native launcher: deposit -> approve -> withdraw (relayed) -> sync", async () => {
    const deposit = await createDepositedPoolAccount("pp-anvil-native-eth-withdraw-");
    await approveEthLabel(deposit.label);

    const withdrawJson = parseSuccessfulNativeAgentResult<{
      success: boolean;
      operation: string;
      mode: string;
      txHash: string;
      remainingBalance: string;
    }>(
      deposit.home,
      [
        "--agent",
        "withdraw",
        "--all",
        "ETH",
        "--to",
        relayedRecipient,
        "--from-pa",
        deposit.poolAccountId,
        "--chain",
        "sepolia",
      ],
      "native withdraw",
      300_000,
    );
    expect(withdrawJson.success).toBe(true);
    expect(withdrawJson.operation).toBe("withdraw");
    expect(withdrawJson.mode).toBe("relayed");
    expect(withdrawJson.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(withdrawJson.remainingBalance).toBe("0");

    parseSuccessfulNativeAgentResult(
      deposit.home,
      ["--agent", "sync", "--asset", "ETH", "--chain", "sepolia"],
      "native sync after withdraw",
    );

    const accountsAfterWithdraw = parseSuccessfulNativeAgentResult<{
      accounts: Array<{ poolAccountId: string; status: string }>;
      balances: Array<{ asset: string; balance: string }>;
    }>(
      deposit.home,
      ["--agent", "accounts", "--details", "--chain", "sepolia"],
      "native accounts after withdraw",
    );
    expect(
      accountsAfterWithdraw.accounts.some(
        (account) =>
          account.poolAccountId === deposit.poolAccountId &&
          account.status === "spent",
      ),
    ).toBe(true);
    expect(
      accountsAfterWithdraw.balances.some(
        (balance) => balance.asset === "ETH" && balance.balance !== "0",
      ),
    ).toBe(false);

    const history = parseSuccessfulNativeAgentResult<{
      events: Array<{ type: string; poolAccountId: string }>;
    }>(
      deposit.home,
      ["--agent", "history", "--chain", "sepolia"],
      "native history after withdraw",
    );
    expect(
      history.events.some(
        (event) =>
          event.type === "withdrawal" &&
          event.poolAccountId === deposit.poolAccountId,
      ),
    ).toBe(true);
  });

  nativeAnvilTest("native launcher: flow start -> approved watch -> completed", async () => {
    const home = createAnvilHome("pp-anvil-native-eth-flow-");
    const flowJson = parseSuccessfulNativeAgentResult<{
      success: boolean;
      mode: string;
      action: string;
      workflowId: string;
      depositTxHash: `0x${string}`;
    }>(
      home,
      [
        "--agent",
        "flow",
        "start",
        "0.01",
        "ETH",
        "--to",
        relayedRecipient,
        "--chain",
        "sepolia",
      ],
      "native flow start",
      300_000,
    );
    expect(flowJson.success).toBe(true);
    expect(flowJson.mode).toBe("flow");
    expect(flowJson.action).toBe("start");

    const depositEvent = await decodeDepositEvent({
      publicClient: requireAnvilClient(),
      txHash: flowJson.depositTxHash,
      poolAddress: requireSharedEnv().pools.eth.poolAddress,
      depositedEventAbi,
    });
    appendInsertedStateTreeLeaf(requireSharedEnv(), "eth", depositEvent.commitment);
    await approveEthLabel(depositEvent.label);

    const watched = parseSuccessfulNativeAgentResult<{
      success: boolean;
      phase: string;
      withdrawTxHash: string;
    }>(
      home,
      ["--agent", "flow", "watch", "latest", "--chain", "sepolia"],
      "native flow watch",
      300_000,
    );
    expect(watched.success).toBe(true);
    expect(watched.phase).toBe("completed");
    expect(watched.withdrawTxHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  anvilTest("declined deposits fail closed with ragequit guidance", async () => {
    const deposit = await createDepositedPoolAccount("pp-anvil-eth-declined-");
    setSharedLabelReviewStatus(
      requireSharedEnv(),
      "eth",
      deposit.label,
      "declined",
    );

    const result = runAnvilCli(
      deposit.home,
      [
        "--agent",
        "withdraw",
        "--all",
        "ETH",
        "--to",
        relayedRecipient,
        "--from-pa",
        deposit.poolAccountId,
        "--chain",
        "sepolia",
      ],
    );
    expect(result.status).toBe(4);
    const payload = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      error: { hint?: string };
    }>(result.stdout);
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe("ACCOUNT_NOT_APPROVED");
    expect(payload.error.hint).toContain("ragequit");
  });

  anvilTest("poi_required deposits fail closed with portal guidance", async () => {
    const deposit = await createDepositedPoolAccount("pp-anvil-eth-poi-");
    setSharedLabelReviewStatus(
      requireSharedEnv(),
      "eth",
      deposit.label,
      "poi_required",
    );

    const result = runAnvilCli(
      deposit.home,
      [
        "--agent",
        "withdraw",
        "--all",
        "ETH",
        "--to",
        relayedRecipient,
        "--from-pa",
        deposit.poolAccountId,
        "--chain",
        "sepolia",
      ],
    );
    expect(result.status).toBe(4);
    const payload = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      error: { hint?: string };
    }>(result.stdout);
    expect(payload.success).toBe(false);
    expect(payload.errorCode).toBe("ACCOUNT_NOT_APPROVED");
    expect(payload.error.hint).toContain(POA_PORTAL_URL);
  });

  anvilTest("deposit -> ragequit --unsigned and --dry-run", async () => {
    const deposit = await createDepositedPoolAccount("pp-anvil-eth-unsigned-");

    const unsigned = parseSuccessfulAgentResult<
      Array<{
        to: string;
        data: string;
        value: string;
        chainId: number;
        description: string;
      }>
    >(
      deposit.home,
      [
        "--agent",
        "ragequit",
        "ETH",
        "--from-pa",
        deposit.poolAccountId,
        "--chain",
        "sepolia",
        "--unsigned",
        "tx",
      ],
      "ragequit unsigned",
      300_000,
    );
    expect(unsigned).toHaveLength(1);
    expect(unsigned[0]?.to.toLowerCase()).toBe(
      requireSharedEnv().pools.eth.poolAddress.toLowerCase(),
    );
    expect(unsigned[0]?.data.startsWith("0x")).toBe(true);
    expect(unsigned[0]?.value).toBe("0");
    expect(unsigned[0]?.chainId).toBe(chainConfig.id);
    const decoded = decodeFunctionData({
      abi: privacyPoolRagequitAbi,
      data: unsigned[0]!.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("ragequit");

    const dryRun = parseSuccessfulAgentResult<{
      success: boolean;
      dryRun: boolean;
      operation: string;
    }>(
      deposit.home,
      [
        "--agent",
        "ragequit",
        "ETH",
        "--from-pa",
        deposit.poolAccountId,
        "--chain",
        "sepolia",
        "--dry-run",
      ],
      "ragequit dry-run",
      300_000,
    );
    expect(dryRun.success).toBe(true);
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.operation).toBe("ragequit");
  });
});
