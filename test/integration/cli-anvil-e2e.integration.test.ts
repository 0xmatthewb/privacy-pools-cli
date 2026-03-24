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

interface DepositedPoolAccount {
  home: string;
  poolAccountId: string;
  txHash: `0x${string}`;
  label: bigint;
}

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
  const proof = generateMerkleProof(
    normalized,
    normalized[normalized.length - 1],
  );
  return BigInt((proof as { root: bigint | string }).root);
}

async function fetchStateTreeLeaves(scope: bigint): Promise<string[]> {
  const response = await fetch(
    `${chainConfig.aspHost}/${chainConfig.id}/public/mt-leaves`,
    {
      headers: {
        "X-Pool-Scope": scope.toString(),
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch ASP leaves: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { stateTreeLeaves?: string[] };
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
  const scope = (await client.readContract({
    address: resolvedPoolAddress,
    abi: poolAbi,
    functionName: "SCOPE",
  })) as bigint;

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

  throw new Error(
    "Could not capture a consistent Sepolia ETH state-tree snapshot",
  );
}

async function assertForkSupportsHistoricalLogs(
  pool: `0x${string}`,
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
    payload = (await response.json()) as {
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
      `PP_ANVIL_FORK_URL (${forkUrl}) does not support the historical eth_getLogs ` +
        "range required by the Anvil E2E harness. " +
        `Use a Sepolia RPC that supports deep log lookups, for example ${DEFAULT_ANVIL_FORK_URL}.`,
    );
  }

  throw new Error(
    `Failed to validate PP_ANVIL_FORK_URL (${forkUrl}) for Anvil E2E: ${message}`,
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
    reviewStatuses: {},
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

function createAnvilHome(prefix: string): string {
  const home = createTempHome(prefix);
  mustInitSeededHome(home, "sepolia");
  return home;
}

function runAnvilCli(
  home: string,
  args: string[],
  timeoutMs: number = 120_000,
) {
  return runCli(args, {
    home,
    timeoutMs,
    env: cliEnv(),
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

function appendInsertedStateTreeLeaf(commitment: bigint): void {
  const currentState = requireAspState();
  aspState = {
    ...currentState,
    insertedStateTreeLeaves: [
      ...currentState.insertedStateTreeLeaves,
      commitment.toString(),
    ],
  };
  writeCurrentAspState();
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
  const receipt = await requireAnvilClient().getTransactionReceipt({
    hash: txHash,
  });
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
  txHash: `0x${string}`,
): Promise<bigint> {
  const receipt = await requireAnvilClient().getTransactionReceipt({
    hash: txHash,
  });
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
    reviewStatuses: {
      ...requireAspState().reviewStatuses,
      [label.toString()]: "approved",
    },
  };
  writeCurrentAspState();
}

async function createDepositedPoolAccount(
  prefix: string,
): Promise<DepositedPoolAccount> {
  const home = createAnvilHome(prefix);
  const depositJson = parseSuccessfulAgentResult<{
    success: boolean;
    txHash: `0x${string}`;
    poolAccountId: string;
  }>(
    home,
    ["--agent", "deposit", "0.01", "ETH", "--chain", "sepolia"],
    "deposit",
    180_000,
  );
  expect(depositJson.success).toBe(true);

  const depositEvent = await decodeDeposit(depositJson.txHash);
  appendInsertedStateTreeLeaf(depositEvent.commitment);

  return {
    home,
    poolAccountId: depositJson.poolAccountId,
    txHash: depositJson.txHash,
    label: depositEvent.label,
  };
}

async function createApprovedPoolAccount(
  prefix: string,
): Promise<DepositedPoolAccount> {
  const deposit = await createDepositedPoolAccount(prefix);
  await approveLabel(deposit.label);
  return deposit;
}

async function createReviewedPoolAccount(
  prefix: string,
  reviewStatus: "declined" | "poi_required",
): Promise<DepositedPoolAccount> {
  const deposit = await createDepositedPoolAccount(prefix);
  setLabelReviewStatus(deposit.label, reviewStatus);
  return deposit;
}

function syncEthPool(home: string, label: string): void {
  parseSuccessfulAgentResult(
    home,
    ["--agent", "sync", "--asset", "ETH", "--chain", "sepolia"],
    label,
    120_000,
  );
}

function setLabelReviewStatus(
  label: bigint,
  reviewStatus: "pending" | "declined" | "poi_required",
): void {
  const labelString = label.toString();
  aspState = {
    ...requireAspState(),
    approvedLabels: requireAspState().approvedLabels.filter(
      (value) => value !== labelString,
    ),
    reviewStatuses: {
      ...requireAspState().reviewStatuses,
      [labelString]: reviewStatus,
    },
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
  describe("state transitions", () => {
    anvilTest("deposit -> sync -> accounts -> ragequit -> sync", async () => {
      ensureEnabled();

      const deposit = await createDepositedPoolAccount("pp-anvil-ragequit-");

      syncEthPool(deposit.home, "sync after deposit");

      const accountsBeforeJson = parseSuccessfulAgentResult<{
        success: boolean;
        accounts: Array<{
          poolAccountId: string;
          status: string;
          aspStatus: string;
        }>;
      }>(
        deposit.home,
        ["--agent", "accounts", "--chain", "sepolia"],
        "accounts before ragequit",
      );
      expect(accountsBeforeJson.success).toBe(true);
      expect(accountsBeforeJson.accounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            poolAccountId: deposit.poolAccountId,
            status: "pending",
            aspStatus: "pending",
          }),
        ]),
      );

      const ragequitJson = parseSuccessfulAgentResult<{ success: boolean }>(
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
        300_000,
      );
      expect(ragequitJson.success).toBe(true);

      syncEthPool(deposit.home, "sync after ragequit");

      const accountsAfterJson = parseSuccessfulAgentResult<{
        success: boolean;
        accounts: Array<{ poolAccountId: string; status: string }>;
      }>(
        deposit.home,
        ["--agent", "accounts", "--chain", "sepolia"],
        "accounts after ragequit",
      );
      expect(accountsAfterJson.success).toBe(true);
      expect(accountsAfterJson.accounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            poolAccountId: deposit.poolAccountId,
            status: "exited",
          }),
        ]),
      );
    });

    anvilTest(
      "deposit -> approve -> accounts -> withdraw --direct -> sync",
      async () => {
        ensureEnabled();

        const deposit = await createApprovedPoolAccount("pp-anvil-withdraw-");

        const accountsApprovedJson = parseSuccessfulAgentResult<{
          success: boolean;
          accounts: Array<{ poolAccountId: string; aspStatus: string }>;
        }>(
          deposit.home,
          ["--agent", "accounts", "--chain", "sepolia"],
          "accounts after approval",
        );
        expect(accountsApprovedJson.success).toBe(true);
        expect(accountsApprovedJson.accounts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              poolAccountId: deposit.poolAccountId,
              aspStatus: "approved",
            }),
          ]),
        );

        const withdrawJson = parseSuccessfulAgentResult<{
          success: boolean;
          mode: string;
          txHash: `0x${string}`;
        }>(
          deposit.home,
          [
            "--agent",
            "withdraw",
            "50%",
            "ETH",
            "--direct",
            "--from-pa",
            deposit.poolAccountId,
            "--chain",
            "sepolia",
          ],
          "direct withdraw",
          300_000,
        );
        expect(withdrawJson.success).toBe(true);
        expect(withdrawJson.mode).toBe("direct");

        const newCommitment = await decodeWithdrawNewCommitment(
          withdrawJson.txHash,
        );
        expect(newCommitment).toBeGreaterThan(0n);

        syncEthPool(deposit.home, "sync after direct withdraw");

        const accountsAfterJson = parseSuccessfulAgentResult<{
          success: boolean;
          accounts: Array<{ poolAccountId: string; status: string }>;
        }>(
          deposit.home,
          ["--agent", "accounts", "--chain", "sepolia"],
          "accounts after direct withdraw",
        );
        expect(accountsAfterJson.success).toBe(true);
        expect(accountsAfterJson.accounts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              poolAccountId: deposit.poolAccountId,
              status: "approved",
            }),
          ]),
        );
      },
    );

    anvilTest("deposit -> approve -> withdraw (relayed) -> sync", async () => {
      ensureEnabled();

      const deposit = await createApprovedPoolAccount(
        "pp-anvil-relayed-withdraw-",
      );

      const recipientBalanceBefore = await requireAnvilClient().getBalance({
        address: relayedRecipient,
      });

      const withdrawJson = parseSuccessfulAgentResult<{
        success: boolean;
        mode: string;
        txHash: `0x${string}`;
      }>(
        deposit.home,
        [
          "--agent",
          "withdraw",
          "50%",
          "ETH",
          "--to",
          relayedRecipient,
          "--from-pa",
          deposit.poolAccountId,
          "--chain",
          "sepolia",
        ],
        "relayed withdraw",
        300_000,
      );
      expect(withdrawJson.success).toBe(true);
      expect(withdrawJson.mode).toBe("relayed");

      const newCommitment = await decodeWithdrawNewCommitment(
        withdrawJson.txHash,
      );
      expect(newCommitment).toBeGreaterThan(0n);

      const recipientBalanceAfter = await requireAnvilClient().getBalance({
        address: relayedRecipient,
      });
      expect(recipientBalanceAfter).toBeGreaterThan(recipientBalanceBefore);

      syncEthPool(deposit.home, "sync after relayed withdraw");

      const accountsAfterJson = parseSuccessfulAgentResult<{
        success: boolean;
        accounts: Array<{
          poolAccountId: string;
          status: string;
          aspStatus: string;
        }>;
      }>(
        deposit.home,
        ["--agent", "accounts", "--chain", "sepolia"],
        "accounts after relayed withdraw",
      );
      expect(accountsAfterJson.success).toBe(true);
      expect(accountsAfterJson.accounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            poolAccountId: deposit.poolAccountId,
            status: "approved",
            aspStatus: "approved",
          }),
        ]),
      );
    });

    anvilTest(
      "deposit -> declined -> withdraw blocked -> ragequit succeeds",
      async () => {
        ensureEnabled();

        const deposit = await createReviewedPoolAccount(
          "pp-anvil-declined-",
          "declined",
        );

        syncEthPool(deposit.home, "sync after declined deposit");

        const accountsJson = parseSuccessfulAgentResult<{
          success: boolean;
          accounts: Array<{
            poolAccountId: string;
            status: string;
            aspStatus: string;
          }>;
        }>(
          deposit.home,
          ["--agent", "accounts", "--chain", "sepolia"],
          "accounts after declined review",
        );
        expect(accountsJson.accounts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              poolAccountId: deposit.poolAccountId,
              status: "declined",
              aspStatus: "declined",
            }),
          ]),
        );

        const pendingOnlyJson = parseSuccessfulAgentResult<{
          success: boolean;
          accounts: Array<{ poolAccountId: string }>;
        }>(
          deposit.home,
          ["--agent", "accounts", "--pending-only", "--chain", "sepolia"],
          "pending-only after declined review",
        );
        expect(pendingOnlyJson.accounts).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ poolAccountId: deposit.poolAccountId }),
          ]),
        );

        const withdrawResult = runAnvilCli(
          deposit.home,
          [
            "--agent",
            "withdraw",
            "50%",
            "ETH",
            "--to",
            relayedRecipient,
            "--from-pa",
            deposit.poolAccountId,
            "--chain",
            "sepolia",
          ],
          300_000,
        );
        expect(withdrawResult.status).toBe(4);
        const withdrawJson = parseJsonOutput<{
          success: boolean;
          errorCode: string;
          error: { hint?: string };
        }>(withdrawResult.stdout);
        expect(withdrawJson.success).toBe(false);
        expect(withdrawJson.errorCode).toBe("ACCOUNT_NOT_APPROVED");
        expect(withdrawJson.error.hint).toContain("declined");
        expect(withdrawJson.error.hint).toContain("ragequit");

        parseSuccessfulAgentResult(
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
          "ragequit after declined review",
          300_000,
        );

        syncEthPool(deposit.home, "sync after declined ragequit");

        const accountsAfterJson = parseSuccessfulAgentResult<{
          success: boolean;
          accounts: Array<{ poolAccountId: string; status: string }>;
        }>(
          deposit.home,
          ["--agent", "accounts", "--chain", "sepolia"],
          "accounts after declined ragequit",
        );
        expect(accountsAfterJson.accounts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              poolAccountId: deposit.poolAccountId,
              status: "exited",
            }),
          ]),
        );
      },
    );

    anvilTest(
      "deposit -> poi_required -> direct withdraw blocked",
      async () => {
        ensureEnabled();

        const deposit = await createReviewedPoolAccount(
          "pp-anvil-poi-required-",
          "poi_required",
        );

        syncEthPool(deposit.home, "sync after poi_required deposit");

        const accountsJson = parseSuccessfulAgentResult<{
          success: boolean;
          accounts: Array<{
            poolAccountId: string;
            status: string;
            aspStatus: string;
          }>;
        }>(
          deposit.home,
          ["--agent", "accounts", "--chain", "sepolia"],
          "accounts after poi_required review",
        );
        expect(accountsJson.accounts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              poolAccountId: deposit.poolAccountId,
              status: "poi_required",
              aspStatus: "poi_required",
            }),
          ]),
        );

        const pendingOnlyJson = parseSuccessfulAgentResult<{
          success: boolean;
          accounts: Array<{ poolAccountId: string }>;
        }>(
          deposit.home,
          ["--agent", "accounts", "--pending-only", "--chain", "sepolia"],
          "pending-only after poi_required review",
        );
        expect(pendingOnlyJson.accounts).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ poolAccountId: deposit.poolAccountId }),
          ]),
        );

        const withdrawResult = runAnvilCli(
          deposit.home,
          [
            "--agent",
            "withdraw",
            "50%",
            "ETH",
            "--direct",
            "--from-pa",
            deposit.poolAccountId,
            "--chain",
            "sepolia",
          ],
          300_000,
        );
        expect(withdrawResult.status).toBe(4);
        const withdrawJson = parseJsonOutput<{
          success: boolean;
          errorCode: string;
          error: { hint?: string };
        }>(withdrawResult.stdout);
        expect(withdrawJson.success).toBe(false);
        expect(withdrawJson.errorCode).toBe("ACCOUNT_NOT_APPROVED");
        expect(withdrawJson.error.hint).toContain("Proof of Association");
        expect(withdrawJson.error.hint).toContain("tornado.0xbow.io");
      },
    );
  });

  describe("unsigned and dry-run journeys", () => {
    anvilTest("deposit -> ragequit --unsigned and --dry-run", async () => {
      ensureEnabled();

      const deposit = await createDepositedPoolAccount(
        "pp-anvil-ragequit-alt-modes-",
      );

      const unsignedJson = parseSuccessfulAgentResult<{
        success: boolean;
        mode: string;
        operation: string;
        transactions: Array<{ to: string; data: string; chainId: number }>;
      }>(
        deposit.home,
        [
          "--agent",
          "ragequit",
          "ETH",
          "--from-pa",
          deposit.poolAccountId,
          "--unsigned",
          "--chain",
          "sepolia",
        ],
        "ragequit unsigned",
        300_000,
      );
      expect(unsignedJson.success).toBe(true);
      expect(unsignedJson.mode).toBe("unsigned");
      expect(unsignedJson.operation).toBe("ragequit");
      expect(unsignedJson.transactions).toHaveLength(1);
      expect(unsignedJson.transactions[0]?.to.toLowerCase()).toBe(
        poolAddress.toLowerCase(),
      );
      expect(unsignedJson.transactions[0]?.chainId).toBe(chainConfig.id);

      const dryRunJson = parseSuccessfulAgentResult<{
        success: boolean;
        operation: string;
        dryRun: boolean;
        proofPublicSignals: number;
        poolAccountId: string;
      }>(
        deposit.home,
        [
          "--agent",
          "ragequit",
          "ETH",
          "--from-pa",
          deposit.poolAccountId,
          "--dry-run",
          "--chain",
          "sepolia",
        ],
        "ragequit dry-run",
        300_000,
      );
      expect(dryRunJson.success).toBe(true);
      expect(dryRunJson.operation).toBe("ragequit");
      expect(dryRunJson.dryRun).toBe(true);
      expect(dryRunJson.poolAccountId).toBe(deposit.poolAccountId);
      expect(dryRunJson.proofPublicSignals).toBeGreaterThan(0);
    });

    anvilTest(
      "deposit -> approve -> withdraw --direct --unsigned and --dry-run",
      async () => {
        ensureEnabled();

        const deposit = await createApprovedPoolAccount(
          "pp-anvil-withdraw-alt-modes-",
        );

        const unsignedJson = parseSuccessfulAgentResult<{
          success: boolean;
          mode: string;
          operation: string;
          withdrawMode: string;
          poolAccountId: string;
          transactions: Array<{ to: string; data: string; chainId: number }>;
        }>(
          deposit.home,
          [
            "--agent",
            "withdraw",
            "50%",
            "ETH",
            "--direct",
            "--to",
            relayedRecipient,
            "--from-pa",
            deposit.poolAccountId,
            "--unsigned",
            "--chain",
            "sepolia",
          ],
          "withdraw unsigned",
          300_000,
        );
        expect(unsignedJson.success).toBe(true);
        expect(unsignedJson.mode).toBe("unsigned");
        expect(unsignedJson.operation).toBe("withdraw");
        expect(unsignedJson.withdrawMode).toBe("direct");
        expect(unsignedJson.poolAccountId).toBe(deposit.poolAccountId);
        expect(unsignedJson.transactions).toHaveLength(1);
        expect(unsignedJson.transactions[0]?.to.toLowerCase()).toBe(
          poolAddress.toLowerCase(),
        );
        expect(unsignedJson.transactions[0]?.chainId).toBe(chainConfig.id);

        const dryRunJson = parseSuccessfulAgentResult<{
          success: boolean;
          mode: string;
          dryRun: boolean;
          proofPublicSignals: number;
          poolAccountId: string;
        }>(
          deposit.home,
          [
            "--agent",
            "withdraw",
            "50%",
            "ETH",
            "--direct",
            "--to",
            relayedRecipient,
            "--from-pa",
            deposit.poolAccountId,
            "--dry-run",
            "--chain",
            "sepolia",
          ],
          "withdraw dry-run",
          300_000,
        );
        expect(dryRunJson.success).toBe(true);
        expect(dryRunJson.mode).toBe("direct");
        expect(dryRunJson.dryRun).toBe(true);
        expect(dryRunJson.poolAccountId).toBe(deposit.poolAccountId);
        expect(dryRunJson.proofPublicSignals).toBeGreaterThan(0);
      },
    );
  });
});
