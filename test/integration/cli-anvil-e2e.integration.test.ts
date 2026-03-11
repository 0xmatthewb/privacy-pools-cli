import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { generateMerkleProof } from "@0xbow/privacy-pools-core-sdk";
import { CHAINS, NATIVE_ASSET_ADDRESS } from "../../src/config/chains.ts";
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import {
  launchAnvil,
  killAnvil,
  impersonateAccount,
  revertState,
  setBalance,
  snapshotState,
  stopImpersonatingAccount,
  type AnvilInstance,
} from "../helpers/anvil.ts";
import {
  killAnvilAspServer,
  launchAnvilAspServer,
  writeAnvilAspState,
  type AnvilAspServer,
  type AnvilAspState,
} from "../helpers/anvil-asp-server.ts";
import {
  killAnvilRelayerServer,
  launchAnvilRelayerServer,
  type AnvilRelayerServer,
} from "../helpers/anvil-relayer-server.ts";

const ANVIL_E2E_ENABLED = process.env.PP_ANVIL_E2E === "1";
const anvilTest = ANVIL_E2E_ENABLED ? test : test.skip;

const chainConfig = CHAINS.sepolia;
const DEFAULT_ANVIL_FORK_URL = "https://sepolia.gateway.tenderly.co";
const forkUrl = process.env.PP_ANVIL_FORK_URL?.trim() || DEFAULT_ANVIL_FORK_URL;
const signerPrivateKey =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const signerAddress = privateKeyToAccount(signerPrivateKey).address;
const relayerPrivateKey =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
const relayerAddress = privateKeyToAccount(relayerPrivateKey).address;
const aspPostman = "0x696fe46495688fc9e99bad2daf2133b33de364ea" as const;
const dummyCid = "bafybeigdyrzt5dummycidforanviltests12345678901234567890";
const relayedRecipient = "0x4444444444444444444444444444444444444444" as const;

const entrypointAbi = parseAbi([
  "function assetConfig(address) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)",
  "function updateRoot(uint256 _root, string _ipfsCID) returns (uint256 _index)",
]);

const poolAbi = parseAbi([
  "function SCOPE() view returns (uint256)",
  "function currentRoot() view returns (uint256)",
]);

const depositedEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

const withdrawnEventAbi = parseAbi([
  "event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)",
]);
const depositedEventTopic =
  "0xe3b53cd1a44fbf11535e145d80b8ef1ed6d57a73bf5daa7e939b6b01657d6549";
const RANGE_LIMIT_PATTERNS = [
  "ranges over 10000 blocks",
  "exceed maximum block range",
  "eth_getLogs is limited",
] as const;

let anvil: AnvilInstance | null = null;
let aspServer: AnvilAspServer | null = null;
let relayerServer: AnvilRelayerServer | null = null;
let anvilClient: ReturnType<typeof createPublicClient> | null = null;
let poolAddress: `0x${string}`;
let poolScope: bigint;
let baseStateTreeLeaves: string[] = [];
let aspStateFile = "";
let circuitsDir = "";
let baselineSnapshotId = "";
let aspState: AnvilAspState | null = null;

function ensureEnabled(): void {
  if (!ANVIL_E2E_ENABLED) {
    throw new Error("PP_ANVIL_E2E must be set to 1 to run Anvil E2E tests");
  }
}

function requireAnvil(): AnvilInstance {
  if (!anvil) throw new Error("Anvil is not running");
  return anvil;
}

function requireAspServer(): AnvilAspServer {
  if (!aspServer) throw new Error("Anvil ASP server is not running");
  return aspServer;
}

function requireRelayerServer(): AnvilRelayerServer {
  if (!relayerServer) throw new Error("Anvil relayer server is not running");
  return relayerServer;
}

function requireAnvilClient() {
  if (!anvilClient) throw new Error("Anvil client is not initialized");
  return anvilClient;
}

function requireAspState(): AnvilAspState {
  if (!aspState) throw new Error("ASP state is not initialized");
  return aspState;
}

