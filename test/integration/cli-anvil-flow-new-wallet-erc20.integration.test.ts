import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
} from "viem";
import { generateMerkleProof } from "@0xbow/privacy-pools-core-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS } from "../../src/config/chains.ts";
import { createTempHome, mustInitSeededHome, parseJsonOutput, runCli } from "../helpers/cli.ts";
import {
  interruptChildProcess,
  terminateChildProcess,
  waitForChildProcessResult,
} from "../helpers/process.ts";
import {
  readWorkflowSnapshot,
  waitForWorkflowSnapshotPhase,
} from "../helpers/workflow-snapshot.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  impersonateAccount,
  killAnvil,
  launchAnvil,
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
import { buildChildProcessEnv } from "../helpers/child-env.ts";

const ANVIL_E2E_ENABLED = process.env.PP_ANVIL_E2E === "1";
const anvilTest = ANVIL_E2E_ENABLED ? test : test.skip;

const chainConfig = CHAINS["op-sepolia"];
const DEFAULT_ANVIL_FORK_URL = "https://optimism-sepolia.gateway.tenderly.co";
const forkUrl =
  process.env.PP_ANVIL_FORK_URL_OP_SEPOLIA?.trim() || DEFAULT_ANVIL_FORK_URL;
const signerPrivateKey =
  "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const signerAddress = privateKeyToAccount(signerPrivateKey).address;
const relayerPrivateKey =
  "0x2222222222222222222222222222222222222222222222222222222222222222" as const;
const relayerAddress = privateKeyToAccount(relayerPrivateKey).address;
const aspPostman = "0x696fe46495688fc9e99bad2daf2133b33de364ea" as const;
const dummyCid = "bafybeigdyrzt5wethnewwalletanviltests1234567890";
const relayedRecipient = "0x4444444444444444444444444444444444444444" as const;
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as const;
const EXTRA_ETH_BUFFER = 10n ** 16n;

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

const wethAbi = parseAbi([
  "function deposit() payable",
  "function balanceOf(address) view returns (uint256)",
]);

let anvil: AnvilInstance | null = null;
let aspServer: AnvilAspServer | null = null;
let relayerServer: AnvilRelayerServer | null = null;
let anvilClient: ReturnType<typeof createPublicClient> | null = null;
let poolAddress: `0x${string}`;
let poolScope: bigint;
let baseStateTreeLeaves: string[] = [];
let aspStateFile = "";
let baselineSnapshotId = "";
let aspState: AnvilAspState | null = null;
let stateDir = "";
let circuitsDir = "";

const ORIGINAL_ENV = {
  PRIVACY_POOLS_HOME: process.env.PRIVACY_POOLS_HOME,
  PRIVACY_POOLS_RPC_URL_OP_SEPOLIA: process.env.PRIVACY_POOLS_RPC_URL_OP_SEPOLIA,
  PRIVACY_POOLS_ASP_HOST: process.env.PRIVACY_POOLS_ASP_HOST,
  PRIVACY_POOLS_RELAYER_HOST: process.env.PRIVACY_POOLS_RELAYER_HOST,
  PRIVACY_POOLS_CIRCUITS_DIR: process.env.PRIVACY_POOLS_CIRCUITS_DIR,
};
const SHARED_CIRCUITS_DIR =
  process.env.PP_ANVIL_SHARED_CIRCUITS_DIR?.trim() || null;

function requireAnvil(): AnvilInstance {
  if (!anvil) throw new Error("Anvil is not running");
  return anvil;
}

function requireAnvilClient() {
  if (!anvilClient) throw new Error("Anvil client is not initialized");
  return anvilClient;
}

function requireAspServer(): AnvilAspServer {
  if (!aspServer) throw new Error("ASP server is not running");
  return aspServer;
}

function requireRelayerServer(): AnvilRelayerServer {
  if (!relayerServer) throw new Error("Relayer server is not running");
  return relayerServer;
}

function requireAspState(): AnvilAspState {
  if (!aspState) throw new Error("ASP state is not initialized");
  return aspState;
}

function computeMerkleRoot(leaves: readonly string[]): bigint {
  const normalized = leaves.map((leaf) => BigInt(leaf));
  const proof = generateMerkleProof(normalized, normalized[normalized.length - 1]);
  return BigInt((proof as { root: bigint | string }).root);
}

