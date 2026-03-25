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
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseAbi,
} from "viem";
import { generateMerkleProof } from "@0xbow/privacy-pools-core-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, NATIVE_ASSET_ADDRESS } from "../../src/config/chains.ts";
import { resetCircuitArtifactsCacheForTests } from "../../src/services/circuits.ts";
import {
  loadWorkflowSnapshot,
  startWorkflow,
  watchWorkflow,
} from "../../src/services/workflow.ts";
import { createSeededHome } from "../helpers/cli.ts";
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
  type AnvilRelayerConfig,
  type AnvilRelayerServer,
} from "../helpers/anvil-relayer-server.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";

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
let stateDir = "";

const ORIGINAL_ENV = {
  PRIVACY_POOLS_HOME: process.env.PRIVACY_POOLS_HOME,
  PRIVACY_POOLS_RPC_URL_SEPOLIA: process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA,
  PRIVACY_POOLS_ASP_HOST: process.env.PRIVACY_POOLS_ASP_HOST,
  PRIVACY_POOLS_RELAYER_HOST: process.env.PRIVACY_POOLS_RELAYER_HOST,
  PRIVACY_POOLS_CIRCUITS_DIR: process.env.PRIVACY_POOLS_CIRCUITS_DIR,
};

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

function requireAnvil(): AnvilInstance {
  if (!anvil) throw new Error("Anvil is not running");
  return anvil;
}

function requireAspServer(): AnvilAspServer {
  if (!aspServer) throw new Error("ASP server is not running");
  return aspServer;
}

function requireRelayerServer(): AnvilRelayerServer {
  if (!relayerServer) throw new Error("Relayer server is not running");
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

  throw new Error("Could not capture a consistent Sepolia ETH state-tree snapshot");
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

async function publishApprovedLabels(labels: readonly bigint[]): Promise<void> {
  const labelStrings = labels.map((value) => value.toString());
  const root = computeMerkleRoot(labelStrings);
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
    approvedLabels: labelStrings,
    reviewStatuses: {
      ...requireAspState().reviewStatuses,
      ...Object.fromEntries(
        labelStrings.map((value) => [value, "approved"] as const),
      ),
    },
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
  const reverted = await revertState(requireAnvil().url, baselineSnapshotId);
  if (!reverted) {
    throw new Error("Failed to revert the Anvil fork to the baseline snapshot");
  }
  baselineSnapshotId = await snapshotState(requireAnvil().url);
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
  process.env.PRIVACY_POOLS_RPC_URL_SEPOLIA = requireAnvil().url;
  process.env.PRIVACY_POOLS_ASP_HOST = requireAspServer().url;
  process.env.PRIVACY_POOLS_RELAYER_HOST = requireRelayerServer().url;
  process.env.PRIVACY_POOLS_CIRCUITS_DIR =
    options.circuitsDirOverride ?? circuitsDir;
  return home;
}

function buildRelayerConfig(
  overrides: Partial<AnvilRelayerConfig> = {},
): AnvilRelayerConfig {
  return {
    chainId: chainConfig.id,
    rpcUrl: requireAnvil().url,
    entrypoint: chainConfig.entrypoint,
    assetAddress: NATIVE_ASSET_ADDRESS,
    feeReceiverAddress: relayerAddress,
    relayerPrivateKey,
    feeBPS: "50",
    minWithdrawAmount: "1",
    maxGasPrice: "100000000000",
    ...overrides,
  };
}

async function restartRelayerServer(
  overrides: Partial<AnvilRelayerConfig> = {},
): Promise<void> {
  if (relayerServer) {
    await killAnvilRelayerServer(relayerServer);
  }
  relayerServer = await launchAnvilRelayerServer(buildRelayerConfig(overrides));
  process.env.PRIVACY_POOLS_RELAYER_HOST = relayerServer.url;
}

async function readRelayerState(): Promise<{
  quoteRequests: number;
}> {
  const response = await fetch(`${requireRelayerServer().url}/__state`);
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
      rpcUrl: requireAnvil().url,
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

    await setBalance(anvil.url, signerAddress, 10n ** 20n);
    await setBalance(anvil.url, aspPostman, 10n ** 20n);
    await setBalance(anvil.url, relayerAddress, 10n ** 20n);

    stateDir = createTrackedTempDir("pp-workflow-service-anvil-");
    aspStateFile = join(stateDir, "state.json");
    circuitsDir = join(stateDir, "circuits");
    writeFileSync(join(stateDir, ".keep"), "", "utf8");
    await resetAspState();

    aspServer = await launchAnvilAspServer(aspStateFile);
    relayerServer = await launchAnvilRelayerServer(buildRelayerConfig());

    baselineSnapshotId = await snapshotState(anvil.url);
  });

  beforeEach(async () => {
    if (!ANVIL_E2E_ENABLED) return;
    await resetFork();
    await restartRelayerServer();
  });

  afterEach(() => {
    resetCircuitArtifactsCacheForTests();
    restoreEnv("PRIVACY_POOLS_HOME");
    restoreEnv("PRIVACY_POOLS_RPC_URL_SEPOLIA");
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

  anvilTest("startWorkflow + watchWorkflow completes the approved path", async () => {
    const { snapshot, label } = await startServiceFlow("pp-workflow-service-approved-");
    await approveLabel(label);

    const watched = await watchWorkflow({
      workflowId: snapshot.workflowId,
      globalOpts: {
        chain: "sepolia",
        rpcUrl: requireAnvil().url,
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
        rpcUrl: requireAnvil().url,
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
        rpcUrl: requireAnvil().url,
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
        rpcUrl: requireAnvil().url,
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
          rpcUrl: requireAnvil().url,
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
      await restartRelayerServer({
        quoteSequence: [
          { feeBPS: "50", expirationOffsetMs: 1_000 },
          { feeBPS: "50", expirationOffsetMs: 600_000 },
        ],
      });
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
          rpcUrl: requireAnvil().url,
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
      await restartRelayerServer({
        quoteSequence: [
          { feeBPS: "50", expirationOffsetMs: 1_000 },
          { feeBPS: "75", expirationOffsetMs: 600_000 },
        ],
      });
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
            rpcUrl: requireAnvil().url,
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
      await restartRelayerServer();
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
          rpcUrl: requireAnvil().url,
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