function computeMerkleRoot(leaves: readonly string[]): bigint {
  if (leaves.length === 0) {
    throw new Error("Cannot compute a Merkle root for an empty leaf set");
  }
  const normalized = leaves.map((leaf) => BigInt(leaf));
  const proof = generateMerkleProof(normalized, normalized[normalized.length - 1]);
  return BigInt((proof as { root: bigint | string }).root);
}

async function fetchStateTreeLeaves(scope: bigint): Promise<string[]> {
  const response = await fetch(`${chainConfig.aspHost}/${chainConfig.id}/public/mt-leaves`, {
    headers: {
      "X-Pool-Scope": scope.toString(),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ASP leaves: HTTP ${response.status}`);
  }

  const payload = await response.json() as { stateTreeLeaves?: string[] };
  if (!payload.stateTreeLeaves || payload.stateTreeLeaves.length === 0) {
    throw new Error("ASP returned an empty state tree");
  }

  return payload.stateTreeLeaves;
}

async function captureSnapshot(): Promise<{
  forkBlockNumber: bigint;
  poolAddress: `0x${string}`;
  poolScope: bigint;
  baseStateTreeLeaves: string[];
}> {
  const client = createPublicClient({
    chain: chainConfig.chain,
    transport: http(forkUrl),
  });

  const assetConfig = await client.readContract({
    address: chainConfig.entrypoint,
    abi: entrypointAbi,
    functionName: "assetConfig",
    args: [NATIVE_ASSET_ADDRESS],
  });

  const resolvedPoolAddress = (assetConfig as [string])[0] as `0x${string}`;
  const scope = await client.readContract({
    address: resolvedPoolAddress,
    abi: poolAbi,
    functionName: "SCOPE",
  }) as bigint;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const stateLeaves = await fetchStateTreeLeaves(scope);
    const [blockNumber, currentRoot] = await Promise.all([
      client.getBlockNumber(),
      client.readContract({
        address: resolvedPoolAddress,
        abi: poolAbi,
        functionName: "currentRoot",
      }) as Promise<bigint>,
    ]);

    if (computeMerkleRoot(stateLeaves) === BigInt(currentRoot)) {
      return {
        forkBlockNumber: blockNumber,
        poolAddress: resolvedPoolAddress,
        poolScope: scope,
        baseStateTreeLeaves: stateLeaves,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error("Could not capture a consistent Sepolia ETH state-tree snapshot");
}

async function assertForkSupportsHistoricalLogs(
  pool: `0x${string}`
): Promise<void> {
  const response = await fetch(forkUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [
        {
          address: pool,
          topics: [depositedEventTopic],
          fromBlock: `0x${chainConfig.startBlock.toString(16)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  let payload: {
    error?: { message?: string };
  } | null = null;
  try {
    payload = await response.json() as {
      error?: { message?: string };
    };
  } catch {
    payload = null;
  }

  if (response.ok && !payload?.error) {
    return;
  }

  const message = payload?.error?.message?.trim() || `HTTP ${response.status}`;
  if (RANGE_LIMIT_PATTERNS.some((pattern) => message.includes(pattern))) {
    throw new Error(
      `PP_ANVIL_FORK_URL (${forkUrl}) does not support the historical eth_getLogs `
      + "range required by the Anvil E2E harness. "
      + `Use a Sepolia RPC that supports deep log lookups, for example ${DEFAULT_ANVIL_FORK_URL}.`
    );
  }

  throw new Error(
    `Failed to validate PP_ANVIL_FORK_URL (${forkUrl}) for Anvil E2E: ${message}`
  );
}

function writeCurrentAspState(): void {
  writeAnvilAspState(aspStateFile, requireAspState());
}

async function resetAspState(): Promise<void> {
  aspState = {
    chainId: chainConfig.id,
    rpcUrl: requireAnvil().url,
    entrypoint: chainConfig.entrypoint,
    scope: poolScope.toString(),
    poolAddress,
    assetAddress: NATIVE_ASSET_ADDRESS,
    symbol: "ETH",
    baseStateTreeLeaves: [...baseStateTreeLeaves],
    insertedStateTreeLeaves: [],
    approvedLabels: [],
  };
  writeCurrentAspState();
}

function cliEnv() {
  return {
    PRIVACY_POOLS_RPC_URL_SEPOLIA: requireAnvil().url,
    PRIVACY_POOLS_ASP_HOST: requireAspServer().url,
    PRIVACY_POOLS_RELAYER_HOST: requireRelayerServer().url,
    PRIVACY_POOLS_CIRCUITS_DIR: circuitsDir,
  };
}

function expectSuccessStatus(
  result: { status: number | null; stdout: string; stderr: string },
  label: string
): void {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
}

async function resetFork(): Promise<void> {
  const reverted = await revertState(requireAnvil().url, baselineSnapshotId);
  if (!reverted) {
    throw new Error("Failed to revert the Anvil fork to the baseline snapshot");
  }
  baselineSnapshotId = await snapshotState(requireAnvil().url);
  await resetAspState();
}

async function decodeDeposit(txHash: `0x${string}`): Promise<{
  commitment: bigint;
  label: bigint;
}> {
  const receipt = await requireAnvilClient().getTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== poolAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: depositedEventAbi,
        data: log.data,
        topics: log.topics,
      });
      return {
        commitment: decoded.args._commitment,
        label: decoded.args._label,
      };
    } catch {
      // Ignore unrelated logs.
    }
  }
  throw new Error(`Deposit event not found for tx ${txHash}`);
}

