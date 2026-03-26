import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { generateMerkleProof } from "@0xbow/privacy-pools-core-sdk";
import { CHAINS, NATIVE_ASSET_ADDRESS } from "../../src/config/chains.ts";
import {
  ensureCircuitArtifacts,
  resetCircuitArtifactsCacheForTests,
} from "../../src/services/circuits.ts";
import {
  type FlowSnapshot,
  loadWorkflowSnapshot,
  startWorkflow,
  watchWorkflow,
} from "../../src/services/workflow.ts";
import { resolveChain } from "../../src/utils/validation.ts";
import { createSeededHome } from "../helpers/cli.ts";
import {
  impersonateAccount,
  setBalance,
  stopImpersonatingAccount,
} from "../helpers/anvil.ts";
import {
  writeAnvilAspState,
  type AnvilAspState,
} from "../helpers/anvil-asp-server.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";
import {
  applySharedAnvilProcessEnv,
  configureSharedRelayer,
  loadSharedAnvilEnv,
  resetSharedAnvilEnv,
  restoreSharedAnvilProcessEnv,
  sharedAnvilCliEnv,
  type SharedAnvilEnv,
} from "../helpers/shared-anvil-env.ts";

const ANVIL_E2E_ENABLED = process.env.PP_ANVIL_E2E === "1";
const anvilTest = ANVIL_E2E_ENABLED ? test : test.skip;

const aspPostman = "0x696fe46495688fc9e99bad2daf2133b33de364ea" as const;
const dummyCid = "bafybeigdyrzt5dummycidforworkflowservicetests1234567890";
const relayedRecipient = "0x4444444444444444444444444444444444444444" as const;
const MACHINE_MODE = {
  isAgent: true,
  isJson: true,
  isCsv: false,
  isQuiet: true,
  format: "json" as const,
  skipPrompts: true,
};

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

let sharedEnv: SharedAnvilEnv | null = null;
let anvilClient: ReturnType<typeof createPublicClient> | null = null;
let chainConfig = CHAINS.sepolia;
let poolAddress: `0x${string}`;
let aspStateFile = "";
let circuitsDir = "";
let aspState: AnvilAspState | null = null;

const ORIGINAL_ENV = {
  PRIVACY_POOLS_HOME: process.env.PRIVACY_POOLS_HOME,
  PRIVACY_POOLS_RPC_URL_SEPOLIA: process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA,
  PRIVACY_POOLS_ASP_HOST: process.env.PRIVACY_POOLS_ASP_HOST,
  PRIVACY_POOLS_RELAYER_HOST: process.env.PRIVACY_POOLS_RELAYER_HOST,
  PRIVACY_POOLS_CIRCUITS_DIR: process.env.PRIVACY_POOLS_CIRCUITS_DIR,
  PP_TEST_ENTRYPOINT_SEPOLIA: process.env.PP_TEST_ENTRYPOINT_SEPOLIA,
  PP_TEST_START_BLOCK_SEPOLIA: process.env.PP_TEST_START_BLOCK_SEPOLIA,
};

function requireSharedEnv(): SharedAnvilEnv {
  if (!sharedEnv) throw new Error("Shared Anvil environment is not initialized");
  return sharedEnv;
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
  const normalized = leaves.map((leaf) => BigInt(leaf));
  const proof = generateMerkleProof(
    normalized,
    normalized[normalized.length - 1],
  );
  return BigInt((proof as { root: bigint | string }).root);
}

function writeCurrentAspState(): void {
  writeAnvilAspState(aspStateFile, requireAspState());
}

async function resetAspState(): Promise<void> {
  aspState = JSON.parse(readFileSync(aspStateFile, "utf8")) as AnvilAspState;
}

function appendInsertedStateTreeLeaf(commitment: bigint): void {
  const state = requireAspState();
  const [ethPool, ...otherPools] = state.pools;
  aspState = {
    ...state,
    pools: [
      {
        ...ethPool,
        insertedStateTreeLeaves: [
          ...ethPool.insertedStateTreeLeaves,
          commitment.toString(),
        ],
      },
      ...otherPools,
    ],
  };
  writeCurrentAspState();
}

