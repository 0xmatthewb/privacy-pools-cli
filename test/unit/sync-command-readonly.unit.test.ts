import { describe, expect, test } from "bun:test";
import {
  formatSyncBlockRangeProgress,
  summarizeSyncedEventCounts,
} from "../../src/commands/sync.ts";
import { registerAccountReadonlyCommandHandlerHarness } from "../helpers/account-readonly-command-handlers.harness.ts";
import { registerReadonlySyncTests } from "../helpers/account-readonly-command-handlers.sync.groups.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncOutput,
} from "../helpers/output.ts";
import {
  fakeCommand,
  getReadonlyCommandHandlers,
  readonlyHarnessMocks,
  useIsolatedHome,
} from "../helpers/account-readonly-command-handlers.harness.ts";

registerAccountReadonlyCommandHandlerHarness();

describe("sync command readonly", () => {
  registerReadonlySyncTests();

  test("formats block-range progress with a bounded percentage", () => {
    expect(
      formatSyncBlockRangeProgress({
        fromBlock: 100n,
        toBlock: 200n,
        currentBlock: 150n,
        label: "ETH deposits",
      }),
    ).toBe("Syncing ETH deposits (blocks 100 to 200) [#########---------] 50%");

    expect(
      formatSyncBlockRangeProgress({
        fromBlock: 100n,
        toBlock: null,
        currentBlock: 100n,
      }),
    ).toBe("Syncing events (blocks 100 to latest)...");
  });

  test("summarizes synced event counts across deposits, withdrawals, ragequits, and migrations", () => {
    expect(summarizeSyncedEventCounts(null)).toEqual({
      deposits: 0,
      withdrawals: 0,
      ragequits: 0,
      migrations: 0,
      total: 0,
    });

    expect(
      summarizeSyncedEventCounts({
        poolAccounts: new Map([
          [
            1n,
            [
              {
                deposit: {},
                children: [{}, {}],
                ragequit: {},
                isMigrated: true,
              },
              {
                deposit: {},
                children: [],
                ragequit: null,
                isMigrated: false,
              },
            ],
          ],
          [2n, "not-an-array"],
        ]),
      }),
    ).toEqual({
      deposits: 2,
      withdrawals: 2,
      ragequits: 1,
      migrations: 1,
      total: 6,
    });
  });

  test("renders a safe empty sync result without loading wallet state", async () => {
    useIsolatedHome("mainnet");
    readonlyHarnessMocks.listPoolsMock.mockImplementationOnce(async () => []);
    const { handleSyncCommand } = getReadonlyCommandHandlers();

    const { json } = await captureAsyncJsonOutput(() =>
      handleSyncCommand(undefined, {}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.syncedPools).toBe(0);
    expect(json.availablePoolAccounts).toBe(0);
    expect(readonlyHarnessMocks.initializeAccountServiceWithStateMock).not.toHaveBeenCalled();
    expect(readonlyHarnessMocks.syncAccountEventsMock).not.toHaveBeenCalled();
  });

  test("streams sync progress events before the final machine envelope", async () => {
    useIsolatedHome("mainnet");
    const { handleSyncCommand } = getReadonlyCommandHandlers();

    let spendableCount = 1;
    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => ({
        accountService: {
          account: {
            poolAccounts: new Map([
              [
                1n,
                [
                  {
                    deposit: {},
                    children: [{}],
                    ragequit: {},
                    isMigrated: true,
                  },
                ],
              ],
            ]),
          },
          getSpendableCommitments: () =>
            new Map([
              [
                1n,
                Array.from({ length: spendableCount }, (_, index) => ({
                  label: BigInt(index + 1),
                })),
              ],
            ]),
        },
        skipImmediateSync: false,
        rebuiltLegacyAccount: false,
      }),
    );
    readonlyHarnessMocks.syncAccountEventsMock.mockImplementationOnce(async () => {
      spendableCount = 2;
      return true;
    });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleSyncCommand(
        "ETH",
        { streamJson: true },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    const lines = stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.map((line) => line.stage).filter(Boolean)).toEqual(
      expect.arrayContaining([
        "resolving_pools",
        "loading_account_state",
        "syncing_events",
        "finalizing",
      ]),
    );
    expect(lines.at(-1)).toMatchObject({
      success: true,
      chain: "mainnet",
      syncedPools: 1,
      availablePoolAccounts: 2,
      eventCounts: {
        deposits: 1,
        withdrawals: 1,
        ragequits: 1,
        migrations: 1,
        total: 4,
      },
    });
    expect(stderr).toBe("");
  });
});