async function decodeWithdrawNewCommitment(
  txHash: `0x${string}`
): Promise<bigint> {
  const receipt = await requireAnvilClient().getTransactionReceipt({ hash: txHash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== poolAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: withdrawnEventAbi,
        data: log.data,
        topics: log.topics,
      });
      return decoded.args._newCommitment;
    } catch {
      // Ignore unrelated logs.
    }
  }
  throw new Error(`Withdrawn event not found for tx ${txHash}`);
}

async function approveLabel(label: bigint): Promise<void> {
  const labels = [label.toString()];
  const root = computeMerkleRoot(labels);

  await impersonateAccount(requireAnvil().url, aspPostman);
  await setBalance(requireAnvil().url, aspPostman, 10n ** 20n);

  try {
    const walletClient = createWalletClient({
      account: aspPostman,
      chain: chainConfig.chain,
      transport: http(requireAnvil().url),
    });

    const txHash = await walletClient.writeContract({
      address: chainConfig.entrypoint,
      abi: entrypointAbi,
      functionName: "updateRoot",
      args: [root, dummyCid],
    });

    const receipt = await requireAnvilClient().waitForTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status !== "success") {
      throw new Error(`updateRoot reverted: ${txHash}`);
    }
  } finally {
    await stopImpersonatingAccount(requireAnvil().url, aspPostman);
  }

  aspState = {
    ...requireAspState(),
    approvedLabels: labels,
  };
  writeCurrentAspState();
}

beforeAll(async () => {
  if (!ANVIL_E2E_ENABLED) return;

  const snapshot = await captureSnapshot();
  await assertForkSupportsHistoricalLogs(snapshot.poolAddress);
  poolAddress = snapshot.poolAddress;
  poolScope = snapshot.poolScope;
  baseStateTreeLeaves = snapshot.baseStateTreeLeaves;

  anvil = await launchAnvil({
    forkUrl,
    chainId: chainConfig.id,
    forkBlockNumber: snapshot.forkBlockNumber,
  });

  anvilClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(anvil.url),
  });

  await setBalance(anvil.url, signerAddress, 10n ** 20n);
  await setBalance(anvil.url, aspPostman, 10n ** 20n);
  await setBalance(anvil.url, relayerAddress, 10n ** 20n);

  const stateDir = mkdtempSync(join(tmpdir(), "pp-anvil-asp-"));
  aspStateFile = join(stateDir, "state.json");
  circuitsDir = join(stateDir, "circuits");
  writeFileSync(join(stateDir, ".keep"), "", "utf8");
  await resetAspState();

  aspServer = await launchAnvilAspServer(aspStateFile);
  relayerServer = await launchAnvilRelayerServer({
    chainId: chainConfig.id,
    rpcUrl: anvil.url,
    entrypoint: chainConfig.entrypoint,
    assetAddress: NATIVE_ASSET_ADDRESS,
    feeReceiverAddress: relayerAddress,
    relayerPrivateKey,
    feeBPS: "50",
    minWithdrawAmount: "1",
    maxGasPrice: "100000000000",
  });
  baselineSnapshotId = await snapshotState(anvil.url);
});

