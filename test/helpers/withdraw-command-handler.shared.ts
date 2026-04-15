import {
  afterEach,
  beforeEach,
  mock,
} from "bun:test";
import type { Command } from "commander";
import type { Address } from "viem";
import { CHAINS } from "../../src/config/chains.ts";
import { CLIError } from "../../src/utils/errors.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "./output.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "./module-mocks.ts";
import {
  expectPrintedRawTransactions,
  expectUnsignedTransactions,
} from "./unsigned-assertions.ts";
import { encodeRelayerWithdrawalData } from "./relayer-withdrawal-data.ts";
import { createTestWorld, type TestWorld } from "./test-world.ts";
import { restoreTestTty, setTestTty } from "./tty.ts";

const realAccount = captureModuleExports(
  await import("../../src/services/account.ts"),
);
const realContracts = captureModuleExports(
  await import("../../src/services/contracts.ts"),
);
const realInquirerPrompts = captureModuleExports(
  await import("@inquirer/prompts"),
);
const realPoolAccounts = captureModuleExports(
  await import("../../src/utils/pool-accounts.ts"),
);
const realPools = captureModuleExports(
  await import("../../src/services/pools.ts"),
);
const realAsp = captureModuleExports(await import("../../src/services/asp.ts"));
const realRelayer = captureModuleExports(
  await import("../../src/services/relayer.ts"),
);
const realProofs = captureModuleExports(
  await import("../../src/services/proofs.ts"),
);
const realSdk = captureModuleExports(await import("../../src/services/sdk.ts"));
const realPreflight = captureModuleExports(
  await import("../../src/utils/preflight.ts"),
);
const realLock = captureModuleExports(await import("../../src/utils/lock.ts"));
const realCriticalSection = captureModuleExports(
  await import("../../src/utils/critical-section.ts"),
);
const realUnsigned = captureModuleExports(
  await import("../../src/utils/unsigned.ts"),
);
const realPreviewRuntime = captureModuleExports(
  await import("../../src/preview/runtime.ts"),
);
const realPromptCancellation = captureModuleExports(
  await import("../../src/utils/prompt-cancellation.ts"),
);
const realSetupRecovery = captureModuleExports(
  await import("../../src/utils/setup-recovery.ts"),
);
const realValidation = captureModuleExports(
  await import("../../src/utils/validation.ts"),
);
const realSdkPackage = captureModuleExports(
  await import("@0xbow/privacy-pools-core-sdk"),
);

const WITHDRAW_HANDLER_MODULE_RESTORES = [
  ["@inquirer/prompts", realInquirerPrompts],
  ["../../src/services/account.ts", realAccount],
  ["../../src/services/sdk.ts", realSdk],
  ["../../src/services/pools.ts", realPools],
  ["../../src/services/asp.ts", realAsp],
  ["../../src/services/relayer.ts", realRelayer],
  ["../../src/services/proofs.ts", realProofs],
  ["../../src/services/contracts.ts", realContracts],
  ["../../src/utils/pool-accounts.ts", realPoolAccounts],
  ["../../src/utils/preflight.ts", realPreflight],
  ["../../src/utils/lock.ts", realLock],
  ["../../src/utils/critical-section.ts", realCriticalSection],
  ["../../src/utils/unsigned.ts", realUnsigned],
  ["../../src/preview/runtime.ts", realPreviewRuntime],
  ["../../src/utils/prompt-cancellation.ts", realPromptCancellation],
  ["../../src/utils/setup-recovery.ts", realSetupRecovery],
  ["../../src/utils/validation.ts", realValidation],
  ["@0xbow/privacy-pools-core-sdk", realSdkPackage],
] as const;

const ETH_POOL = {
  symbol: "ETH",
  pool: "0x1111111111111111111111111111111111111111",
  asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  scope: 1n,
  decimals: 18,
  deploymentBlock: 1n,
  minimumDepositAmount: 10000000000000000n,
  maxRelayFeeBPS: 300n,
};

