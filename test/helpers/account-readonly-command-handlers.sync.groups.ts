import { expect, test } from "bun:test";
import { captureAsyncJsonOutput } from "./output.ts";
import {
  fakeCommand,
  getReadonlyCommandHandlers,
  readonlyHarnessMocks,
  useIsolatedHome,
} from "./account-readonly-command-handlers.harness.ts";

export function registerReadonlySyncTests(): void {
  test("sync reports available Pool Account deltas in JSON mode", async () => {
    useIsolatedHome("mainnet");
    const { handleSyncCommand } = getReadonlyCommandHandlers();

    let spendableCount = 1;
    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => ({
        accountService: {
          account: { poolAccounts: new Map() },
          getSpendableCommitments: () =>
            new Map([
              [
                1n,
                Array.from({ length: spendableCount }, (_, index) => ({
                  label: BigInt(101 + index),
                })),
              ],
            ]),
        },
        skipImmediateSync: false,
        rebuiltLegacyAccount: false,
      }),
    );

    readonlyHarnessMocks.syncAccountEventsMock.mockImplementationOnce(
      async () => {
        spendableCount = 3;
        return true;
      },
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleSyncCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.chain).toBe("mainnet");
    expect(json.syncedPools).toBe(1);
    expect(json.availablePoolAccounts).toBe(3);
    expect(json.previousAvailablePoolAccounts).toBe(1);
  });
}
