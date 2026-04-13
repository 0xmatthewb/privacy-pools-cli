import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { generateMerkleProof } from "@0xbow/privacy-pools-core-sdk";
import { resolveChain } from "../../src/utils/validation.ts";
import { setBalance } from "../helpers/anvil.ts";
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import {
  terminateChildProcess,
} from "../helpers/process.ts";
import {
  waitForWorkflowSnapshotPhase,
  readWorkflowSnapshot,
} from "../helpers/workflow-snapshot.ts";
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
import { CARGO_AVAILABLE, ensureNativeShellBinary } from "../helpers/native.ts";

const ANVIL_E2E_ENABLED = process.env.PP_ANVIL_E2E === "1";
const anvilTest = ANVIL_E2E_ENABLED ? test : test.skip;
const nativeAnvilTest = ANVIL_E2E_ENABLED && CARGO_AVAILABLE ? test : test.skip;

const aspPostman = "0x696fe46495688fc9e99bad2daf2133b33de364ea" as const;
const dummyCid = "bafybeigdyrzt5erc20sharedanviltests1234567890";
const relayedRecipient = "0x4444444444444444444444444444444444444444" as const;
const EXTRA_ETH_BUFFER = 10n ** 16n;

const entrypointAbi = parseAbi([
  "function updateRoot(uint256 _root, string _ipfsCID) returns (uint256 _index)",
]);

const depositedEventAbi = parseAbi([
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)",
]);

