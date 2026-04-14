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
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import {
  terminateChildProcess,
  waitForChildProcessResult,
} from "../helpers/process.ts";
import {
  assertWorkflowSnapshotRemains,
  waitForWorkflowSnapshotPhase,
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
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
} from "../helpers/cli.ts";

const ANVIL_E2E_ENABLED = process.env.PP_ANVIL_E2E === "1";
const anvilTest = ANVIL_E2E_ENABLED ? test : test.skip;
const nativeAnvilTest = ANVIL_E2E_ENABLED && CARGO_AVAILABLE ? test : test.skip;

const relayedRecipient = "0x4444444444444444444444444444444444444444" as const;
const EXTRA_ETH_BUFFER = 10n ** 16n;
const FLOW_AMOUNT = "100";
const FLOW_AMOUNT_RAW = 100_000_000n;
const aspPostman = "0x696fe46495688fc9e99bad2daf2133b33de364ea" as const;
const dummyCid = "bafybeigdyrzt5usdcsharedanviltests123456789012345678";

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

async function parseWorkflowWalletBackup(filePath: string): Promise<{
  walletAddress: `0x${string}`;
  privateKey: `0x${string}`;
}> {
  const content = await Bun.file(filePath).text();
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

async function mintUsdc(to: `0x${string}`, amount: bigint): Promise<void> {
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
    throw new Error(`USDC mint reverted: ${txHash}`);
  }
}

async function approveUsdcLabel(label: bigint): Promise<void> {
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

function spawnFlowStartProcess(
  home: string,
  exportPath: string,
  options: { useNativeLauncher?: boolean } = {},
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
      FLOW_AMOUNT,
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
        ...(options.useNativeLauncher
          ? { PRIVACY_POOLS_CLI_BINARY: requireNativeBinary() }
          : {}),
        ...sharedCliEnv(requireSharedEnv()),
      }),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

async function expectNewWalletUsdcJourneyCompletes(
  home: string,
  exportPath: string,
  options: {
    useNativeLauncher?: boolean;
    expectLabel?: string;
  } = {},
): Promise<void> {
  const recipientBalanceBefore = await requireAnvilClient().readContract({
    address: requireSharedEnv().pools.erc20.assetAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [relayedRecipient],
  }) as bigint;

  const child = spawnFlowStartProcess(home, exportPath, options);

  try {
    const awaitingFunding = await waitForWorkflowSnapshotPhase(home, "awaiting_funding");
    expect(awaitingFunding.walletMode).toBe("new_wallet");
    expect(awaitingFunding.requiredNativeFunding).toMatch(/^\d+$/);
    expect(awaitingFunding.requiredTokenFunding).toBe(FLOW_AMOUNT_RAW.toString());

    const backup = await parseWorkflowWalletBackup(exportPath);
    expect(awaitingFunding.walletAddress).toBe(backup.walletAddress);

    await setBalance(
      requireSharedEnv().rpcUrl,
      backup.walletAddress,
      BigInt(awaitingFunding.requiredNativeFunding as string) + EXTRA_ETH_BUFFER,
    );
    await mintUsdc(backup.walletAddress, FLOW_AMOUNT_RAW);

    const awaitingAsp = await waitForWorkflowSnapshotPhase(home, "awaiting_asp");
    const depositEvent = await decodeDepositEvent({
      publicClient: requireAnvilClient(),
      txHash: awaitingAsp.depositTxHash as `0x${string}`,
      poolAddress: requireSharedEnv().pools.erc20.poolAddress,
      depositedEventAbi,
    });
    appendInsertedStateTreeLeaf(
      requireSharedEnv(),
      "erc20",
      depositEvent.commitment,
    );
    await approveUsdcLabel(depositEvent.label);

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
    expect(json.phase, options.expectLabel).toBe("completed");
    expect(json.asset).toBe("USDC");
    expect(json.walletMode).toBe("new_wallet");
    expect(json.withdrawTxHash).toMatch(/^0x[0-9a-f]{64}$/);

    const recipientBalanceAfter = await requireAnvilClient().readContract({
      address: requireSharedEnv().pools.erc20.assetAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [relayedRecipient],
    }) as bigint;
    expect(recipientBalanceAfter).toBeGreaterThan(recipientBalanceBefore);
  } finally {
    await terminateChildProcess(child);
  }
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

describe("flow --new-wallet USDC journey on shared Anvil", () => {
  anvilTest("flow start --new-wallet supports USDC funding and completes", async () => {
    const home = createAnvilHome("pp-anvil-flow-new-wallet-usdc-");
    const exportPath = join(home, "flow-wallet.txt");
    await expectNewWalletUsdcJourneyCompletes(home, exportPath);
  });

  nativeAnvilTest("native launcher: flow start --new-wallet supports USDC funding and completes", async () => {
    const home = createAnvilHome("pp-anvil-native-flow-new-wallet-usdc-");
    const exportPath = join(home, "flow-wallet.txt");
    await expectNewWalletUsdcJourneyCompletes(home, exportPath, {
      useNativeLauncher: true,
      expectLabel: "native flow start --new-wallet",
    });
  });

  anvilTest("flow start --new-wallet stays awaiting_funding when native gas funding is missing for USDC", async () => {
    const home = createAnvilHome("pp-anvil-flow-new-wallet-usdc-missing-eth-");
    const exportPath = join(home, "flow-wallet.txt");

    const child = spawnFlowStartProcess(home, exportPath);

    try {
      const awaitingFunding = await waitForWorkflowSnapshotPhase(home, "awaiting_funding");
      expect(awaitingFunding.walletMode).toBe("new_wallet");
      expect(awaitingFunding.requiredTokenFunding).toBe(FLOW_AMOUNT_RAW.toString());

      const backup = await parseWorkflowWalletBackup(exportPath);
      await mintUsdc(backup.walletAddress, FLOW_AMOUNT_RAW);

      const snapshot = await assertWorkflowSnapshotRemains(
        home,
        awaitingFunding.workflowId as string,
        (current) =>
          current.phase === "awaiting_funding"
          && current.requiredNativeFunding === awaitingFunding.requiredNativeFunding,
        {
          description:
            "the workflow to remain in awaiting_funding until native gas arrives",
        },
      );
      expect(snapshot.phase).toBe("awaiting_funding");
      expect(snapshot.requiredNativeFunding).toBe(awaitingFunding.requiredNativeFunding);
    } finally {
      await terminateChildProcess(child);
    }
  });
});
