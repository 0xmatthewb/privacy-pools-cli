import { describe, expect, test } from "bun:test";
import { formatSyncBlockRangeProgress } from "../../src/commands/sync.ts";
import { registerAccountReadonlyCommandHandlerHarness } from "../helpers/account-readonly-command-handlers.harness.ts";
import { registerReadonlySyncTests } from "../helpers/account-readonly-command-handlers.sync.groups.ts";

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
});