async function fetchStateTreeLeaves(scope: bigint): Promise<string[]> {
  const response = await fetch(
    `${chainConfig.aspHost}/${chainConfig.id}/public/mt-leaves`,
    {
      headers: { "X-Pool-Scope": scope.toString() },
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
    args: [WETH_ADDRESS],
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

  throw new Error("Could not capture a consistent OP Sepolia WETH state-tree snapshot");
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
    assetAddress: WETH_ADDRESS,
    symbol: "WETH",
    baseStateTreeLeaves: [...baseStateTreeLeaves],
    insertedStateTreeLeaves: [],
    approvedLabels: [],
    reviewStatuses: {},
  };
  writeCurrentAspState();
}

function appendInsertedStateTreeLeaf(commitment: bigint): void {
  aspState = {
    ...requireAspState(),
    insertedStateTreeLeaves: [
      ...requireAspState().insertedStateTreeLeaves,
      commitment.toString(),
    ],
  };
  writeCurrentAspState();
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

async function resetFork(): Promise<void> {
  const reverted = await revertState(requireAnvil().url, baselineSnapshotId);
  if (!reverted) {
    throw new Error("Failed to revert OP Sepolia Anvil fork to the baseline snapshot");
  }
  baselineSnapshotId = await snapshotState(requireAnvil().url);
  await resetAspState();
}

function cliEnv() {
  return {
    PRIVACY_POOLS_RPC_URL_OP_SEPOLIA: requireAnvil().url,
    PRIVACY_POOLS_ASP_HOST: requireAspServer().url,
    PRIVACY_POOLS_RELAYER_HOST: requireRelayerServer().url,
    PRIVACY_POOLS_CIRCUITS_DIR: circuitsDir,
  };
}

function restoreEnv(
  key: keyof typeof ORIGINAL_ENV,
): void {
  const originalValue = ORIGINAL_ENV[key];
  if (originalValue === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = originalValue;
  }
}

function createAnvilHome(prefix: string): string {
  const home = createTempHome(prefix);
  mustInitSeededHome(home, "op-sepolia");
  return home;
}

function parseWorkflowWalletBackup(filePath: string): {
  walletAddress: `0x${string}`;
  privateKey: `0x${string}`;
} {
  const content = readFileSync(filePath, "utf8");
  const walletAddress = content.match(/Wallet Address:\s*(0x[a-fA-F0-9]{40})/)?.[1];
  const privateKey = content.match(/Private Key:\s*(0x[a-fA-F0-9]{64})/)?.[1];
  if (!walletAddress || !privateKey) {
    throw new Error(`Could not parse workflow wallet backup at ${filePath}`);
  }
  return {
    walletAddress: walletAddress as `0x${string}`,
    privateKey: privateKey as `0x${string}`,
  };
}

async function waitForCondition<T>(
  label: string,
  fn: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs: number = 60_000,
  intervalMs: number = 250,
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

async function wrapEthToWeth(
  privateKey: `0x${string}`,
  amount: bigint,
): Promise<void> {
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: chainConfig.chain,
    transport: http(requireAnvil().url),
  });
  const txHash = await walletClient.writeContract({
    address: WETH_ADDRESS,
    abi: wethAbi,
    functionName: "deposit",
    args: [],
    value: amount,
  });
  const receipt = await requireAnvilClient().waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`WETH deposit reverted: ${txHash}`);
  }
}