const erc20Abi = parseAbi([
  "function mint(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
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

function requireNativeBinary(): string {
  if (!nativeBinary) throw new Error("Native shell binary is not initialized");
  return nativeBinary;
}

async function readRelayerState(): Promise<{
  quoteRequests: number;
  lastQuoteRequest: {
    extraGas?: boolean;
    asset?: string;
    recipient?: string | null;
  } | null;
}> {
  const response = await fetch(`${requireSharedEnv().relayerUrl}/__state`);
  if (!response.ok) {
    throw new Error(`Failed to read Anvil relayer state: HTTP ${response.status}`);
  }
  return await response.json() as {
    quoteRequests: number;
    lastQuoteRequest: {
      extraGas?: boolean;
      asset?: string;
      recipient?: string | null;
    } | null;
  };
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

function runAnvilCli(
  home: string,
  args: string[],
  timeoutMs = 240_000,
  env: Record<string, string | undefined> = {},
) {
  return runCli(args, {
    home,
    timeoutMs,
    env: {
      ...sharedCliEnv(requireSharedEnv()),
      ...env,
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
  env?: Record<string, string | undefined>,
): T {
  const result = runAnvilCli(home, args, timeoutMs, env);
  expectSuccessStatus(result, label);
  return parseJsonOutput<T>(result.stdout);
}

function nativeLauncherEnv(enabled: boolean | undefined): Record<string, string | undefined> {
  return enabled
    ? {
        PRIVACY_POOLS_CLI_BINARY: requireNativeBinary(),
      }
    : {};
}

async function expectManualErc20JourneyCompletes(
  home: string,
  options: {
    useNativeLauncher?: boolean;
    expectLabel?: string;
  } = {},
): Promise<void> {
  const label = options.expectLabel ?? "erc20";
  const env = nativeLauncherEnv(options.useNativeLauncher);
  const recipientTokenBalanceBefore = await requireAnvilClient().readContract({
    address: requireSharedEnv().pools.erc20.assetAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [relayedRecipient],
  }) as bigint;

  await mintErc20(privateKeyToAccount(requireSharedEnv().signerPrivateKey).address, 100_000_000n);

  const depositJson = parseSuccessfulAgentResult<{
    success: boolean;
    txHash: `0x${string}`;
    poolAccountId: string;
  }>(
    home,
    ["--agent", "deposit", "100", "USDC", "--chain", "sepolia"],
    `${label} deposit`,
    300_000,
    env,
  );
  expect(depositJson.success).toBe(true);

  const depositEvent = await decodeDepositEvent({
    publicClient: requireAnvilClient(),
    txHash: depositJson.txHash,
    poolAddress: requireSharedEnv().pools.erc20.poolAddress,
    depositedEventAbi,
  });
  appendInsertedStateTreeLeaf(requireSharedEnv(), "erc20", depositEvent.commitment);
  await approveErc20Label(depositEvent.label);

  const withdrawJson = parseSuccessfulAgentResult<{
    success: boolean;
    mode: string;
    asset: string;
    extraGas?: boolean;
    txHash: string;
  }>(
    home,
    [
      "--agent",
      "withdraw",
      "--all",
      "USDC",
      "--to",
      relayedRecipient,
      "--pool-account",
      depositJson.poolAccountId,
      "--chain",
      "sepolia",
    ],
    `${label} withdraw`,
    300_000,
    env,
  );
  expect(withdrawJson.success).toBe(true);
  expect(withdrawJson.mode).toBe("relayed");
  expect(withdrawJson.asset).toBe("USDC");
  expect(withdrawJson.extraGas, label).toBe(true);
  expect(withdrawJson.txHash).toMatch(/^0x[0-9a-f]{64}$/);

  const recipientTokenBalanceAfter = await requireAnvilClient().readContract({
    address: requireSharedEnv().pools.erc20.assetAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [relayedRecipient],
  }) as bigint;
  const relayerState = await readRelayerState();
  expect(recipientTokenBalanceAfter).toBeGreaterThan(recipientTokenBalanceBefore);
  expect(relayerState.quoteRequests).toBeGreaterThan(0);
  expect(relayerState.lastQuoteRequest?.extraGas, label).toBe(true);
  expect(relayerState.lastQuoteRequest?.asset?.toLowerCase()).toBe(
    requireSharedEnv().pools.erc20.assetAddress.toLowerCase(),
  );
  expect(relayerState.lastQuoteRequest?.recipient?.toLowerCase()).toBe(
    relayedRecipient.toLowerCase(),
  );
}

function spawnFlowStartProcess(
  home: string,
  exportPath: string,
  options: {
    useNativeLauncher?: boolean;
  } = {},
) {
  return spawn(
    process.platform === "win32" ? "node.exe" : "node",
    [
      "--import",
      "tsx",
      "src/index.ts",
      "--agent",
      "flow",
      "start",
      "100",
      "USDC",
      "--to",
      relayedRecipient,
      "--privacy-delay",
      "off",
      "--new-wallet",
      "--export-new-wallet",
      exportPath,
      "--chain",
      "sepolia",
    ],
    {
      cwd: process.cwd(),
      env: buildChildProcessEnv({
        PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
        ...nativeLauncherEnv(options.useNativeLauncher),
        ...sharedCliEnv(requireSharedEnv()),
      }),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function parseWorkflowWalletBackup(filePath: string): Promise<{
  walletAddress: `0x${string}`;
  privateKey: `0x${string}`;
}> {
  const value = await Bun.file(filePath).text();
  const walletAddress = value.match(/Wallet Address:\s*(0x[a-fA-F0-9]{40})/)?.[1];
  const privateKey = value.match(/Private Key:\s*(0x[a-fA-F0-9]{64})/)?.[1];
  if (!walletAddress || !privateKey) {
    throw new Error(`Could not parse workflow wallet backup at ${filePath}`);
  }
  return {
    walletAddress: walletAddress as `0x${string}`,
    privateKey: privateKey as `0x${string}`,
  };
}

async function mintErc20(to: `0x${string}`, amount: bigint): Promise<void> {
  const signer = privateKeyToAccount(requireSharedEnv().signerPrivateKey);
  const walletClient = createWalletClient({
    account: signer,
    chain: chainConfig.chain,
    transport: http(requireSharedEnv().rpcUrl),
  });
  const txHash = await walletClient.writeContract({
    address: requireSharedEnv().pools.erc20.assetAddress,
    abi: erc20Abi,
    functionName: "mint",
    args: [to, amount],
  });
  const receipt = await requireAnvilClient().waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`ERC20 mint reverted: ${txHash}`);
  }
}

async function approveErc20Label(label: bigint): Promise<void> {
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
    poolKey: "erc20",
  });
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

describe("flow and manual ERC20 journeys on shared Anvil", () => {
  anvilTest("manual ERC20 deposit -> approve -> relayed withdraw succeeds with extra gas", async () => {
    const home = createAnvilHome("pp-anvil-erc20-manual-");
    await expectManualErc20JourneyCompletes(home);
  });

  nativeAnvilTest("native launcher: manual ERC20 deposit -> approve -> relayed withdraw succeeds with extra gas", async () => {
    const home = createAnvilHome("pp-anvil-native-erc20-manual-");
    await expectManualErc20JourneyCompletes(home, {
      useNativeLauncher: true,
      expectLabel: "native erc20",
    });
  });

  anvilTest("flow start --new-wallet stays awaiting_funding when ERC20 token funding is missing", async () => {
    const home = createAnvilHome("pp-anvil-erc20-missing-token-");
    const exportPath = join(home, "flow-wallet.txt");
    const child = spawnFlowStartProcess(home, exportPath);

    try {
      const awaitingFunding = await waitForWorkflowSnapshotPhase(home, "awaiting_funding");
      expect(awaitingFunding.walletMode).toBe("new_wallet");
      expect(awaitingFunding.requiredNativeFunding).toMatch(/^\d+$/);
      expect(awaitingFunding.requiredTokenFunding).toMatch(/^\d+$/);

      const backup = await parseWorkflowWalletBackup(exportPath);
      await setBalance(
        requireSharedEnv().rpcUrl,
        backup.walletAddress,
        BigInt(awaitingFunding.requiredNativeFunding as string) + EXTRA_ETH_BUFFER,
      );

      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const snapshot = readWorkflowSnapshot(home, awaitingFunding.workflowId as string);
      expect(snapshot.phase).toBe("awaiting_funding");
      expect(snapshot.requiredTokenFunding).toBe(awaitingFunding.requiredTokenFunding);
    } finally {
      await terminateChildProcess(child);
    }
  });

  nativeAnvilTest("native launcher: flow start --new-wallet stays awaiting_funding when ERC20 token funding is missing", async () => {
    const home = createAnvilHome("pp-anvil-native-erc20-missing-token-");
    const exportPath = join(home, "flow-wallet.txt");
    const child = spawnFlowStartProcess(home, exportPath, {
      useNativeLauncher: true,
    });

    try {
      const awaitingFunding = await waitForWorkflowSnapshotPhase(home, "awaiting_funding");
      expect(awaitingFunding.walletMode).toBe("new_wallet");
      expect(awaitingFunding.requiredNativeFunding).toMatch(/^\d+$/);
      expect(awaitingFunding.requiredTokenFunding).toMatch(/^\d+$/);

      const backup = await parseWorkflowWalletBackup(exportPath);
      await setBalance(
        requireSharedEnv().rpcUrl,
        backup.walletAddress,
        BigInt(awaitingFunding.requiredNativeFunding as string) + EXTRA_ETH_BUFFER,
      );

      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const snapshot = readWorkflowSnapshot(home, awaitingFunding.workflowId as string);
      expect(snapshot.phase).toBe("awaiting_funding");
      expect(snapshot.requiredTokenFunding).toBe(awaitingFunding.requiredTokenFunding);
    } finally {
      await terminateChildProcess(child);
    }
  });
});
