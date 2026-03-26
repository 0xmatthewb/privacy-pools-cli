import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Command } from "commander";
import { saveConfig } from "../../src/services/config.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
} from "../helpers/output.ts";
import { CLIError } from "../../src/utils/errors.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const realPoolAccounts = await import("../../src/utils/pool-accounts.ts");
const realPools = await import("../../src/services/pools.ts");
const realSdk = await import("../../src/services/sdk.ts");
const realWallet = await import("../../src/services/wallet.ts");

const POOL = {
  symbol: "ETH",
  asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  pool: "0x1111111111111111111111111111111111111111",
  scope: 1n,
  decimals: 18,
  deploymentBlock: 1n,
  minimumDepositAmount: 10000000000000000n,
  vettingFeeBPS: 100n,
  maxRelayFeeBPS: 300n,
  totalInPoolValue: 2000000000000000000n,
  acceptedDepositsValue: 1800000000000000000n,
  totalDepositsCount: 4,
};

const USDC_POOL = {
  ...POOL,
  symbol: "USDC",
  asset: "0x2222222222222222222222222222222222222222",
  pool: "0x3333333333333333333333333333333333333333",
  scope: 2n,
  decimals: 6,
  totalInPoolValue: 50000000n,
  acceptedDepositsValue: 40000000n,
  totalDepositsCount: 10,
};

const loadMnemonicMock = mock(() => "test test test test test test test test test test test junk");
const getDataServiceMock = mock(async () => ({}));
const initializeAccountServiceMock = mock(async () => ({
  account: { poolAccounts: new Map() },
  getSpendableCommitments: () => new Map([[1n, []]]),
}));
const withSuppressedSdkStdoutSyncMock = mock(<T>(fn: () => T): T => fn());
const listPoolsMock = mock(async () => [POOL, USDC_POOL]);
const resolvePoolMock = mock(async (_chainConfig: unknown, asset: string) =>
  asset.toUpperCase() === "USDC" ? USDC_POOL : POOL,
);
const loadAspDepositReviewStateMock = mock(async () => ({
  approvedLabels: new Set<string>(["601"]),
  reviewStatuses: new Map<string, string>([["601", "approved"]]),
  hasIncompleteReviewData: false,
}));
const fetchPoolEventsMock = mock(async () => ({
  events: [
    {
      type: "deposit",
      txHash: "0x" + "ab".repeat(32),
      timestamp: 1_700_000_000,
      amount: "1000000000000000000",
      reviewStatus: "approved",
      pool: {
        chainId: 1,
        poolAddress: POOL.pool,
        tokenSymbol: "ETH",
        tokenAddress: POOL.asset,
      },
    },
  ],
}));
const buildPoolAccountRefsMock = mock(() => []);
const collectActiveLabelsMock = mock(() => []);

let handlePoolsCommand: typeof import("../../src/commands/pools.ts").handlePoolsCommand;
let formatPoolDetailMyFundsWarning: typeof import("../../src/commands/pools.ts").formatPoolDetailMyFundsWarning;

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function useIsolatedHome(defaultChain = "mainnet"): void {
  const home = createTrackedTempDir("pp-pools-handler-");
  process.env.PRIVACY_POOLS_HOME = home;
  saveConfig({
    defaultChain,
    rpcOverrides: {},
  });
}

async function loadPoolsHandlers(): Promise<void> {
  mock.module("../../src/services/wallet.ts", () => ({
    ...realWallet,
    loadMnemonic: loadMnemonicMock,
  }));
  mock.module("../../src/services/sdk.ts", () => ({
    ...realSdk,
    getDataService: getDataServiceMock,
  }));
  mock.module("../../src/services/account.ts", () => ({
    initializeAccountService: initializeAccountServiceMock,
    withSuppressedSdkStdoutSync: withSuppressedSdkStdoutSyncMock,
  }));
  mock.module("../../src/services/pools.ts", () => ({
    ...realPools,
    listPools: listPoolsMock,
    resolvePool: resolvePoolMock,
  }));
  mock.module("../../src/services/asp.ts", () => ({
    fetchPoolEvents: fetchPoolEventsMock,
    loadAspDepositReviewState: loadAspDepositReviewStateMock,
    formatIncompleteAspReviewDataMessage: () => "ASP review data is incomplete.",
  }));
  mock.module("../../src/utils/pool-accounts.ts", () => ({
    ...realPoolAccounts,
    buildPoolAccountRefs: buildPoolAccountRefsMock,
    collectActiveLabels: collectActiveLabelsMock,
  }));

  ({
    handlePoolsCommand,
    formatPoolDetailMyFundsWarning,
  } = await import("../../src/commands/pools.ts"));
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
  listPoolsMock.mockImplementation(async () => [POOL, USDC_POOL]);
  resolvePoolMock.mockImplementation(async (_chainConfig: unknown, asset: string) =>
    asset.toUpperCase() === "USDC" ? USDC_POOL : POOL,
  );
  initializeAccountServiceMock.mockImplementation(async () => ({
    account: { poolAccounts: new Map() },
    getSpendableCommitments: () => new Map([[1n, []]]),
  }));
  loadAspDepositReviewStateMock.mockImplementation(async () => ({
    approvedLabels: new Set<string>(["601"]),
    reviewStatuses: new Map<string, string>([["601", "approved"]]),
    hasIncompleteReviewData: false,
  }));
  fetchPoolEventsMock.mockImplementation(async () => ({
    events: [
      {
        type: "deposit",
        txHash: "0x" + "ab".repeat(32),
        timestamp: 1_700_000_000,
        amount: "1000000000000000000",
        reviewStatus: "approved",
        pool: {
          chainId: 1,
          poolAddress: POOL.pool,
          tokenSymbol: "ETH",
          tokenAddress: POOL.asset,
        },
      },
    ],
  }));
  buildPoolAccountRefsMock.mockImplementation(() => []);
  collectActiveLabelsMock.mockImplementation(() => []);
});