describe("flow --new-wallet ERC20 journeys", () => {
  beforeAll(async () => {
    if (!ANVIL_E2E_ENABLED) return;

    const snapshot = await captureSnapshot();
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

    stateDir = createTrackedTempDir("pp-flow-new-wallet-weth-");
    aspStateFile = join(stateDir, "asp-state.json");
    circuitsDir = SHARED_CIRCUITS_DIR || join(stateDir, "circuits");
    await resetAspState();

    aspServer = await launchAnvilAspServer(aspStateFile);
    relayerServer = await launchAnvilRelayerServer({
      chainId: chainConfig.id,
      rpcUrl: anvil.url,
      entrypoint: chainConfig.entrypoint,
      assetAddress: WETH_ADDRESS,
      feeReceiverAddress: relayerAddress,
      relayerPrivateKey,
      feeBPS: "50",
      minWithdrawAmount: "1",
      maxGasPrice: "100000000000",
    });

    await setBalance(anvil.url, signerAddress, 10n ** 20n);
    await setBalance(anvil.url, aspPostman, 10n ** 20n);
    await setBalance(anvil.url, relayerAddress, 10n ** 20n);

    baselineSnapshotId = await snapshotState(anvil.url);
  });

  beforeEach(async () => {
    if (!ANVIL_E2E_ENABLED) return;
    await resetFork();
  });

  afterEach(() => {
    restoreEnv("PRIVACY_POOLS_HOME");
    restoreEnv("PRIVACY_POOLS_RPC_URL_OP_SEPOLIA");
    restoreEnv("PRIVACY_POOLS_ASP_HOST");
    restoreEnv("PRIVACY_POOLS_RELAYER_HOST");
    restoreEnv("PRIVACY_POOLS_CIRCUITS_DIR");
  });

  afterAll(async () => {
    if (relayerServer) await killAnvilRelayerServer(relayerServer);
    if (aspServer) await killAnvilAspServer(aspServer);
    if (anvil) await killAnvil(anvil);
    if (stateDir) {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  anvilTest("flow start --new-wallet supports ERC20 funding and completes", async () => {
    const home = createAnvilHome("pp-anvil-flow-new-wallet-weth-");
    const exportPath = join(home, "flow-wallet.txt");

    const child = spawn(
      "bun",
      [
        "src/index.ts",
        "--agent",
        "flow",
        "start",
        "0.01",
        "WETH",
        "--to",
        relayedRecipient,
        "--new-wallet",
        "--export-new-wallet",
        exportPath,
        "--chain",
        "op-sepolia",
      ],
      {
        cwd: process.cwd(),
        env: buildChildProcessEnv({
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          ...cliEnv(),
        }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    try {
      const awaitingFunding = await waitForWorkflowSnapshotPhase(home, "awaiting_funding");
      expect(awaitingFunding.walletMode).toBe("new_wallet");
      expect(awaitingFunding.requiredNativeFunding).toMatch(/^\d+$/);
      expect(awaitingFunding.requiredTokenFunding).toMatch(/^\d+$/);

      const backup = parseWorkflowWalletBackup(exportPath);
      expect(awaitingFunding.walletAddress).toBe(backup.walletAddress);

      await setBalance(
        requireAnvil().url,
        backup.walletAddress,
        BigInt(awaitingFunding.requiredNativeFunding as string)
          + BigInt(awaitingFunding.requiredTokenFunding as string)
          + EXTRA_ETH_BUFFER,
      );
      await wrapEthToWeth(
        backup.privateKey,
        BigInt(awaitingFunding.requiredTokenFunding as string),
      );

      const awaitingAsp = await waitForCondition(
        "ERC20 new-wallet deposit",
        () => {
          const snapshot = readWorkflowSnapshot(home, awaitingFunding.workflowId as string);
          return snapshot.phase === "awaiting_asp" && snapshot.depositTxHash
            ? snapshot
            : null;
        },
        240_000,
        1_000,
      );

      const depositEvent = await decodeDeposit(
        awaitingAsp.depositTxHash as `0x${string}`,
      );
      appendInsertedStateTreeLeaf(depositEvent.commitment);
      await approveLabel(depositEvent.label);

      const childResult = await waitForChildProcessResult(child, 300_000);
      expect(childResult.code).toBe(0);
      const json = parseJsonOutput<{
        success: boolean;
        phase: string;
        asset: string;
        walletMode: string;
        withdrawTxHash: string;
      }>(childResult.stdout);
      expect(json.success).toBe(true);
      expect(json.phase).toBe("completed");
      expect(json.asset).toBe("WETH");
      expect(json.walletMode).toBe("new_wallet");
      expect(json.withdrawTxHash).toMatch(/^0x[0-9a-f]{64}$/);

      const remainingEth = await requireAnvilClient().getBalance({
        address: backup.walletAddress,
      });
      expect(remainingEth).toBeGreaterThan(0n);
    } finally {
      await terminateChildProcess(child);
    }
  });

  anvilTest("manual WETH deposit -> approve -> relayed withdraw succeeds with extra gas", async () => {
    const home = createAnvilHome("pp-anvil-manual-weth-withdraw-");
    const recipientBalanceBefore = (await requireAnvilClient().readContract({
      address: WETH_ADDRESS,
      abi: wethAbi,
      functionName: "balanceOf",
      args: [relayedRecipient],
    })) as bigint;

    await wrapEthToWeth(signerPrivateKey, 10n ** 16n);

    const depositResult = runCli(
      ["--agent", "deposit", "0.01", "WETH", "--chain", "op-sepolia"],
      {
        home,
        timeoutMs: 300_000,
        env: cliEnv(),
      },
    );
    expect(depositResult.status).toBe(0);
    const depositJson = parseJsonOutput<{
      success: boolean;
      poolAccountId: string;
      txHash: `0x${string}`;
    }>(depositResult.stdout);
    expect(depositJson.success).toBe(true);

    const depositEvent = await decodeDeposit(depositJson.txHash);
    appendInsertedStateTreeLeaf(depositEvent.commitment);
    await approveLabel(depositEvent.label);

    const withdrawResult = runCli(
      [
        "--agent",
        "withdraw",
        "--all",
        "WETH",
        "--to",
        relayedRecipient,
        "--from-pa",
        depositJson.poolAccountId,
        "--chain",
        "op-sepolia",
      ],
      {
        home,
        timeoutMs: 300_000,
        env: cliEnv(),
      },
    );
    expect(withdrawResult.status).toBe(0);
    const withdrawJson = parseJsonOutput<{
      success: boolean;
      mode: string;
      asset: string;
      extraGas?: boolean;
      txHash: string;
    }>(withdrawResult.stdout);
    expect(withdrawJson.success).toBe(true);
    expect(withdrawJson.mode).toBe("relayed");
    expect(withdrawJson.asset).toBe("WETH");
    expect(withdrawJson.extraGas).toBe(true);
    expect(withdrawJson.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const recipientBalanceAfter = (await requireAnvilClient().readContract({
      address: WETH_ADDRESS,
      abi: wethAbi,
      functionName: "balanceOf",
      args: [relayedRecipient],
    })) as bigint;
    expect(recipientBalanceAfter).toBeGreaterThan(recipientBalanceBefore);
  });

  anvilTest("flow start --new-wallet stays awaiting_funding when ERC20 token funding is missing", async () => {
    const home = createAnvilHome("pp-anvil-flow-new-wallet-weth-missing-token-");
    const exportPath = join(home, "flow-wallet.txt");

    const child = spawn(
      "bun",
      [
        "src/index.ts",
        "--agent",
        "flow",
        "start",
        "0.01",
        "WETH",
        "--to",
        relayedRecipient,
        "--new-wallet",
        "--export-new-wallet",
        exportPath,
        "--chain",
        "op-sepolia",
      ],
      {
        cwd: process.cwd(),
        env: buildChildProcessEnv({
          PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
          ...cliEnv(),
        }),
        stdio: "ignore",
      },
    );

    try {
      const awaitingFunding = await waitForWorkflowSnapshotPhase(home, "awaiting_funding");
      await setBalance(
        requireAnvil().url,
        awaitingFunding.walletAddress as string,
        BigInt(awaitingFunding.requiredNativeFunding as string),
      );

      await new Promise((resolve) => setTimeout(resolve, 12_000));
      await interruptChildProcess(child);

      const result = runCli(["--agent", "flow", "status", awaitingFunding.workflowId as string], {
        home,
        timeoutMs: 60_000,
        env: cliEnv(),
      });
      expect(result.status).toBe(0);
      const json = parseJsonOutput<{
        success: boolean;
        phase: string;
        walletMode: string;
        requiredTokenFunding: string;
      }>(result.stdout);
      expect(json.success).toBe(true);
      expect(json.phase).toBe("awaiting_funding");
      expect(json.walletMode).toBe("new_wallet");
      expect(json.requiredTokenFunding).toBe(awaitingFunding.requiredTokenFunding);
    } finally {
      await terminateChildProcess(child);
    }
  });
});