const USDC_POOL = {
  ...ETH_POOL,
  symbol: "USDC",
  asset: "0x2222222222222222222222222222222222222222",
  decimals: 6,
  minimumDepositAmount: 1_000_000n,
};

const OP_SEPOLIA_WETH_POOL = {
  ...ETH_POOL,
  symbol: "WETH",
  asset: "0x4200000000000000000000000000000000000006" as Address,
};

const APPROVED_POOL_ACCOUNT = {
  paNumber: 1,
  paId: "PA-1",
  status: "approved",
  aspStatus: "approved",
  commitment: {
    hash: 501n,
    label: 601n,
    value: 1000000000000000000n,
    nullifier: 701n,
    secret: 801n,
    blockNumber: 123n,
    txHash: "0x" + "aa".repeat(32),
  },
  label: 601n,
  value: 1000000000000000000n,
  blockNumber: 123n,
  txHash: "0x" + "aa".repeat(32),
};

const PENDING_POOL_ACCOUNT = {
  ...APPROVED_POOL_ACCOUNT,
  paNumber: 2,
  paId: "PA-2",
  status: "pending",
  aspStatus: "pending",
  commitment: {
    ...APPROVED_POOL_ACCOUNT.commitment,
    hash: 502n,
    label: 602n,
    txHash: "0x" + "bb".repeat(32),
  },
  label: 602n,
  txHash: "0x" + "bb".repeat(32),
};

const DEFAULT_RELAYER_RECIPIENT =
  "0x4444444444444444444444444444444444444444" as Address;
const DEFAULT_RELAYER_FEE_RECEIVER =
  "0x3333333333333333333333333333333333333333" as Address;

function buildRelayerQuote(params: {
  recipient?: Address;
  feeRecipient?: Address;
  feeBPS?: string;
  expiration?: number;
  asset?: Address;
  amount?: string;
  extraGas?: boolean;
  signedRelayerCommitment?: `0x${string}`;
  relayerUrl?: string;
} = {}) {
  const feeBPS = params.feeBPS ?? "250";
  return {
    baseFeeBPS: "200",
    feeBPS,
    gasPrice: "1",
    relayerUrl: params.relayerUrl ?? "https://fastrelay.xyz",
    detail: { relayTxCost: { gas: "0", eth: "0" } },
    feeCommitment: {
      expiration: params.expiration ?? 4_102_444_800_000,
      withdrawalData: encodeRelayerWithdrawalData({
        recipient: params.recipient ?? DEFAULT_RELAYER_RECIPIENT,
        feeRecipient: params.feeRecipient ?? DEFAULT_RELAYER_FEE_RECEIVER,
        relayFeeBPS: BigInt(feeBPS),
      }),
      asset: params.asset ?? ETH_POOL.asset,
      amount: params.amount ?? "100000000000000000",
      extraGas: params.extraGas ?? false,
      signedRelayerCommitment: params.signedRelayerCommitment ?? "0x01",
    },
  };
}

