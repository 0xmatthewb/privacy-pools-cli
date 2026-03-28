import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Command } from "commander";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
} from "../helpers/output.ts";

const realConfig = captureModuleExports(
  await import("../../src/services/config.ts"),
);
const realPools = captureModuleExports(
  await import("../../src/services/pools.ts"),
);
const realAsp = captureModuleExports(await import("../../src/services/asp.ts"));

const ACTIVITY_HANDLER_MODULE_RESTORES = [
  ["../../src/services/config.ts", realConfig],
  ["../../src/services/pools.ts", realPools],
  ["../../src/services/asp.ts", realAsp],
] as const;

const loadConfigMock = mock(() => ({
  defaultChain: "mainnet",
  rpcOverrides: {},
}));
const resolvePoolMock = mock(async () => ({
  symbol: "ETH",
  pool: "0x1111111111111111111111111111111111111111",
  asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  scope: 1n,
  decimals: 18,
  minimumDepositAmount: 10000000000000000n,
  vettingFeeBPS: 50n,
  maxRelayFeeBPS: 250n,
}));
const fetchPoolEventsMock = mock(async () => ({
  page: "2",
  perPage: "5",
  total: "9",
  totalPages: "2",
  events: [
    {
      type: "deposit",
      txHash: "0x" + "aa".repeat(32),
      reviewStatus: "approved",
      amount: "100000000000000000",
      timestamp: 1_700_000_000,
      pool: {
        tokenSymbol: "ETH",
        denomination: 18,
        poolAddress: "0x1111111111111111111111111111111111111111",
        chainId: 1,
      },
    },
  ],
}));
const fetchGlobalEventsMock = mock(async () => ({
  page: "1",
  perPage: "12",
  total: "20",
  totalPages: "2",
  events: [
    {
      type: "deposit",
      txHash: "0x" + "bb".repeat(32),
      reviewStatus: "approved",
      amount: "100000000000000000",
      timestamp: 1_700_000_100,
      pool: {
        tokenSymbol: "ETH",
        denomination: 18,
        poolAddress: "0x1111111111111111111111111111111111111111",
        chainId: 1,
      },
    },
    {
      type: "withdrawal",
      txHash: "0x" + "cc".repeat(32),
      reviewStatus: "approved",
      amount: "50000000000000000",
      timestamp: 1_700_000_200,
      pool: {
        tokenSymbol: "ETH",
        denomination: 18,
        poolAddress: "0x2222222222222222222222222222222222222222",
        chainId: 10,
      },
    },
    {
      type: "withdrawal",
      txHash: "0x" + "dd".repeat(32),
      reviewStatus: "approved",
      amount: "25000000000000000",
      timestamp: 1_700_000_300,
      pool: {
        tokenSymbol: "ETH",
        denomination: 18,
        poolAddress: "0x3333333333333333333333333333333333333333",
        chainId: null,
      },
    },
  ],
}));

let handleActivityCommand: typeof import("../../src/commands/activity.ts").handleActivityCommand;

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

async function loadActivityHandler(): Promise<void> {
  installModuleMocks([
    ["../../src/services/config.ts", () => ({
      ...realConfig,
      loadConfig: loadConfigMock,
    })],
    ["../../src/services/pools.ts", () => ({
      ...realPools,
      resolvePool: resolvePoolMock,
    })],
    ["../../src/services/asp.ts", () => ({
      ...realAsp,
      fetchPoolEvents: fetchPoolEventsMock,
      fetchGlobalEvents: fetchGlobalEventsMock,
    })],
  ]);

  ({ handleActivityCommand } = await import("../../src/commands/activity.ts"));
}

