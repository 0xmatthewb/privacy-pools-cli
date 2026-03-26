import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Command } from "commander";
import { CHAINS } from "../../src/config/chains.ts";
import {
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../../src/services/config.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";
import {
  expectPrintedRawTransactions,
  expectUnsignedTransactions,
} from "../helpers/unsigned-assertions.ts";

const realAccount = await import("../../src/services/account.ts");
const realContracts = await import("../../src/services/contracts.ts");
const realInquirerPrompts = await import("@inquirer/prompts");
const realPoolAccounts = await import("../../src/utils/pool-accounts.ts");
const realPools = await import("../../src/services/pools.ts");
const realProofs = await import("../../src/services/proofs.ts");
const realSdk = await import("../../src/services/sdk.ts");
const realSdkPackage = await import("@0xbow/privacy-pools-core-sdk");

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
  feeReceiverAddress: "0x3333333333333333333333333333333333333333",
}));
const requestQuoteMock = mock(async () => ({
  baseFeeBPS: "200",
  feeBPS: "250",
  gasPrice: "1",
  detail: { relayTxCost: { gas: "0", eth: "0" } },
  feeCommitment: {
    expiration: 4_102_444_800_000,
    withdrawalData: "0x1234",
    asset: ETH_POOL.asset,
    amount: "100000000000000000",
    extraGas: false,
    signedRelayerCommitment: "0x01",
  },
}));
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
const confirmPromptMock = mock(async () => true);
const inputPromptMock = mock(async () =>
  "0x4444444444444444444444444444444444444444"
);
const selectPromptMock = mock(async () => 1);

let handleWithdrawCommand: typeof import("../../src/commands/withdraw.ts").handleWithdrawCommand;
let handleWithdrawQuoteCommand: typeof import("../../src/commands/withdraw.ts").handleWithdrawQuoteCommand;

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

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
  const home = createTrackedTempDir("pp-withdraw-handler-");
  process.env.PRIVACY_POOLS_HOME = home;
  saveConfig({
    defaultChain: options.defaultChain ?? "mainnet",
    rpcOverrides: {},
  });
  saveMnemonicToFile(
    "test test test test test test test test test test test junk",
  );
  if (options.withSigner) {
    saveSignerKey("0x" + "11".repeat(32));
  }
  return home;
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
  mock.module("@0xbow/privacy-pools-core-sdk", () => ({
    ...realSdkPackage,
    generateMerkleProof: generateMerkleProofMock,
    calculateContext: calculateContextMock,
  }));

  ({ handleWithdrawCommand, handleWithdrawQuoteCommand } = await import(
    "../../src/commands/withdraw.ts"
  ));
}

afterEach(() => {
  mock.restore();
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  cleanupTrackedTempDirs();
});

beforeEach(() => {
  mock.restore();
  initializeAccountServiceMock.mockClear();
  resolvePoolMock.mockClear();
  listPoolsMock.mockClear();
  requestQuoteMock.mockClear();
  withdrawDirectMock.mockClear();
  submitRelayRequestMock.mockClear();
  saveAccountMock.mockClear();
  saveSyncMetaMock.mockClear();
  printRawTransactionsMock.mockClear();
  confirmPromptMock.mockClear();
  inputPromptMock.mockClear();
  selectPromptMock.mockClear();
  confirmPromptMock.mockImplementation(async () => true);
  inputPromptMock.mockImplementation(async () =>
    "0x4444444444444444444444444444444444444444"
  );
  selectPromptMock.mockImplementation(async () => 1);
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
  requestQuoteMock.mockImplementation(async () => ({
    baseFeeBPS: "200",
    feeBPS: "250",
    gasPrice: "1",
    detail: { relayTxCost: { gas: "0", eth: "0" } },
    feeCommitment: {
      expiration: 4_102_444_800_000,
      withdrawalData: "0x1234",
      asset: ETH_POOL.asset,
      amount: "100000000000000000",
      extraGas: false,
      signedRelayerCommitment: "0x01",
    },
  }));
});

beforeEach(async () => {
  await loadWithdrawCommandHandlers();
});