beforeEach(async () => {
  if (!ANVIL_E2E_ENABLED) return;
  await resetFork();
});

afterAll(() => {
  if (relayerServer) killAnvilRelayerServer(relayerServer);
  if (aspServer) killAnvilAspServer(aspServer);
  if (anvil) killAnvil(anvil);

  if (aspStateFile) {
    rmSync(dirname(aspStateFile), { recursive: true, force: true });
  }
});

describe("Anvil E2E", () => {
  anvilTest("deposit -> sync -> accounts -> ragequit -> sync", async () => {
    ensureEnabled();

    const home = createTempHome("pp-anvil-ragequit-");
    mustInitSeededHome(home, "sepolia");

    const depositResult = runCli(
      ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 180_000, env: cliEnv() }
    );
    expectSuccessStatus(depositResult, "deposit");

    const depositJson = parseJsonOutput<{
      success: boolean;
      txHash: `0x${string}`;
      poolAccountId: string;
    }>(depositResult.stdout);
    expect(depositJson.success).toBe(true);

    const depositEvent = await decodeDeposit(depositJson.txHash);
    aspState = {
      ...requireAspState(),
      insertedStateTreeLeaves: [
        ...requireAspState().insertedStateTreeLeaves,
        depositEvent.commitment.toString(),
      ],
    };
    writeCurrentAspState();

    const syncResult = runCli(
      ["--agent", "sync", "--asset", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 120_000, env: cliEnv() }
    );
    expectSuccessStatus(syncResult, "sync after deposit");

    const accountsBefore = runCli(
      ["--agent", "accounts", "--all", "--chain", "sepolia"],
      { home, timeoutMs: 120_000, env: cliEnv() }
    );
    expectSuccessStatus(accountsBefore, "accounts before ragequit");
    const accountsBeforeJson = parseJsonOutput<{
      success: boolean;
      accounts: Array<{ poolAccountId: string; status: string; aspStatus: string }>;
    }>(accountsBefore.stdout);
    expect(accountsBeforeJson.success).toBe(true);
    expect(accountsBeforeJson.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          poolAccountId: depositJson.poolAccountId,
          status: "spendable",
          aspStatus: "pending",
        }),
      ])
    );

    const ragequitResult = runCli(
      [
        "--agent",
        "ragequit",
        "ETH",
        "--from-pa",
        depositJson.poolAccountId,
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 300_000, env: cliEnv() }
    );
    expectSuccessStatus(ragequitResult, "ragequit");

    const ragequitJson = parseJsonOutput<{ success: boolean }>(ragequitResult.stdout);
    expect(ragequitJson.success).toBe(true);

    const syncAfter = runCli(
      ["--agent", "sync", "--asset", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 120_000, env: cliEnv() }
    );
    expectSuccessStatus(syncAfter, "sync after ragequit");

    const accountsAfter = runCli(
      ["--agent", "accounts", "--all", "--chain", "sepolia"],
      { home, timeoutMs: 120_000, env: cliEnv() }
    );
    expectSuccessStatus(accountsAfter, "accounts after ragequit");
    const accountsAfterJson = parseJsonOutput<{
      success: boolean;
      accounts: Array<{ poolAccountId: string; status: string }>;
    }>(accountsAfter.stdout);
    expect(accountsAfterJson.success).toBe(true);
    expect(accountsAfterJson.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          poolAccountId: depositJson.poolAccountId,
          status: "exited",
        }),
      ])
    );
  });

  anvilTest("deposit -> approve -> accounts -> withdraw --direct -> sync", async () => {
    ensureEnabled();

    const home = createTempHome("pp-anvil-withdraw-");
    mustInitSeededHome(home, "sepolia");

    const depositResult = runCli(
      ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 180_000, env: cliEnv() }
    );
    expectSuccessStatus(depositResult, "deposit");

    const depositJson = parseJsonOutput<{
      success: boolean;
      txHash: `0x${string}`;
      poolAccountId: string;
    }>(depositResult.stdout);
    expect(depositJson.success).toBe(true);

    const depositEvent = await decodeDeposit(depositJson.txHash);
    aspState = {
      ...requireAspState(),
      insertedStateTreeLeaves: [
        ...requireAspState().insertedStateTreeLeaves,
        depositEvent.commitment.toString(),
      ],
    };
    writeCurrentAspState();

    await approveLabel(depositEvent.label);

    const accountsApproved = runCli(
      ["--agent", "accounts", "--all", "--chain", "sepolia"],
      { home, timeoutMs: 120_000, env: cliEnv() }
    );
    expectSuccessStatus(accountsApproved, "accounts after approval");
    const accountsApprovedJson = parseJsonOutput<{
      success: boolean;
      accounts: Array<{ poolAccountId: string; aspStatus: string }>;
    }>(accountsApproved.stdout);
    expect(accountsApprovedJson.success).toBe(true);
    expect(accountsApprovedJson.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          poolAccountId: depositJson.poolAccountId,
          aspStatus: "approved",
        }),
      ])
    );

    const withdrawResult = runCli(
      [
        "--agent",
        "withdraw",
        "50%",
        "ETH",
        "--direct",
        "--from-pa",
        depositJson.poolAccountId,
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 300_000, env: cliEnv() }
    );
    expectSuccessStatus(withdrawResult, "direct withdraw");
    expect(withdrawResult.stderr.trim()).toBe("");

    const withdrawJson = parseJsonOutput<{
      success: boolean;
      mode: string;
      txHash: `0x${string}`;
    }>(withdrawResult.stdout);
    expect(withdrawJson.success).toBe(true);
    expect(withdrawJson.mode).toBe("direct");

    const newCommitment = await decodeWithdrawNewCommitment(withdrawJson.txHash);
    expect(newCommitment).toBeGreaterThan(0n);

    const syncAfter = runCli(
      ["--agent", "sync", "--asset", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 120_000, env: cliEnv() }
    );
    expectSuccessStatus(syncAfter, "sync after direct withdraw");

    const accountsAfter = runCli(
      ["--agent", "accounts", "--all", "--chain", "sepolia"],
      { home, timeoutMs: 120_000, env: cliEnv() }
    );
    expectSuccessStatus(accountsAfter, "accounts after direct withdraw");
    const accountsAfterJson = parseJsonOutput<{
      success: boolean;
      accounts: Array<{ poolAccountId: string; status: string }>;
    }>(accountsAfter.stdout);
    expect(accountsAfterJson.success).toBe(true);
    expect(accountsAfterJson.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          poolAccountId: depositJson.poolAccountId,
          status: "spendable",
        }),
      ])
    );
  });

  anvilTest("deposit -> approve -> withdraw (relayed) -> sync", async () => {
    ensureEnabled();

    const home = createTempHome("pp-anvil-relayed-withdraw-");
    mustInitSeededHome(home, "sepolia");

    const depositResult = runCli(
      ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 180_000, env: cliEnv() }
    );
    expectSuccessStatus(depositResult, "deposit");

    const depositJson = parseJsonOutput<{
      success: boolean;
      txHash: `0x${string}`;
      poolAccountId: string;
    }>(depositResult.stdout);
    expect(depositJson.success).toBe(true);

    const depositEvent = await decodeDeposit(depositJson.txHash);
    aspState = {
      ...requireAspState(),
      insertedStateTreeLeaves: [
        ...requireAspState().insertedStateTreeLeaves,
        depositEvent.commitment.toString(),
      ],
    };
    writeCurrentAspState();

    await approveLabel(depositEvent.label);

    const recipientBalanceBefore = await requireAnvilClient().getBalance({
      address: relayedRecipient,
    });

    const withdrawResult = runCli(
      [
        "--agent",
        "withdraw",
        "50%",
        "ETH",
        "--to",
        relayedRecipient,
        "--from-pa",
        depositJson.poolAccountId,
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 300_000, env: cliEnv() }
    );
    expectSuccessStatus(withdrawResult, "relayed withdraw");
    expect(withdrawResult.stderr.trim()).toBe("");

    const withdrawJson = parseJsonOutput<{
      success: boolean;
      mode: string;
      txHash: `0x${string}`;
    }>(withdrawResult.stdout);
    expect(withdrawJson.success).toBe(true);
    expect(withdrawJson.mode).toBe("relayed");

    const newCommitment = await decodeWithdrawNewCommitment(withdrawJson.txHash);
    expect(newCommitment).toBeGreaterThan(0n);

    const recipientBalanceAfter = await requireAnvilClient().getBalance({
      address: relayedRecipient,
    });
    expect(recipientBalanceAfter).toBeGreaterThan(recipientBalanceBefore);

    const syncAfter = runCli(
      ["--agent", "sync", "--asset", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 120_000, env: cliEnv() }
    );
    expectSuccessStatus(syncAfter, "sync after relayed withdraw");

    const accountsAfter = runCli(
      ["--agent", "accounts", "--all", "--chain", "sepolia"],
      { home, timeoutMs: 120_000, env: cliEnv() }
    );
    expectSuccessStatus(accountsAfter, "accounts after relayed withdraw");
    const accountsAfterJson = parseJsonOutput<{
      success: boolean;
      accounts: Array<{ poolAccountId: string; status: string; aspStatus: string }>;
    }>(accountsAfter.stdout);
    expect(accountsAfterJson.success).toBe(true);
    expect(accountsAfterJson.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          poolAccountId: depositJson.poolAccountId,
          status: "spendable",
          aspStatus: "approved",
        }),
      ])
    );
  });

  anvilTest("deposit -> ragequit --unsigned and --dry-run", async () => {
    ensureEnabled();

    const home = createTempHome("pp-anvil-ragequit-alt-modes-");
    mustInitSeededHome(home, "sepolia");

    const depositResult = runCli(
      ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 180_000, env: cliEnv() }
    );
    expectSuccessStatus(depositResult, "deposit");

    const depositJson = parseJsonOutput<{
      success: boolean;
      txHash: `0x${string}`;
      poolAccountId: string;
    }>(depositResult.stdout);
    expect(depositJson.success).toBe(true);

    const depositEvent = await decodeDeposit(depositJson.txHash);
    aspState = {
      ...requireAspState(),
      insertedStateTreeLeaves: [
        ...requireAspState().insertedStateTreeLeaves,
        depositEvent.commitment.toString(),
      ],
    };
    writeCurrentAspState();

    const unsignedResult = runCli(
      [
        "--agent",
        "ragequit",
        "ETH",
        "--from-pa",
        depositJson.poolAccountId,
        "--unsigned",
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 300_000, env: cliEnv() }
    );
    expectSuccessStatus(unsignedResult, "ragequit unsigned");
    const unsignedJson = parseJsonOutput<{
      success: boolean;
      mode: string;
      operation: string;
      transactions: Array<{ to: string; data: string; chainId: number }>;
    }>(unsignedResult.stdout);
    expect(unsignedJson.success).toBe(true);
    expect(unsignedJson.mode).toBe("unsigned");
    expect(unsignedJson.operation).toBe("ragequit");
    expect(unsignedJson.transactions).toHaveLength(1);
    expect(unsignedJson.transactions[0]?.to.toLowerCase()).toBe(poolAddress.toLowerCase());
    expect(unsignedJson.transactions[0]?.chainId).toBe(chainConfig.id);

    const dryRunResult = runCli(
      [
        "--agent",
        "ragequit",
        "ETH",
        "--from-pa",
        depositJson.poolAccountId,
        "--dry-run",
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 300_000, env: cliEnv() }
    );
    expectSuccessStatus(dryRunResult, "ragequit dry-run");
    const dryRunJson = parseJsonOutput<{
      success: boolean;
      operation: string;
      dryRun: boolean;
      proofPublicSignals: number;
      poolAccountId: string;
    }>(dryRunResult.stdout);
    expect(dryRunJson.success).toBe(true);
    expect(dryRunJson.operation).toBe("ragequit");
    expect(dryRunJson.dryRun).toBe(true);
    expect(dryRunJson.poolAccountId).toBe(depositJson.poolAccountId);
    expect(dryRunJson.proofPublicSignals).toBeGreaterThan(0);
  });

  anvilTest("deposit -> approve -> withdraw --direct --unsigned and --dry-run", async () => {
    ensureEnabled();

    const home = createTempHome("pp-anvil-withdraw-alt-modes-");
    mustInitSeededHome(home, "sepolia");

    const depositResult = runCli(
      ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
      { home, timeoutMs: 180_000, env: cliEnv() }
    );
    expectSuccessStatus(depositResult, "deposit");

    const depositJson = parseJsonOutput<{
      success: boolean;
      txHash: `0x${string}`;
      poolAccountId: string;
    }>(depositResult.stdout);
    expect(depositJson.success).toBe(true);

    const depositEvent = await decodeDeposit(depositJson.txHash);
    aspState = {
      ...requireAspState(),
      insertedStateTreeLeaves: [
        ...requireAspState().insertedStateTreeLeaves,
        depositEvent.commitment.toString(),
      ],
    };
    writeCurrentAspState();

    await approveLabel(depositEvent.label);

    const unsignedResult = runCli(
      [
        "--agent",
        "withdraw",
        "50%",
        "ETH",
        "--direct",
        "--to",
        relayedRecipient,
        "--from-pa",
        depositJson.poolAccountId,
        "--unsigned",
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 300_000, env: cliEnv() }
    );
    expectSuccessStatus(unsignedResult, "withdraw unsigned");
    expect(unsignedResult.stderr.trim()).toBe("");
    const unsignedJson = parseJsonOutput<{
      success: boolean;
      mode: string;
      operation: string;
      withdrawMode: string;
      poolAccountId: string;
      transactions: Array<{ to: string; data: string; chainId: number }>;
    }>(unsignedResult.stdout);
    expect(unsignedJson.success).toBe(true);
    expect(unsignedJson.mode).toBe("unsigned");
    expect(unsignedJson.operation).toBe("withdraw");
    expect(unsignedJson.withdrawMode).toBe("direct");
    expect(unsignedJson.poolAccountId).toBe(depositJson.poolAccountId);
    expect(unsignedJson.transactions).toHaveLength(1);
    expect(unsignedJson.transactions[0]?.to.toLowerCase()).toBe(poolAddress.toLowerCase());
    expect(unsignedJson.transactions[0]?.chainId).toBe(chainConfig.id);

    const dryRunResult = runCli(
      [
        "--agent",
        "withdraw",
        "50%",
        "ETH",
        "--direct",
        "--to",
        relayedRecipient,
        "--from-pa",
        depositJson.poolAccountId,
        "--dry-run",
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 300_000, env: cliEnv() }
    );
    expectSuccessStatus(dryRunResult, "withdraw dry-run");
    expect(dryRunResult.stderr.trim()).toBe("");
    const dryRunJson = parseJsonOutput<{
      success: boolean;
      mode: string;
      dryRun: boolean;
      proofPublicSignals: number;
      poolAccountId: string;
    }>(dryRunResult.stdout);
    expect(dryRunJson.success).toBe(true);
    expect(dryRunJson.mode).toBe("direct");
    expect(dryRunJson.dryRun).toBe(true);
    expect(dryRunJson.poolAccountId).toBe(depositJson.poolAccountId);
    expect(dryRunJson.proofPublicSignals).toBeGreaterThan(0);
  });
});
