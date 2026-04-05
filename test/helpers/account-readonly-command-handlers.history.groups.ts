import { expect, test } from "bun:test";
import { captureAsyncJsonOutput } from "./output.ts";
import {
  DECLINED_LEGACY_POOL_ACCOUNT,
  fakeCommand,
  getReadonlyCommandHandlers,
  readonlyHarnessMocks,
  useIsolatedHome,
} from "./account-readonly-command-handlers.harness.ts";

export function registerReadonlyHistoryTests(): void {
  test("history returns newest events first and honors the limit", async () => {
    useIsolatedHome("mainnet");
    const { handleHistoryCommand } = getReadonlyCommandHandlers();

    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => ({
        accountService: {
          account: {
            poolAccounts: new Map([
              [
                1n,
                [
                  {
                    deposit: {
                      value: 900000000000000000n,
                      blockNumber: 100n,
                      txHash: "0x" + "11".repeat(32),
                    },
                    children: [
                      {
                        value: 400000000000000000n,
                        blockNumber: 150n,
                        txHash: "0x" + "22".repeat(32),
                      },
                    ],
                    ragequit: {
                      value: 500000000000000000n,
                      blockNumber: 200n,
                      transactionHash: "0x" + "33".repeat(32),
                    },
                  },
                ],
              ],
            ]),
          },
        },
        skipImmediateSync: false,
        rebuiltLegacyAccount: false,
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleHistoryCommand({ limit: "2" }, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.chain).toBe("mainnet");
    expect(json.events).toHaveLength(2);
    expect(json.events[0]).toEqual(
      expect.objectContaining({
        type: "ragequit",
        poolAccountId: "PA-1",
      }),
    );
    expect(json.events[1]).toEqual(
      expect.objectContaining({
        type: "withdrawal",
        poolAccountId: "PA-1",
      }),
    );
  });

  test("history includes declined legacy deposits when website recovery visibility is available", async () => {
    useIsolatedHome("mainnet");
    const { handleHistoryCommand } = getReadonlyCommandHandlers();

    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => ({
        accountService: {
          account: {
            poolAccounts: new Map(),
            __legacyPoolAccounts: new Map([
              [1n, [DECLINED_LEGACY_POOL_ACCOUNT]],
            ]),
          },
        },
        skipImmediateSync: false,
        rebuiltLegacyAccount: false,
        legacyDeclinedLabels: new Set(["303"]),
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleHistoryCommand(
        { limit: "5" },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "deposit",
          poolAccountId: "PA-1",
          value: "700000000000000000",
          txHash: "0x" + "cc".repeat(32),
        }),
      ]),
    );
  });

  test("history keeps declined legacy deposits visible in mixed migration-required wallets", async () => {
    useIsolatedHome("mainnet");
    const { handleHistoryCommand } = getReadonlyCommandHandlers();

    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => ({
        accountService: {
          account: {
            poolAccounts: new Map([
              [
                1n,
                [
                  {
                    deposit: {
                      value: 900000000000000000n,
                      blockNumber: 150n,
                      txHash: "0x" + "aa".repeat(32),
                    },
                    children: [],
                  },
                ],
              ],
            ]),
            __legacyPoolAccounts: new Map([
              [1n, [DECLINED_LEGACY_POOL_ACCOUNT]],
            ]),
          },
        },
        skipImmediateSync: false,
        rebuiltLegacyAccount: false,
        legacyDeclinedLabels: new Set(["303"]),
      }),
    );

    const { json } = await captureAsyncJsonOutput(() =>
      handleHistoryCommand(
        { limit: "10" },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "deposit",
          poolAccountId: "PA-1",
          txHash: "0x" + "aa".repeat(32),
        }),
        expect.objectContaining({
          type: "deposit",
          poolAccountId: "PA-1",
          value: "700000000000000000",
          txHash: "0x" + "cc".repeat(32),
        }),
      ]),
    );
  });
}