const initializeAccountServiceMock = mock(async () => ({
  account: { poolAccounts: new Map() },
  getSpendableCommitments: () =>
    new Map([
      [
        1n,
        [
          APPROVED_POOL_ACCOUNT.commitment,
          PENDING_POOL_ACCOUNT.commitment,
        ],
      ],
    ]),
  createWithdrawalSecrets: () => ({
    nullifier: 901n,
    secret: 902n,
  }),
  addWithdrawalCommitment: mock(() => undefined),
}));
const saveAccountMock = mock(() => undefined);
const saveSyncMetaMock = mock(() => undefined);
const withSuppressedSdkStdoutSyncMock = mock(<T>(fn: () => T): T => fn());
const getDataServiceMock = mock(async () => ({}));
const getPublicClientMock = mock(() => ({
  readContract: async (_args: { functionName: string; address: string }) => 1n,
  waitForTransactionReceipt: async () => ({
    status: "success",
    blockNumber: 456n,
  }),
}));
const resolvePoolMock = mock(async () => ETH_POOL);
const listPoolsMock = mock(async () => [ETH_POOL]);
const fetchMerkleRootsMock = mock(async () => ({
  mtRoot: "1",
  onchainMtRoot: "1",
}));
const fetchMerkleLeavesMock = mock(async () => ({
  aspLeaves: ["601"],
  stateTreeLeaves: ["501"],
}));
const fetchDepositsLargerThanMock = mock(async () => ({
  eligibleDeposits: 8,
  totalDeposits: 12,
  percentage: 66.7,
}));
const fetchDepositReviewStatusesMock = mock(async () =>
  new Map<string, string>([
    ["601", "approved"],
    ["602", "pending"],
  ]),
);
const buildLoadedAspDepositReviewStateMock = mock(() => ({
  approvedLabels: new Set<string>(["601"]),
  reviewStatuses: new Map<string, string>([
    ["601", "approved"],
    ["602", "pending"],
  ]),
}));
const getRelayerDetailsMock = mock(async () => ({
  minWithdrawAmount: "10000000000000000",
  feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
  relayerUrl: "https://fastrelay.xyz",
}));
const requestQuoteMock = mock(
  async (
    _chainConfig: unknown,
    params?: {
      recipient?: Address;
      asset?: Address;
      amount?: bigint;
      extraGas?: boolean;
      relayerUrl?: string;
    },
  ) =>
    buildRelayerQuote({
      recipient: params?.recipient,
      asset: params?.asset,
      amount: params?.amount?.toString(),
      extraGas: params?.extraGas,
      relayerUrl: params?.relayerUrl,
    }),
);
const submitRelayRequestMock = mock(async () => ({
  txHash: "0x" + "34".repeat(32),
}));
const proveWithdrawalMock = mock(async () => ({
  proof: {
    pi_a: ["0", "0", "1"],
    pi_b: [
      ["0", "0"],
      ["0", "0"],
      ["1", "0"],
    ],
    pi_c: ["0", "0", "1"],
  },
  publicSignals: [1n, 2n, 3n],
}));
const withdrawDirectMock = mock(async () => ({
  hash: "0x" + "56".repeat(32),
}));
const buildPoolAccountRefsMock = mock(() => [
  APPROVED_POOL_ACCOUNT,
  PENDING_POOL_ACCOUNT,
]);
const buildAllPoolAccountRefsMock = mock(() => [
  APPROVED_POOL_ACCOUNT,
  PENDING_POOL_ACCOUNT,
]);
const collectActiveLabelsMock = mock(() => ["601", "602"]);
const describeUnavailablePoolAccountMock = mock(() => null);
const getUnknownPoolAccountErrorMock = mock(() => ({
  message: "Unknown Pool Account.",
  hint: "Choose a valid Pool Account.",
}));
const parsePoolAccountSelectorMock = mock((raw: string) => {
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : null;
});
const checkHasGasMock = mock(async () => undefined);
const acquireProcessLockMock = mock(() => () => undefined);
const guardCriticalSectionMock = mock(() => undefined);
const releaseCriticalSectionMock = mock(() => undefined);
const generateMerkleProofMock = mock((values: bigint[], target: bigint) => ({
  root: values.includes(target) ? 1n : 0n,
  siblings: [],
  pathIndices: [],
}));
const calculateContextMock = mock(() => 777n);
const toWithdrawSolidityProofMock = mock(() => ({
  pA: [0n, 0n],
  pB: [
    [0n, 0n],
    [0n, 0n],
  ],
  pC: [0n, 0n],
  pubSignals: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
}));
const stringifyBigIntsMock = mock((value: unknown) => value);
const printRawTransactionsMock = mock(() => undefined);
const maybeRenderPreviewScenarioMock = mock(async () => false);
const maybeRenderPreviewProgressStepMock = mock(async () => false);
const isPromptCancellationErrorMock = mock(
  realPromptCancellation.isPromptCancellationError,
);
const maybeRecoverMissingWalletSetupMock = mock(async () => false);
const resolveAddressOrEnsMock = mock(realValidation.resolveAddressOrEns);
const confirmPromptMock = mock(async () => true);
const inputPromptMock = mock(async () =>
  "0x4444444444444444444444444444444444444444"
);
const selectPromptMock = mock(async () => 1);

