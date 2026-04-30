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
const realPreviewRuntime = captureModuleExports(
  await import("../../src/preview/runtime.ts"),
);

const STATS_HANDLER_MODULE_RESTORES = [
  ["../../src/services/config.ts", realConfig],
  ["../../src/services/pools.ts", realPools],
  ["../../src/services/asp.ts", realAsp],
  ["../../src/preview/runtime.ts", realPreviewRuntime],
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
const fetchGlobalStatisticsMock = mock(async () => ({
  cacheTimestamp: "2026-04-19T12:00:00.000Z",
  allTime: {
    tvlUsd: "2500000",
    avgDepositSizeUsd: "1250",
    totalDepositsCount: "500",
    totalWithdrawalsCount: "320",
  },
  last24h: {
    tvlUsd: "100000",
    avgDepositSizeUsd: "750",
    totalDepositsCount: "10",
    totalWithdrawalsCount: "7",
  },
}));
const fetchPoolStatisticsMock = mock(async () => ({
  cacheTimestamp: "2026-04-19T12:00:00.000Z",
  pool: {
    allTime: {
      tvlUsd: "1250000",
      avgDepositSizeUsd: "850",
      totalDepositsCount: "250",
      totalWithdrawalsCount: "160",
    },
    last24h: {
      tvlUsd: "50000",
      avgDepositSizeUsd: "500",
      totalDepositsCount: "5",
      totalWithdrawalsCount: "3",
    },
  },
}));
const maybeRenderPreviewProgressStepMock = mock(async () => false);

let handlePoolsStatsCommand:
  typeof import("../../src/commands/pools.ts").handlePoolsStatsCommand;

function fakeCommand(
  globalOpts: Record<string, unknown> = {},
  options: { useOptsWithGlobals?: boolean } = {},
): Command {
  if (options.useOptsWithGlobals) {
    return {
      optsWithGlobals: () => globalOpts,
    } as unknown as Command;
  }

  return {
    parent: {
      parent: {
        opts: () => globalOpts,
      },
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

async function loadStatsHandler(): Promise<void> {
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
      fetchGlobalStatistics: fetchGlobalStatisticsMock,
      fetchPoolStatistics: fetchPoolStatisticsMock,
    })],
    ["../../src/preview/runtime.ts", () => ({
      ...realPreviewRuntime,
      maybeRenderPreviewProgressStep: maybeRenderPreviewProgressStepMock,
    })],
  ]);

  ({ handlePoolsStatsCommand } = await import(
    `../../src/commands/pools.ts?stats-handler=${Date.now()}`
  ));
}

describe("stats command handler", () => {
  beforeEach(async () => {
    mock.restore();
    loadConfigMock.mockClear();
    resolvePoolMock.mockClear();
    fetchGlobalStatisticsMock.mockClear();
    fetchPoolStatisticsMock.mockClear();
    maybeRenderPreviewProgressStepMock.mockClear();
    maybeRenderPreviewProgressStepMock.mockImplementation(async () => false);
    await loadStatsHandler();
  });

  afterEach(() => {
    restoreModuleImplementations(STATS_HANDLER_MODULE_RESTORES);
  });

  test("renders global stats without deprecation metadata", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handlePoolsStatsCommand(
        undefined,
        {},
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("pools");
    expect(json.action).toBe("stats");
    expect(json.operation).toBe("pools.stats");
    expect(json.command).toBeUndefined();
    expect(json.invokedAs).toBeUndefined();
    expect(fetchGlobalStatisticsMock).toHaveBeenCalledTimes(1);
    expect(stderr).toBe("");
  });

  test("fails closed when global pools stats is given an explicit chain", async () => {
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handlePoolsStatsCommand(
        undefined,
        {},
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_FLAG_CONFLICT");
    expect(json.error.message ?? json.errorMessage).toContain(
      "The --chain flag is not supported",
    );
    expect(fetchGlobalStatisticsMock).not.toHaveBeenCalled();
    expect(stderr).toBe("");
    expect(exitCode).toBe(2);
  });

  test("renders pool stats and supports optsWithGlobals", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handlePoolsStatsCommand(
        "ETH",
        {},
        fakeCommand({ json: true, chain: "mainnet" }, { useOptsWithGlobals: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("pools");
    expect(json.action).toBe("stats");
    expect(json.operation).toBe("pools.stats");
    expect(json.command).toBeUndefined();
    expect(json.invokedAs).toBeUndefined();
    expect(json.chain).toBe("mainnet");
    expect(json.asset).toBe("ETH");
    expect(resolvePoolMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mainnet" }),
      "ETH",
      undefined,
    );
    expect(fetchPoolStatisticsMock).toHaveBeenCalledTimes(1);
    expect(stderr).toBe("");
  });

  test("returns early when preview rendering takes over stats fetches", async () => {
    maybeRenderPreviewProgressStepMock.mockImplementationOnce(
      async (step: string) => step === "stats.global.fetch",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handlePoolsStatsCommand(
        undefined,
        {},
        fakeCommand({}),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(fetchGlobalStatisticsMock).not.toHaveBeenCalled();
  });

  test("returns early when preview rendering takes over pool stats fetches", async () => {
    maybeRenderPreviewProgressStepMock.mockImplementationOnce(
      async (step: string) => step === "stats.pool.fetch",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handlePoolsStatsCommand(
        "ETH",
        {},
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
    expect(resolvePoolMock).toHaveBeenCalledTimes(1);
    expect(fetchPoolStatisticsMock).not.toHaveBeenCalled();
  });
});