describe("activity command handler", () => {
  beforeEach(async () => {
    mock.restore();
    loadConfigMock.mockClear();
    resolvePoolMock.mockClear();
    fetchPoolEventsMock.mockClear();
    fetchGlobalEventsMock.mockClear();
    loadConfigMock.mockImplementation(() => ({
      defaultChain: "mainnet",
      rpcOverrides: {},
    }));
    resolvePoolMock.mockImplementation(async () => ({
      symbol: "ETH",
      pool: "0x1111111111111111111111111111111111111111",
      asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      scope: 1n,
      decimals: 18,
      minimumDepositAmount: 10000000000000000n,
      vettingFeeBPS: 50n,
      maxRelayFeeBPS: 250n,
    }));
    fetchPoolEventsMock.mockImplementation(async () => ({
      page: "2",
      perPage: "5",
      total: "9",
      totalPages: "2",
      events: [
        {
          type: "deposit",
          txHash: "0x" + "aa".repeat(32),
          reviewStatus: "approved",
          amount: "100000000000000000",
          timestamp: 1_700_000_000,
          pool: {
            tokenSymbol: "ETH",
            denomination: 18,
            poolAddress: "0x1111111111111111111111111111111111111111",
            chainId: 1,
          },
        },
      ],
    }));
    fetchGlobalEventsMock.mockImplementation(async () => ({
      page: "1",
      perPage: "12",
      total: "20",
      totalPages: "2",
      events: [
        {
          type: "deposit",
          txHash: "0x" + "bb".repeat(32),
          reviewStatus: "approved",
          amount: "100000000000000000",
          timestamp: 1_700_000_100,
          pool: {
            tokenSymbol: "ETH",
            denomination: 18,
            poolAddress: "0x1111111111111111111111111111111111111111",
            chainId: 1,
          },
        },
        {
          type: "withdrawal",
          txHash: "0x" + "cc".repeat(32),
          reviewStatus: "approved",
          amount: "50000000000000000",
          timestamp: 1_700_000_200,
          pool: {
            tokenSymbol: "ETH",
            denomination: 18,
            poolAddress: "0x2222222222222222222222222222222222222222",
            chainId: 10,
          },
        },
        {
          type: "withdrawal",
          txHash: "0x" + "dd".repeat(32),
          reviewStatus: "approved",
          amount: "25000000000000000",
          timestamp: 1_700_000_300,
          pool: {
            tokenSymbol: "ETH",
            denomination: 18,
            poolAddress: "0x3333333333333333333333333333333333333333",
            chainId: null,
          },
        },
      ],
    }));
    await loadActivityHandler();
  });

  afterEach(() => {
    restoreModuleImplementations(ACTIVITY_HANDLER_MODULE_RESTORES);
  });

  test("returns pool activity for an explicit asset on a single chain", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleActivityCommand(
        { asset: "ETH", page: "2", limit: "5" },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("pool-activity");
    expect(json.chain).toBe("mainnet");
    expect(json.asset).toBe("ETH");
    expect(json.pool).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("1");
    expect(json.page).toBe(2);
    expect(json.perPage).toBe(5);
    expect(json.total).toBe(9);
    expect(json.totalPages).toBe(2);
    expect(json.events).toHaveLength(1);
    expect(resolvePoolMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mainnet" }),
      "ETH",
      undefined,
    );
    expect(fetchPoolEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mainnet" }),
      1n,
      2,
      5,
    );
    expect(stderr).toBe("");
  });

  test("returns global activity across the default mainnet chains when no chain is selected", async () => {
    const resolvePoolCallsBefore = resolvePoolMock.mock.calls.length;

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleActivityCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("global-activity");
    expect(json.chain).toBe("all-mainnets");
    expect(json.chains).toEqual(["mainnet", "arbitrum", "optimism"]);
    expect(json.total).toBe(20);
    expect(json.totalPages).toBe(2);
    expect(json.events).toHaveLength(3);
    expect(resolvePoolMock.mock.calls.length).toBe(resolvePoolCallsBefore);
    expect(fetchGlobalEventsMock).toHaveBeenCalledTimes(1);
    expect(stderr).toBe("");
  });

  test("filters global activity to the selected chain and keeps null-chain events", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleActivityCommand({}, fakeCommand({ json: true, chain: "optimism" })),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("global-activity");
    expect(json.chain).toBe("optimism");
    expect(json.chainFiltered).toBe(true);
    expect(json.total).toBeNull();
    expect(json.totalPages).toBeNull();
    expect(json.events).toHaveLength(2);
    expect(
      json.events.every((event: { chainId: number | null }) =>
        event.chainId === 10 || event.chainId === null
      ),
    ).toBe(true);
    expect(stderr).toBe("");
  });

  test("prints a structured INPUT error when page or limit is invalid", async () => {
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleActivityCommand(
        { page: "0", limit: "-1" },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Invalid --page value",
    );
    expect(exitCode).toBe(2);
    expect(stderr).toBe("");
  });

  test("renders human output for single-chain global activity", async () => {
    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleActivityCommand({}, fakeCommand({ chain: "optimism" })),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Global activity");
    expect(stderr).toContain("optimism");
    expect(stderr).toContain("withdrawal");
  });
});