let handleWithdrawCommand: typeof import("../../src/commands/withdraw.ts").handleWithdrawCommand;
let handleWithdrawQuoteCommand: typeof import("../../src/commands/withdraw.ts").handleWithdrawQuoteCommand;
let world: TestWorld;

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function fakeQuoteCommand(
  globalOpts: Record<string, unknown> = {},
  withdrawOpts: Record<string, unknown> = {},
): Command {
  return {
    parent: {
      opts: () => withdrawOpts,
      parent: {
        opts: () => globalOpts,
      },
    },
  } as unknown as Command;
}

function useIsolatedHome(options: {
  defaultChain?: string;
  withSigner?: boolean;
} = {}): string {
  return world.seedConfigHome({
    defaultChain: options.defaultChain ?? "mainnet",
    withSigner: options.withSigner ?? false,
  });
}

async function loadWithdrawCommandHandlers(): Promise<void> {
  mock.module("@inquirer/prompts", () => ({
    ...realInquirerPrompts,
    confirm: confirmPromptMock,
    input: inputPromptMock,
    select: selectPromptMock,
  }));
  mock.module("../../src/services/account.ts", () => ({
    ...realAccount,
    initializeAccountService: initializeAccountServiceMock,
    saveAccount: saveAccountMock,
    saveSyncMeta: saveSyncMetaMock,
    withSuppressedSdkStdoutSync: withSuppressedSdkStdoutSyncMock,
  }));
  mock.module("../../src/services/sdk.ts", () => ({
    ...realSdk,
    getDataService: getDataServiceMock,
    getPublicClient: getPublicClientMock,
  }));
  mock.module("../../src/services/pools.ts", () => ({
    ...realPools,
    resolvePool: resolvePoolMock,
    listPools: listPoolsMock,
  }));
  mock.module("../../src/services/asp.ts", () => ({
    buildLoadedAspDepositReviewState: buildLoadedAspDepositReviewStateMock,
    fetchMerkleRoots: fetchMerkleRootsMock,
    fetchMerkleLeaves: fetchMerkleLeavesMock,
    fetchDepositsLargerThan: fetchDepositsLargerThanMock,
    fetchDepositReviewStatuses: fetchDepositReviewStatusesMock,
  }));
  mock.module("../../src/services/relayer.ts", () => ({
    getRelayerDetails: getRelayerDetailsMock,
    requestQuote: requestQuoteMock,
    submitRelayRequest: submitRelayRequestMock,
  }));
  mock.module("../../src/services/proofs.ts", () => ({
    ...realProofs,
    proveWithdrawal: proveWithdrawalMock,
  }));
  mock.module("../../src/services/contracts.ts", () => ({
    ...realContracts,
    withdrawDirect: withdrawDirectMock,
  }));
  mock.module("../../src/utils/pool-accounts.ts", () => ({
    ...realPoolAccounts,
    buildAllPoolAccountRefs: buildAllPoolAccountRefsMock,
    buildPoolAccountRefs: buildPoolAccountRefsMock,
    collectActiveLabels: collectActiveLabelsMock,
    describeUnavailablePoolAccount: describeUnavailablePoolAccountMock,
    getUnknownPoolAccountError: getUnknownPoolAccountErrorMock,
    parsePoolAccountSelector: parsePoolAccountSelectorMock,
  }));
  mock.module("../../src/utils/preflight.ts", () => ({
    checkHasGas: checkHasGasMock,
  }));
  mock.module("../../src/utils/lock.ts", () => ({
    acquireProcessLock: acquireProcessLockMock,
  }));
  mock.module("../../src/utils/critical-section.ts", () => ({
    guardCriticalSection: guardCriticalSectionMock,
    releaseCriticalSection: releaseCriticalSectionMock,
  }));
  mock.module("../../src/utils/unsigned.ts", () => ({
    printRawTransactions: printRawTransactionsMock,
    stringifyBigInts: stringifyBigIntsMock,
    toWithdrawSolidityProof: toWithdrawSolidityProofMock,
  }));
  mock.module("../../src/preview/runtime.ts", () => ({
    ...realPreviewRuntime,
    maybeRenderPreviewScenario: maybeRenderPreviewScenarioMock,
    maybeRenderPreviewProgressStep: maybeRenderPreviewProgressStepMock,
  }));
  mock.module("../../src/utils/prompt-cancellation.ts", () => ({
    ...realPromptCancellation,
    isPromptCancellationError: isPromptCancellationErrorMock,
  }));
  mock.module("../../src/utils/setup-recovery.ts", () => ({
    ...realSetupRecovery,
    maybeRecoverMissingWalletSetup: maybeRecoverMissingWalletSetupMock,
  }));
  mock.module("../../src/utils/validation.ts", () => ({
    ...realValidation,
    resolveAddressOrEns: resolveAddressOrEnsMock,
  }));
  mock.module("@0xbow/privacy-pools-core-sdk", () => ({
    ...realSdkPackage,
    generateMerkleProof: generateMerkleProofMock,
    calculateContext: calculateContextMock,
  }));

  ({ handleWithdrawCommand, handleWithdrawQuoteCommand } = await import(
    "../../src/commands/withdraw.ts"
  ));
}