beforeEach(async () => {
  await loadPoolsHandlers();
});

describe("pools command handler", () => {
  test("formatPoolDetailMyFundsWarning explains RPC, ASP, and setup failures", () => {
    expect(
      formatPoolDetailMyFundsWarning(
        Object.assign(new Error("rpc unavailable"), { code: "ECONNREFUSED" }),
        "mainnet",
      ),
    ).toContain("RPC connection");
    expect(
      formatPoolDetailMyFundsWarning(
        new CLIError("asp unavailable", "ASP"),
        "mainnet",
      ),
    ).toContain("ASP-backed wallet review data");
    expect(
      formatPoolDetailMyFundsWarning(
        new CLIError("Stored recovery phrase is invalid or corrupted", "INPUT"),
        "mainnet",
      ),
    ).toContain("stored recovery phrase");
  });

  test("rejects --rpc-url when the listing query spans multiple chains", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handlePoolsCommand(undefined, {}, fakeCommand({ json: true, rpcUrl: "https://rpc.example" })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "--rpc-url cannot be combined with multi-chain queries",
    );
    expect(exitCode).toBe(2);
  });

  test("renders an empty JSON payload when pool discovery succeeds with no visible pools", async () => {
    useIsolatedHome("mainnet");
    listPoolsMock.mockImplementation(async () => []);

    const { json } = await captureAsyncJsonOutput(() =>
      handlePoolsCommand(undefined, {}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(true);
    expect(json.pools).toEqual([]);
  });

  test("fails closed with the first error when every queried chain fails", async () => {
    useIsolatedHome();
    listPoolsMock.mockImplementation(async () => {
      throw new Error("asp unavailable");
    });

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handlePoolsCommand(undefined, {}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain("asp unavailable");
    expect(exitCode).toBeGreaterThan(0);
  });

  test("returns multi-chain warnings and chain summaries when one chain fails", async () => {
    useIsolatedHome();
    listPoolsMock.mockImplementation(async (chainConfig: { id: number }) => {
      if (chainConfig.id === 10) {
        throw new Error("optimism unavailable");
      }
      return [POOL];
    });

    const { json } = await captureAsyncJsonOutput(() =>
      handlePoolsCommand(undefined, { search: "eth", sort: "asset-asc" }, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.allChains).toBe(true);
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chain: "optimism",
        }),
      ]),
    );
    expect(json.pools.length).toBeGreaterThan(0);
  });

  test("detail view degrades gracefully when wallet-state loading fails", async () => {
    useIsolatedHome("mainnet");
    initializeAccountServiceMock.mockImplementationOnce(async () => {
      throw new Error("rpc unavailable");
    });

    const { json } = await captureAsyncJsonOutput(() =>
      handlePoolsCommand("ETH", {}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(true);
    expect(json.asset).toBe("ETH");
    expect(json.myFunds).toBeNull();
    expect(json.myFundsWarning).toContain("wallet state");
    expect(json.recentActivity).toHaveLength(1);
  });

  test("detail view preserves pool stats when wallet init is intentionally unavailable", async () => {
    useIsolatedHome("mainnet");
    loadMnemonicMock.mockImplementationOnce(() => {
      throw new CLIError("No recovery phrase found. Run 'privacy-pools init'.", "INPUT");
    });

    const { json } = await captureAsyncJsonOutput(() =>
      handlePoolsCommand("ETH", {}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(true);
    expect(json.asset).toBe("ETH");
    expect(json.myFunds).toBeNull();
    expect(json.myFundsWarning).toBeUndefined();
  });

  test("detail view surfaces incomplete ASP review data as a non-fatal warning", async () => {
    useIsolatedHome("mainnet");
    loadAspDepositReviewStateMock.mockImplementationOnce(async () => ({
      approvedLabels: new Set<string>(),
      reviewStatuses: new Map<string, string>(),
      hasIncompleteReviewData: true,
    }));

    const { json } = await captureAsyncJsonOutput(() =>
      handlePoolsCommand("ETH", {}, fakeCommand({ json: true, chain: "mainnet" })),
    );

    expect(json.success).toBe(true);
    expect(json.myFundsWarning).toContain("ASP review data is incomplete");
  });
});