function setLabelReviewStatus(
  label: bigint,
  reviewStatus: "pending" | "declined" | "poi_required",
): void {
  const labelString = label.toString();
  const state = requireAspState();
  const [ethPool, ...otherPools] = state.pools;
  aspState = {
    ...state,
    pools: [
      {
        ...ethPool,
        approvedLabels: ethPool.approvedLabels.filter(
          (value) => value !== labelString,
        ),
        reviewStatuses: {
          ...ethPool.reviewStatuses,
          [labelString]: reviewStatus,
        },
      },
      ...otherPools,
    ],
  };
  writeCurrentAspState();
}

async function publishApprovedLabels(labels: readonly bigint[]): Promise<void> {
  const env = requireSharedEnv();
  const labelStrings = labels.map((value) => value.toString());
  const root = computeMerkleRoot(labelStrings);
  await impersonateAccount(env.rpcUrl, aspPostman);
  await setBalance(env.rpcUrl, aspPostman, 10n ** 20n);

  try {
    const walletClient = createWalletClient({
      account: aspPostman,
      chain: chainConfig.chain,
      transport: http(env.rpcUrl),
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
    await stopImpersonatingAccount(env.rpcUrl, aspPostman);
  }

  const state = requireAspState();
  const [ethPool, ...otherPools] = state.pools;
  aspState = {
    ...state,
    pools: [
      {
        ...ethPool,
        approvedLabels: labelStrings,
        reviewStatuses: {
          ...ethPool.reviewStatuses,
          ...Object.fromEntries(
            labelStrings.map((value) => [value, "approved"] as const),
          ),
        },
      },
      ...otherPools,
    ],
  };
  writeCurrentAspState();
}

async function approveLabel(label: bigint): Promise<void> {
  await publishApprovedLabels([label]);
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

async function resetFork(): Promise<void> {
  await resetSharedAnvilEnv(requireSharedEnv());
  await resetAspState();
}

function useServiceHome(
  prefix: string,
  options: {
    circuitsDirOverride?: string;
  } = {},
): string {
  const home = createSeededHome("sepolia");
  process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools");
  applySharedAnvilProcessEnv(requireSharedEnv());
  process.env.PRIVACY_POOLS_CIRCUITS_DIR =
    options.circuitsDirOverride ?? circuitsDir;
  return home;
}

async function configureEthRelayer(
  quoteSequence?: Array<{
    feeBPS?: string;
    expirationOffsetMs?: number;
  }>,
): Promise<void> {
  const env = requireSharedEnv();
  const feeReceiverAddress = privateKeyToAccount(env.relayerPrivateKey).address;
  await configureSharedRelayer(env, {
    assets: [
      {
        assetAddress: env.pools.eth.assetAddress,
        feeReceiverAddress,
        feeBPS: "50",
        minWithdrawAmount: "1",
        maxGasPrice: "100000000000",
        quoteSequence,
      },
      {
        assetAddress: env.pools.erc20.assetAddress,
        feeReceiverAddress,
        feeBPS: env.pools.erc20.maxRelayFeeBPS,
        minWithdrawAmount: env.pools.erc20.minimumDepositAmount,
        maxGasPrice: "100000000000",
      },
    ],
  });
}

async function readRelayerState(): Promise<{
  quoteRequests: number;
}> {
  const response = await fetch(`${requireSharedEnv().relayerUrl}/__state`);
  if (!response.ok) {
    throw new Error(`Failed to read relayer state: HTTP ${response.status}`);
  }
  return await response.json() as { quoteRequests: number };
}

async function startServiceFlow(
  prefix: string,
  options: {
    circuitsDirOverride?: string;
  } = {},
): Promise<{
  home: string;
  snapshot: Awaited<ReturnType<typeof startWorkflow>>;
  label: bigint;
}> {
  const home = useServiceHome(prefix, options);
  const snapshot = await startWorkflow({
    amountInput: "0.01",
    assetInput: "ETH",
    recipient: relayedRecipient,
    globalOpts: {
      chain: "sepolia",
      rpcUrl: requireSharedEnv().rpcUrl,
    },
    mode: MACHINE_MODE,
    isVerbose: false,
    watch: false,
  });

  const depositEvent = await decodeDeposit(snapshot.depositTxHash as `0x${string}`);
  appendInsertedStateTreeLeaf(depositEvent.commitment);

  return {
    home,
    snapshot,
    label: depositEvent.label,
  };
}

describe("workflow service on Anvil", () => {
  beforeAll(async () => {
    if (!ANVIL_E2E_ENABLED) return;

    sharedEnv = loadSharedAnvilEnv();
    applySharedAnvilProcessEnv(sharedEnv);
    chainConfig = resolveChain("sepolia");
    poolAddress = sharedEnv.pools.eth.poolAddress;
    aspStateFile = sharedEnv.aspStateFile;
    circuitsDir = sharedEnv.circuitsDir;
    anvilClient = createPublicClient({
      chain: chainConfig.chain,
      transport: http(sharedEnv.rpcUrl),
    });

    await resetSharedAnvilEnv(sharedEnv);
    await resetAspState();
    process.env.PRIVACY_POOLS_CIRCUITS_DIR = circuitsDir;
    await ensureCircuitArtifacts();
    resetCircuitArtifactsCacheForTests();
  });

  beforeEach(async () => {
    if (!ANVIL_E2E_ENABLED) return;
    await resetFork();
    await configureEthRelayer();
  });

  afterEach(() => {
    resetCircuitArtifactsCacheForTests();
    restoreSharedAnvilProcessEnv(ORIGINAL_ENV);
  });

  afterAll(async () => {
    restoreSharedAnvilProcessEnv(ORIGINAL_ENV);
  });

  anvilTest("startWorkflow + watchWorkflow completes the approved path", async () => {
    const { snapshot, label } = await startServiceFlow("pp-workflow-service-approved-");
    await approveLabel(label);

    const watched = await watchWorkflow({
      workflowId: snapshot.workflowId,
      globalOpts: {
        chain: "sepolia",
        rpcUrl: requireSharedEnv().rpcUrl,
      },
      mode: MACHINE_MODE,
      isVerbose: false,
    });

    expect(watched.phase).toBe("completed");
    expect(watched.withdrawTxHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(loadWorkflowSnapshot(snapshot.workflowId).phase).toBe("completed");
  });

  anvilTest("watchWorkflow pauses declined workflows", async () => {
    const { snapshot, label } = await startServiceFlow("pp-workflow-service-declined-");
    setLabelReviewStatus(label, "declined");

    const watched = await watchWorkflow({
      workflowId: snapshot.workflowId,
      globalOpts: {
        chain: "sepolia",
        rpcUrl: requireSharedEnv().rpcUrl,
      },
      mode: MACHINE_MODE,
      isVerbose: false,
    });

    expect(watched.phase).toBe("paused_declined");
    expect(watched.aspStatus).toBe("declined");
  });

  anvilTest("watchWorkflow pauses poi_required workflows", async () => {
    const { snapshot, label } = await startServiceFlow("pp-workflow-service-poi-");
    setLabelReviewStatus(label, "poi_required");

    const watched = await watchWorkflow({
      workflowId: snapshot.workflowId,
      globalOpts: {
        chain: "sepolia",
        rpcUrl: requireSharedEnv().rpcUrl,
      },
      mode: MACHINE_MODE,
      isVerbose: false,
    });

    expect(watched.phase).toBe("paused_poi_required");
    expect(watched.aspStatus).toBe("poi_required");
  });

  anvilTest("watchWorkflow stops when the saved workflow no longer matches the Pool Account", async () => {
    const { snapshot } = await startServiceFlow("pp-workflow-service-stopped-");
    const filePath = join(
      process.env.PRIVACY_POOLS_HOME!,
      "workflows",
      `${snapshot.workflowId}.json`,
    );
    const saved = JSON.parse(readFileSync(filePath, "utf8")) as FlowSnapshot;
    saved.committedValue = "1";
    writeFileSync(filePath, JSON.stringify(saved, null, 2), "utf8");

    const watched = await watchWorkflow({
      workflowId: snapshot.workflowId,
      globalOpts: {
        chain: "sepolia",
        rpcUrl: requireSharedEnv().rpcUrl,
      },
      mode: MACHINE_MODE,
      isVerbose: false,
    });

    expect(watched.phase).toBe("stopped_external");
  });

  anvilTest("startWorkflow still enforces the non-round amount privacy guard", async () => {
    useServiceHome("pp-workflow-service-rounding-");

    await expect(
      startWorkflow({
        amountInput: "0.011",
        assetInput: "ETH",
        recipient: relayedRecipient,
        globalOpts: {
          chain: "sepolia",
          rpcUrl: requireSharedEnv().rpcUrl,
        },
        mode: MACHINE_MODE,
        isVerbose: false,
        watch: false,
      }),
    ).rejects.toThrow("may reduce privacy");
  });

  anvilTest(
    "watchWorkflow refreshes the relayer quote after proof generation when the fee is unchanged",
    async () => {
      await configureEthRelayer([
        { feeBPS: "50", expirationOffsetMs: 1_000 },
        { feeBPS: "50", expirationOffsetMs: 600_000 },
      ]);
      const freshCircuitsDir = createTrackedTempDir(
        "pp-workflow-service-refresh-circuits-",
      );
      const { snapshot, label } = await startServiceFlow(
        "pp-workflow-service-refresh-same-fee-",
        {
          circuitsDirOverride: freshCircuitsDir,
        },
      );
      await approveLabel(label);

      const watched = await watchWorkflow({
        workflowId: snapshot.workflowId,
        globalOpts: {
          chain: "sepolia",
          rpcUrl: requireSharedEnv().rpcUrl,
        },
        mode: MACHINE_MODE,
        isVerbose: false,
      });

      expect(watched.phase).toBe("completed");
      expect((await readRelayerState()).quoteRequests).toBeGreaterThanOrEqual(2);
    },
  );

  anvilTest(
    "watchWorkflow fails closed when the relayer fee changes after proof generation",
    async () => {
      await configureEthRelayer([
        { feeBPS: "50", expirationOffsetMs: 1_000 },
        { feeBPS: "75", expirationOffsetMs: 600_000 },
      ]);
      const freshCircuitsDir = createTrackedTempDir(
        "pp-workflow-service-fee-change-circuits-",
      );
      const { snapshot, label } = await startServiceFlow(
        "pp-workflow-service-fee-change-",
        {
          circuitsDirOverride: freshCircuitsDir,
        },
      );
      await approveLabel(label);

      await expect(
        watchWorkflow({
          workflowId: snapshot.workflowId,
          globalOpts: {
            chain: "sepolia",
            rpcUrl: requireSharedEnv().rpcUrl,
          },
          mode: MACHINE_MODE,
          isVerbose: false,
        }),
      ).rejects.toThrow("Relayer fee changed during proof generation");

      const errored = loadWorkflowSnapshot(snapshot.workflowId);
      expect(errored.lastError?.step).toBe("withdraw");
      expect(errored.lastError?.errorMessage).toContain(
        "Relayer fee changed during proof generation",
      );
      expect((await readRelayerState()).quoteRequests).toBeGreaterThanOrEqual(2);
    },
  );

  anvilTest(
    "watchWorkflow fails closed when the ASP root changes during proof generation",
    async () => {
      await configureEthRelayer();
      const freshCircuitsDir = createTrackedTempDir(
        "pp-workflow-service-root-change-circuits-",
      );
      const { snapshot, label } = await startServiceFlow(
        "pp-workflow-service-root-change-",
        {
          circuitsDirOverride: freshCircuitsDir,
        },
      );
      await approveLabel(label);

      const rootChange = new Promise<void>((resolve) => {
        setTimeout(() => {
          publishApprovedLabels([label, label + 1n]).finally(resolve);
        }, 1_000);
      });

      const watchPromise = watchWorkflow({
        workflowId: snapshot.workflowId,
        globalOpts: {
          chain: "sepolia",
          rpcUrl: requireSharedEnv().rpcUrl,
        },
        mode: MACHINE_MODE,
        isVerbose: false,
      });

      await expect(watchPromise).rejects.toThrow(
        /Pool state changed|Relayer request failed: Relay transaction reverted/,
      );

      await rootChange;

      const errored = loadWorkflowSnapshot(snapshot.workflowId);
      expect(errored.lastError?.step).toBe("withdraw");
      expect(errored.lastError?.errorMessage).toMatch(
        /Pool state changed|Relayer request failed: Relay transaction reverted/,
      );
    },
  );
});