export function registerWithdrawCommandHandlerHarness(): void {
  afterEach(() => {
    restoreTestTty();
    restoreModuleImplementations(WITHDRAW_HANDLER_MODULE_RESTORES);
  });

  beforeEach(() => {
    setTestTty();
    world = createTestWorld({ prefix: "pp-withdraw-handler-" });
    mock.restore();
    initializeAccountServiceMock.mockClear();
    getDataServiceMock.mockClear();
    getPublicClientMock.mockClear();
    resolvePoolMock.mockClear();
    listPoolsMock.mockClear();
    fetchMerkleRootsMock.mockClear();
    fetchMerkleLeavesMock.mockClear();
    fetchDepositsLargerThanMock.mockClear();
    fetchDepositReviewStatusesMock.mockClear();
    buildLoadedAspDepositReviewStateMock.mockClear();
    getRelayerDetailsMock.mockClear();
    requestQuoteMock.mockClear();
    proveWithdrawalMock.mockClear();
    withdrawDirectMock.mockClear();
    submitRelayRequestMock.mockClear();
    saveAccountMock.mockClear();
    saveSyncMetaMock.mockClear();
    buildPoolAccountRefsMock.mockClear();
    buildAllPoolAccountRefsMock.mockClear();
    collectActiveLabelsMock.mockClear();
    describeUnavailablePoolAccountMock.mockClear();
    getUnknownPoolAccountErrorMock.mockClear();
    parsePoolAccountSelectorMock.mockClear();
    checkHasGasMock.mockClear();
    acquireProcessLockMock.mockClear();
    guardCriticalSectionMock.mockClear();
    releaseCriticalSectionMock.mockClear();
    generateMerkleProofMock.mockClear();
    calculateContextMock.mockClear();
    toWithdrawSolidityProofMock.mockClear();
    stringifyBigIntsMock.mockClear();
    printRawTransactionsMock.mockClear();
    maybeRenderPreviewScenarioMock.mockClear();
    maybeRenderPreviewProgressStepMock.mockClear();
    isPromptCancellationErrorMock.mockClear();
    maybeRecoverMissingWalletSetupMock.mockClear();
    resolveAddressOrEnsMock.mockClear();
    confirmPromptMock.mockClear();
    inputPromptMock.mockClear();
    selectPromptMock.mockClear();
    confirmPromptMock.mockImplementation(async () => true);
    inputPromptMock.mockImplementation(async () =>
      "0x4444444444444444444444444444444444444444"
    );
    selectPromptMock.mockImplementation(async () => 1);
    saveAccountMock.mockImplementation(() => undefined);
    saveSyncMetaMock.mockImplementation(() => undefined);
    getDataServiceMock.mockImplementation(async () => ({}));
    initializeAccountServiceMock.mockImplementation(async () => ({
      account: { poolAccounts: new Map() },
      getSpendableCommitments: () =>
        new Map([
          [
            1n,
            [
              APPROVED_POOL_ACCOUNT.commitment,
              PENDING_POOL_ACCOUNT.commitment,
            ],
          ],
        ]),
      createWithdrawalSecrets: () => ({
        nullifier: 901n,
        secret: 902n,
      }),
      addWithdrawalCommitment: mock(() => undefined),
    }));
    resolvePoolMock.mockImplementation(async () => ETH_POOL);
    listPoolsMock.mockImplementation(async () => [ETH_POOL]);
    getPublicClientMock.mockImplementation(() => ({
      readContract: async () => 1n,
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 456n,
      }),
    }));
    fetchMerkleRootsMock.mockImplementation(async () => ({
      mtRoot: "1",
      onchainMtRoot: "1",
    }));
    fetchMerkleLeavesMock.mockImplementation(async () => ({
      aspLeaves: ["601"],
      stateTreeLeaves: ["501"],
    }));
    fetchDepositsLargerThanMock.mockImplementation(async () => ({
      eligibleDeposits: 8,
      totalDeposits: 12,
      percentage: 66.7,
    }));
    fetchDepositReviewStatusesMock.mockImplementation(async () =>
      new Map<string, string>([
        ["601", "approved"],
        ["602", "pending"],
      ]),
    );
    buildLoadedAspDepositReviewStateMock.mockImplementation(() => ({
      approvedLabels: new Set<string>(["601"]),
      reviewStatuses: new Map<string, string>([
        ["601", "approved"],
        ["602", "pending"],
      ]),
    }));
    getRelayerDetailsMock.mockImplementation(async () => ({
      minWithdrawAmount: "10000000000000000",
      feeReceiverAddress: DEFAULT_RELAYER_FEE_RECEIVER,
      relayerUrl: "https://fastrelay.xyz",
    }));
    requestQuoteMock.mockImplementation(
      async (
        _chainConfig: unknown,
        params?: {
          recipient?: Address;
          asset?: Address;
          amount?: bigint;
          extraGas?: boolean;
          relayerUrl?: string;
        },
      ) =>
        buildRelayerQuote({
          recipient: params?.recipient,
          asset: params?.asset,
          amount: params?.amount?.toString(),
          extraGas: params?.extraGas,
          relayerUrl: params?.relayerUrl,
        }),
    );
    proveWithdrawalMock.mockImplementation(async () => ({
      proof: {
        pi_a: ["0", "0", "1"],
        pi_b: [
          ["0", "0"],
          ["0", "0"],
          ["1", "0"],
        ],
        pi_c: ["0", "0", "1"],
      },
      publicSignals: [1n, 2n, 3n],
    }));
    withdrawDirectMock.mockImplementation(async () => ({
      hash: "0x" + "56".repeat(32),
    }));
    submitRelayRequestMock.mockImplementation(async () => ({
      txHash: "0x" + "34".repeat(32),
    }));
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      PENDING_POOL_ACCOUNT,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      PENDING_POOL_ACCOUNT,
    ]);
    collectActiveLabelsMock.mockImplementation(() => ["601", "602"]);
    describeUnavailablePoolAccountMock.mockImplementation(() => null);
    getUnknownPoolAccountErrorMock.mockImplementation(() => ({
      message: "Unknown Pool Account.",
      hint: "Choose a valid Pool Account.",
    }));
    parsePoolAccountSelectorMock.mockImplementation((raw: string) => {
      const match = raw.match(/\d+/);
      return match ? Number(match[0]) : null;
    });
    checkHasGasMock.mockImplementation(async () => undefined);
    acquireProcessLockMock.mockImplementation(() => () => undefined);
    guardCriticalSectionMock.mockImplementation(() => undefined);
    releaseCriticalSectionMock.mockImplementation(() => undefined);
    generateMerkleProofMock.mockImplementation((values: bigint[], target: bigint) => ({
      root: values.includes(target) ? 1n : 0n,
      siblings: [],
      pathIndices: [],
    }));
    calculateContextMock.mockImplementation(() => 777n);
    toWithdrawSolidityProofMock.mockImplementation(() => ({
      pA: [0n, 0n],
      pB: [
        [0n, 0n],
        [0n, 0n],
      ],
      pC: [0n, 0n],
      pubSignals: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    }));
    stringifyBigIntsMock.mockImplementation((value: unknown) => value);
    printRawTransactionsMock.mockImplementation(() => undefined);
    maybeRenderPreviewScenarioMock.mockImplementation(async () => false);
    maybeRenderPreviewProgressStepMock.mockImplementation(async () => false);
    isPromptCancellationErrorMock.mockImplementation(
      realPromptCancellation.isPromptCancellationError,
    );
    maybeRecoverMissingWalletSetupMock.mockImplementation(async () => false);
    resolveAddressOrEnsMock.mockImplementation(realValidation.resolveAddressOrEns);
  });

  afterEach(async () => {
    await world?.teardown();
  });

  beforeEach(async () => {
    await loadWithdrawCommandHandlers();
  });
}