describe("withdraw command handler", () => {
  test("rejects malformed --from-pa selectors before touching account state", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          fromPa: "banana",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Invalid --from-pa");
    expect(exitCode).toBe(2);
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
  });

  test("fails closed in machine mode when no withdrawal amount is supplied", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        undefined,
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Missing amount");
    expect(exitCode).toBe(2);
  });

  test("fails cleanly for humans when no pools are available to choose from", async () => {
    useIsolatedHome({ withSigner: true });
    listPoolsMock.mockImplementationOnce(async () => []);

    const { stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBe(2);
    expect(stderr).toContain("No pools found on mainnet");
  });

  test("renders a relayed JSON dry-run with quote and anonymity metadata", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          dryRun: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(exitCode).toBeNull();
    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("relayed");
    expect(json.dryRun).toBe(true);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.feeBPS).toBe("250");
    expect(json.anonymitySet).toEqual(
      expect.objectContaining({
        eligible: 8,
        total: 12,
      }),
    );
  });

  test("builds an unsigned direct withdrawal without touching signer state", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          unsigned: true,
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("unsigned");
    expect(json.withdrawMode).toBe("direct");
    expect(json.poolAccountId).toBe("PA-1");
    expectUnsignedTransactions(json.transactions, [
      {
        chainId: 1,
        from: null,
        to: ETH_POOL.pool,
        value: "0",
        description: "Direct withdraw from Privacy Pool",
      },
    ]);
  });

  test("builds an unsigned relayed withdrawal with the relayer request envelope", async () => {
    useIsolatedHome({ withSigner: true });

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          unsigned: true,
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("unsigned");
    expect(json.withdrawMode).toBe("relayed");
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.feeBPS).toBe("250");
    expect(json.relayerRequest).toEqual(
      expect.objectContaining({
        feeCommitment: expect.objectContaining({
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
        }),
      }),
    );
    expectUnsignedTransactions(json.transactions, [
      {
        chainId: 1,
        from: null,
        to: CHAINS.mainnet.entrypoint,
        value: "0",
        description: "Relay withdrawal through Entrypoint",
      },
    ]);
  });

  test("prints raw unsigned relayed withdrawal transactions when --unsigned tx is requested", async () => {
    useIsolatedHome({ withSigner: true });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          unsigned: "tx",
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(submitRelayRequestMock).not.toHaveBeenCalled();
    expectPrintedRawTransactions(printRawTransactionsMock, [
      {
        chainId: 1,
        to: CHAINS.mainnet.entrypoint,
        value: "0",
        description: "Relay withdrawal through Entrypoint",
      },
    ]);
  });

  test("prints raw unsigned transactions when --unsigned tx is requested", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          unsigned: "tx",
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expectPrintedRawTransactions(printRawTransactionsMock, [
      {
        chainId: 1,
        to: ETH_POOL.pool,
        value: "0",
        description: "Direct withdraw from Privacy Pool",
      },
    ]);
  });

  test("submits a relayed withdrawal and persists the updated commitment state", async () => {
    useIsolatedHome({ withSigner: true });
    const addWithdrawalCommitmentMock = mock(() => undefined);
    initializeAccountServiceMock.mockImplementationOnce(async () => ({
      account: { poolAccounts: new Map() },
      getSpendableCommitments: () =>
        new Map([[1n, [APPROVED_POOL_ACCOUNT.commitment]]]),
      createWithdrawalSecrets: () => ({
        nullifier: 901n,
        secret: 902n,
      }),
      addWithdrawalCommitment: addWithdrawalCommitmentMock,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x6666666666666666666666666666666666666666",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("relayed");
    expect(json.txHash).toBe("0x" + "34".repeat(32));
    expect(addWithdrawalCommitmentMock).toHaveBeenCalledTimes(1);
    expect(saveAccountMock).toHaveBeenCalledTimes(1);
    expect(saveSyncMetaMock).toHaveBeenCalledTimes(1);
  });

  test("submits a direct withdrawal to the signer address when requested", async () => {
    useIsolatedHome({ withSigner: true });
    const addWithdrawalCommitmentMock = mock(() => undefined);
    initializeAccountServiceMock.mockImplementationOnce(async () => ({
      account: { poolAccounts: new Map() },
      getSpendableCommitments: () =>
        new Map([[1n, [APPROVED_POOL_ACCOUNT.commitment]]]),
      createWithdrawalSecrets: () => ({
        nullifier: 901n,
        secret: 902n,
      }),
      addWithdrawalCommitment: addWithdrawalCommitmentMock,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("direct");
    expect(json.txHash).toBe("0x" + "56".repeat(32));
    expect(addWithdrawalCommitmentMock).toHaveBeenCalledTimes(1);
  });

  test("resolves --all withdrawals to the full selected Pool Account balance", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "ETH",
        undefined,
        {
          all: true,
          dryRun: true,
          fromPa: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.amount).toBe("1000000000000000000");
    expect(json.poolAccountId).toBe("PA-1");
  });

  test("resolves percentage withdrawals against the selected Pool Account balance", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "50%",
        "ETH",
        {
          dryRun: true,
          fromPa: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.amount).toBe("500000000000000000");
    expect(json.poolAccountId).toBe("PA-1");
  });

  test("fails closed when --all is combined with a positional amount", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "ETH",
        "0.1",
        {
          all: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Cannot specify an amount with --all");
    expect(exitCode).toBe(2);
  });

  test("requires an explicit recipient for direct unsigned withdrawals", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          unsigned: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Direct withdrawal requires --to");
    expect(exitCode).toBe(2);
  });

  test("rejects direct withdrawals whose recipient does not match the signer", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          to: "0x9999999999999999999999999999999999999999",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("must match your signer address");
    expect(exitCode).toBe(2);
  });

  test("rejects Pool Accounts that cannot cover the requested amount", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "2",
        "ETH",
        {
          fromPa: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No Pool Account has enough balance",
    );
    expect(exitCode).toBe(2);
  });

  test("surfaces ACCOUNT_NOT_APPROVED when the selected Pool Account is still pending", async () => {
    useIsolatedHome({ withSigner: true });
    buildPoolAccountRefsMock.mockImplementationOnce(() => [PENDING_POOL_ACCOUNT]);
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [PENDING_POOL_ACCOUNT]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: [],
      stateTreeLeaves: ["502"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementationOnce(() => ({
      approvedLabels: new Set<string>(),
      reviewStatuses: new Map<string, string>([["602", "pending"]]),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          fromPa: "PA-2",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ACCOUNT_NOT_APPROVED");
    expect(json.error.hint).toContain("accounts --chain mainnet");
    expect(exitCode).toBe(4);
  });

  test("surfaces unavailable historical Pool Accounts through --from-pa", async () => {
    useIsolatedHome({ withSigner: true });
    const spentPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 3,
      paId: "PA-3",
      status: "spent",
      aspStatus: "approved",
      value: 0n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 503n,
        label: 603n,
        value: 0n,
      },
      label: 603n,
    };
    buildAllPoolAccountRefsMock.mockImplementationOnce(() => [
      APPROVED_POOL_ACCOUNT,
      spentPoolAccount,
    ]);
    describeUnavailablePoolAccountMock.mockImplementationOnce(
      () => "PA-3 has already been spent and has no remaining balance.",
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          fromPa: "PA-3",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("already been spent");
    expect(json.error.hint).toContain("inspect PA-3");
    expect(exitCode).toBe(2);
  });

  test("surfaces unknown Pool Accounts through --from-pa", async () => {
    useIsolatedHome({ withSigner: true });
    getUnknownPoolAccountErrorMock.mockImplementationOnce(() => ({
      message: "PA-99 is not part of this pool.",
      hint: "Choose an existing Pool Account from privacy-pools accounts.",
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          fromPa: "PA-99",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("PA-99 is not part of this pool");
    expect(json.error.hint).toContain("privacy-pools accounts");
    expect(exitCode).toBe(2);
  });

  test("rejects explicitly selected Pool Accounts that cannot cover the requested amount", async () => {
    useIsolatedHome({ withSigner: true });
    const largerApprovedPoolAccount = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 4,
      paId: "PA-4",
      value: 3000000000000000000n,
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 504n,
        label: 604n,
        value: 3000000000000000000n,
      },
      label: 604n,
      txHash: "0x" + "cc".repeat(32),
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      largerApprovedPoolAccount,
    ]);
    fetchMerkleLeavesMock.mockImplementationOnce(async () => ({
      aspLeaves: ["601", "604"],
      stateTreeLeaves: ["501", "504"],
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "2",
        "ETH",
        {
          fromPa: "PA-1",
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "PA-1 has insufficient balance",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed when the relayer minimum exceeds the requested amount", async () => {
    useIsolatedHome({ withSigner: true });
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "9000000000000000000",
      feeReceiverAddress: "0x3333333333333333333333333333333333333333",
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RELAYER_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("below relayer minimum");
    expect(exitCode).toBe(5);
  });

  test("fails closed when ASP roots are still converging", async () => {
    useIsolatedHome({ withSigner: true });
    fetchMerkleRootsMock.mockImplementationOnce(async () => ({
      mtRoot: "1",
      onchainMtRoot: "2",
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ASP_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("still updating");
    expect(exitCode).toBe(4);
  });

  test("fails closed when ASP root parity drifts from the onchain latest root", async () => {
    useIsolatedHome({ withSigner: true });
    fetchMerkleRootsMock.mockImplementationOnce(async () => ({
      mtRoot: "1",
      onchainMtRoot: "1",
    }));
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "latestRoot" ? 2n : 1n,
      waitForTransactionReceipt: async () => ({
        status: "success",
        blockNumber: 456n,
      }),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ASP_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "out of sync with the chain",
    );
    expect(exitCode).toBe(4);
  });

  test("prompts for the recipient in human relayed mode when --to is omitted", async () => {
    useIsolatedHome({ withSigner: true });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(inputPromptMock).toHaveBeenCalledTimes(1);
    expect(confirmPromptMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Withdrawal Review");
    expect(stderr).toContain("0x4444");
  });

  test("lets humans choose among multiple approved Pool Accounts", async () => {
    useIsolatedHome({ withSigner: true });
    const alternateApproved = {
      ...APPROVED_POOL_ACCOUNT,
      paNumber: 3,
      paId: "PA-3",
      commitment: {
        ...APPROVED_POOL_ACCOUNT.commitment,
        hash: 503n,
        label: 603n,
        value: 2000000000000000000n,
      },
      label: 603n,
      value: 2000000000000000000n,
    };
    buildPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      alternateApproved,
    ]);
    buildAllPoolAccountRefsMock.mockImplementation(() => [
      APPROVED_POOL_ACCOUNT,
      alternateApproved,
    ]);
    fetchMerkleLeavesMock.mockImplementation(async () => ({
      aspLeaves: ["601", "603"],
      stateTreeLeaves: ["501", "503"],
    }));
    buildLoadedAspDepositReviewStateMock.mockImplementation(() => ({
      approvedLabels: new Set<string>(["601", "603"]),
      reviewStatuses: new Map<string, string>([
        ["601", "approved"],
        ["603", "approved"],
      ]),
    }));
    selectPromptMock.mockImplementationOnce(async () => 3);

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(selectPromptMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("PA-3");
  });

  test("allows humans to cancel a direct withdrawal after the privacy warning", async () => {
    useIsolatedHome({ withSigner: true });
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("NOT privacy-preserving");
    expect(stderr).toContain("Withdrawal cancelled.");
    expect(withdrawDirectMock).not.toHaveBeenCalled();
  });

  test("refreshes expired human quotes before proceeding with the withdrawal review", async () => {
    useIsolatedHome({ withSigner: true });
    requestQuoteMock
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        feeBPS: "250",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeCommitment: {
          expiration: 946684800,
          withdrawalData: "0x1234",
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
          extraGas: false,
          signedRelayerCommitment: "0x01",
        },
      }))
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        feeBPS: "250",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeCommitment: {
          expiration: 4_102_444_800_000,
          withdrawalData: "0x1234",
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
          extraGas: false,
          signedRelayerCommitment: "0x01",
        },
      }));

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    expect(stderr).toContain("Withdrawal Review");
  });

  test("returns a structured relayer quote in JSON mode", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {
          to: "0x7777777777777777777777777777777777777777",
        },
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("relayed-quote");
    expect(json.asset).toBe("ETH");
    expect(json.quoteFeeBPS).toBe("250");
    expect(json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "withdraw",
          when: "after_quote",
        }),
      ]),
    );
  });

  test("quote returns a template follow-up when no recipient is supplied", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.recipient).toBeNull();
    expect(json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "withdraw",
          runnable: false,
        }),
      ]),
    );
  });

  test("quote fails closed when no asset is supplied", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No asset specified",
    );
    expect(exitCode).toBe(2);
  });

  test("quote inherits parent withdraw flags and suppresses extra gas for native assets", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        undefined,
        {},
        fakeQuoteCommand(
          { chain: "mainnet" },
          {
            asset: "ETH",
            to: "0x7777777777777777777777777777777777777777",
            extraGas: true,
          },
        ),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Extra gas is not applicable for ETH withdrawals");
    expect(requestQuoteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        asset: ETH_POOL.asset,
        extraGas: false,
        recipient: "0x7777777777777777777777777777777777777777",
      }),
    );
  });

  test("quote keeps feeCommitmentPresent false when the relayer omits fee commitment details", async () => {
    useIsolatedHome();
    requestQuoteMock.mockImplementationOnce(async () => ({
      baseFeeBPS: "200",
      feeBPS: "250",
      gasPrice: "1",
      detail: { relayTxCost: { gas: "0", eth: "0" } },
      feeCommitment: null,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawQuoteCommand(
        "0.1",
        "ETH",
        {},
        fakeQuoteCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.feeCommitmentPresent).toBe(false);
    expect(json.quoteExpiresAt).toBeNull();
  });

  test("fails closed when relayed withdrawals omit the recipient in machine mode", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "require --to",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects the deprecated --unsigned-format flag with a targeted INPUT error", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
          unsignedFormat: "tx" as "tx",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "replaced by --unsigned [format]",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects unsupported unsigned output formats before loading account state", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
          unsigned: "raw" as "raw",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      'Unsupported unsigned format: "raw"',
    );
    expect(initializeAccountServiceMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

  test("requires an asset when --all is used", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        undefined,
        undefined,
        {
          all: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("--all requires an asset");
    expect(exitCode).toBe(2);
  });

  test("rejects invalid percentage withdrawals before loading pool state", async () => {
    useIsolatedHome({ withSigner: true });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "150%",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Invalid percentage");
    expect(resolvePoolMock).not.toHaveBeenCalled();
    expect(exitCode).toBe(2);
  });

  test("prompts humans to choose an asset when it is omitted", async () => {
    useIsolatedHome({ withSigner: true });
    selectPromptMock.mockImplementationOnce(async () => "ETH");

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        undefined,
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(listPoolsMock).toHaveBeenCalledTimes(1);
    expect(selectPromptMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Selected PA-1");
  });

  test("renders a direct JSON dry-run after proof generation", async () => {
    useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
          dryRun: true,
          to: "0x5555555555555555555555555555555555555555",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("direct");
    expect(json.dryRun).toBe(true);
    expect(json.proofPublicSignals).toBe(3);
  });

  test("continues with a human direct withdrawal after the privacy confirmation", async () => {
    useIsolatedHome({ withSigner: true });

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(confirmPromptMock).toHaveBeenCalledTimes(1);
    expect(withdrawDirectMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Direct withdrawal confirmed");
  });

  test("fails closed when waiting for a direct withdrawal receipt times out", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async () => 1n,
      waitForTransactionReceipt: async () => {
        throw new Error("timeout");
      },
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Timed out waiting for withdrawal confirmation",
    );
    expect(exitCode).toBe(3);
  });

  test("fails closed when the relayer omits fee commitment details", async () => {
    useIsolatedHome({ withSigner: true });
    requestQuoteMock.mockImplementationOnce(async () => ({
      baseFeeBPS: "200",
      feeBPS: "250",
      gasPrice: "1",
      detail: { relayTxCost: { gas: "0", eth: "0" } },
      feeCommitment: null,
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RELAYER_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "missing required fee details",
    );
    expect(exitCode).toBe(5);
  });

  test("refreshes an expired machine-mode relayer quote before building the proof", async () => {
    useIsolatedHome({ withSigner: true });
    requestQuoteMock
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        feeBPS: "250",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeCommitment: {
          expiration: 946684800,
          withdrawalData: "0x1234",
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
          extraGas: false,
          signedRelayerCommitment: "0x01",
        },
      }))
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        feeBPS: "250",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeCommitment: {
          expiration: 4_102_444_800_000,
          withdrawalData: "0x1234",
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
          extraGas: false,
          signedRelayerCommitment: "0x01",
        },
      }));

    const { json } = await captureAsyncJsonOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          dryRun: true,
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    expect(json.quoteExpiresAt).toContain("2100");
  });

  test("warns human relayed withdrawals when the remainder falls below the relayer minimum", async () => {
    useIsolatedHome({ withSigner: true });
    getRelayerDetailsMock.mockImplementationOnce(async () => ({
      minWithdrawAmount: "50000000000000000",
      feeReceiverAddress: "0x3333333333333333333333333333333333333333",
    }));

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.96",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ yes: true, chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("below the relayer minimum");
    expect(submitRelayRequestMock).toHaveBeenCalled();
  });

  test("prints relayed save warnings for human callers after onchain confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    saveAccountMock.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ yes: true, chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("relayed withdrawal confirmed onchain but failed to save locally");
    expect(stderr).toContain("privacy-pools sync");
  });

  test("fails closed when the relayed withdrawal transaction reverts onchain", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async () => 1n,
      waitForTransactionReceipt: async () => ({
        status: "reverted",
        blockNumber: 456n,
      }),
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("CONTRACT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Relay transaction reverted",
    );
    expect(exitCode).toBe(7);
  });

  test("fails closed when waiting for the relayed withdrawal confirmation times out", async () => {
    useIsolatedHome({ withSigner: true });
    getPublicClientMock.mockImplementationOnce(() => ({
      readContract: async () => 1n,
      waitForTransactionReceipt: async () => {
        throw new Error("timeout");
      },
    }));

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          to: "0x4444444444444444444444444444444444444444",
        },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RPC_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Timed out waiting for relayed withdrawal confirmation",
    );
    expect(exitCode).toBe(3);
  });

  test("prints direct save warnings for human callers after onchain confirmation", async () => {
    useIsolatedHome({ withSigner: true });
    saveAccountMock.mockImplementationOnce(() => {
      throw new Error("disk full");
    });

    const { stderr } = await captureAsyncOutput(() =>
      handleWithdrawCommand(
        "0.1",
        "ETH",
        {
          direct: true,
        },
        fakeCommand({ yes: true, chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("withdrawal confirmed onchain but failed to save locally");
    expect(stderr).toContain("privacy-pools sync");
  });

  test("auto-refreshes an expired relayer quote after proof generation when the fee is unchanged", async () => {
    useIsolatedHome({ withSigner: true });
    const originalNow = Date.now;
    let nowCalls = 0;
    const initialNow = 1_700_000_000_000;
    const expiredNow = 1_700_000_003_000;
    proveWithdrawalMock.mockImplementationOnce(async () => {
      return {
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
      };
    });
    requestQuoteMock
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        feeBPS: "250",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeCommitment: {
          expiration: initialNow + 1_000,
          withdrawalData: "0x1234",
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
          extraGas: false,
          signedRelayerCommitment: "0x01",
        },
      }))
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        feeBPS: "250",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeCommitment: {
          expiration: initialNow + 10_000,
          withdrawalData: "0x1234",
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
          extraGas: false,
          signedRelayerCommitment: "0x01",
        },
      }));
    Date.now = () => (++nowCalls <= 2 ? initialNow : expiredNow);

    try {
      const { json } = await captureAsyncJsonOutput(() =>
        handleWithdrawCommand(
          "0.1",
          "ETH",
          {
            to: "0x4444444444444444444444444444444444444444",
          },
          fakeCommand({ json: true, chain: "mainnet" }),
        ),
      );

      expect(json.success).toBe(true);
      expect(requestQuoteMock).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = originalNow;
    }
  });

  test("fails closed when the relayer fee changes after proof generation", async () => {
    useIsolatedHome({ withSigner: true });
    const originalNow = Date.now;
    let nowCalls = 0;
    const initialNow = 1_700_000_000_000;
    const expiredNow = 1_700_000_003_000;
    proveWithdrawalMock.mockImplementationOnce(async () => {
      return {
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
      };
    });
    requestQuoteMock
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        feeBPS: "250",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeCommitment: {
          expiration: initialNow + 1_000,
          withdrawalData: "0x1234",
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
          extraGas: false,
          signedRelayerCommitment: "0x01",
        },
      }))
      .mockImplementationOnce(async () => ({
        baseFeeBPS: "200",
        feeBPS: "275",
        gasPrice: "1",
        detail: { relayTxCost: { gas: "0", eth: "0" } },
        feeCommitment: {
          expiration: initialNow + 10_000,
          withdrawalData: "0x1234",
          asset: ETH_POOL.asset,
          amount: "100000000000000000",
          extraGas: false,
          signedRelayerCommitment: "0x02",
        },
      }));
    Date.now = () => (++nowCalls <= 2 ? initialNow : expiredNow);

    try {
      const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
        handleWithdrawCommand(
          "0.1",
          "ETH",
          {
            to: "0x4444444444444444444444444444444444444444",
          },
          fakeCommand({ json: true, chain: "mainnet" }),
        ),
      );

      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("RELAYER_ERROR");
      expect(json.error.message ?? json.errorMessage).toContain(
        "Relayer fee changed during proof generation",
      );
      expect(exitCode).toBe(5);
    } finally {
      Date.now = originalNow;
    }
  });
});