export {
  APPROVED_POOL_ACCOUNT,
  CHAINS,
  CLIError,
  DEFAULT_RELAYER_FEE_RECEIVER,
  DEFAULT_RELAYER_RECIPIENT,
  ETH_POOL,
  OP_SEPOLIA_WETH_POOL,
  PENDING_POOL_ACCOUNT,
  USDC_POOL,
  acquireProcessLockMock,
  buildAllPoolAccountRefsMock,
  buildLoadedAspDepositReviewStateMock,
  buildPoolAccountRefsMock,
  buildRelayerQuote,
  calculateContextMock,
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
  checkHasGasMock,
  collectActiveLabelsMock,
  confirmPromptMock,
  describeUnavailablePoolAccountMock,
  encodeRelayerWithdrawalData,
  expectPrintedRawTransactions,
  expectUnsignedTransactions,
  fakeCommand,
  fakeQuoteCommand,
  fetchDepositReviewStatusesMock,
  fetchDepositsLargerThanMock,
  fetchMerkleLeavesMock,
  fetchMerkleRootsMock,
  generateMerkleProofMock,
  getDataServiceMock,
  getPublicClientMock,
  getRelayerDetailsMock,
  getUnknownPoolAccountErrorMock,
  guardCriticalSectionMock,
  handleWithdrawCommand,
  handleWithdrawQuoteCommand,
  initializeAccountServiceMock,
  inputPromptMock,
  isPromptCancellationErrorMock,
  listPoolsMock,
  maybeRecoverMissingWalletSetupMock,
  maybeRenderPreviewProgressStepMock,
  maybeRenderPreviewScenarioMock,
  parsePoolAccountSelectorMock,
  printRawTransactionsMock,
  proveWithdrawalMock,
  releaseCriticalSectionMock,
  resolveAddressOrEnsMock,
  requestQuoteMock,
  resolvePoolMock,
  saveAccountMock,
  saveSyncMetaMock,
  selectPromptMock,
  stringifyBigIntsMock,
  submitRelayRequestMock,
  toWithdrawSolidityProofMock,
  useIsolatedHome,
  withdrawDirectMock,
  withSuppressedSdkStdoutSyncMock,
  world,
};
