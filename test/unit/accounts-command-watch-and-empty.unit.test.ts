import { afterEach, describe, expect, jest, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  accountExists,
  accountHasDeposits,
  saveAccount,
} from "../../src/services/account-storage.ts";
import {
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
} from "../helpers/output.ts";
import {
  fakeCommand,
  getReadonlyCommandHandlers,
  readonlyHarnessMocks,
  registerAccountReadonlyCommandHandlerHarness,
  useIsolatedHome,
} from "../helpers/account-readonly-command-handlers.harness.ts";

registerAccountReadonlyCommandHandlerHarness();

const originalStderrIsTTY = process.stderr.isTTY;

function pendingPoolAccount() {
  return {
    paNumber: 2,
    paId: "PA-2",
    status: "pending",
    aspStatus: "pending",
    commitment: {
      hash: 202n,
      label: 102n,
      value: 400000000000000000n,
    },
    label: 102n,
    value: 400000000000000000n,
    blockNumber: 124n,
    txHash: "0x" + "bb".repeat(32),
  };
}

function approvedPoolAccount() {
  return {
    ...pendingPoolAccount(),
    status: "approved",
    aspStatus: "approved",
  };
}

afterEach(() => {
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: originalStderrIsTTY,
  });
  jest.useRealTimers();
});

describe("accounts command watch and empty states", () => {
  test("accounts rejects invalid status filters", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand(
        { status: "wat" },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain("Invalid --status value");
    expect(exitCode).toBe(2);
  });

  test("accounts rejects pendingOnly with a non-pending status", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand(
        { pendingOnly: true, status: "approved" },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain(
      "Cannot combine --pending-only with a non-pending --status filter",
    );
    expect(exitCode).toBe(2);
  });

  test("accounts rejects --watch in machine-readable output modes", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleAccountsCommand(
        { watch: true, pendingOnly: true },
        fakeCommand({ json: true, chain: "mainnet" }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.error.message ?? json.errorMessage).toContain(
      "--watch is only available in interactive TTY terminals. Use privacy-pools accounts --no-sync for a single snapshot.",
    );
    expect(exitCode).toBe(2);
  });

  test("accounts rejects --watch without a pending filter", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleAccountsCommand({ watch: true }, fakeCommand({ chain: "mainnet" })),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("--watch requires pending approvals");
  });

  test("accounts rejects --watch in non-TTY human mode", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: false,
    });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleAccountsCommand(
        { watch: true, pendingOnly: true },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain(
      "--watch is only available in interactive TTY terminals. Use privacy-pools accounts --no-sync for a single snapshot.",
    );
  });

  test("accounts watch rerenders until no pending approvals remain", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });

    readonlyHarnessMocks.buildAllPoolAccountRefsMock
      .mockImplementationOnce(() => [pendingPoolAccount()])
      .mockImplementationOnce(() => [approvedPoolAccount()]);

    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void) => {
      queueMicrotask(() => fn());
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof globalThis.setTimeout;
    globalThis.clearTimeout = (() => undefined) as typeof globalThis.clearTimeout;

    let captured: Awaited<ReturnType<typeof captureAsyncOutput>>;
    try {
      captured = await captureAsyncOutput(() =>
        handleAccountsCommand(
          { watch: true, pendingOnly: true },
          fakeCommand({ chain: "mainnet" }),
        ),
      );
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }

    expect(readonlyHarnessMocks.listPoolsMock).toHaveBeenCalledTimes(2);
    expect(captured.stderr).toContain("\x1bc");
    expect(captured.stderr).toContain("No pending Pool Accounts are left");
  });

  test("accounts empty state points to another chain with saved activity", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => ({
        accountService: {
          account: { poolAccounts: new Map() },
          getSpendableCommitments: () => new Map(),
        },
        skipImmediateSync: false,
        rebuiltLegacyAccount: false,
      }),
    );
    saveAccount(CHAINS.optimism.id, {
      poolAccounts: new Map([[2n, [{}]]]),
    });
    expect(accountHasDeposits(CHAINS.optimism.id)).toBe(true);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleAccountsCommand({}, fakeCommand({ chain: "mainnet" })),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("saved deposit state exists on optimism");
    expect(stderr).toContain("privacy-pools accounts --chain optimism");
  });

  test("accounts empty state treats empty account files as a fresh wallet without local deposit history", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();
    readonlyHarnessMocks.initializeAccountServiceWithStateMock.mockImplementationOnce(
      async () => ({
        accountService: {
          account: { poolAccounts: new Map() },
          getSpendableCommitments: () => new Map(),
        },
        skipImmediateSync: false,
        rebuiltLegacyAccount: false,
      }),
    );
    saveAccount(CHAINS.mainnet.id, {
      poolAccounts: new Map(),
    });
    expect(accountExists(CHAINS.mainnet.id)).toBe(true);
    expect(accountHasDeposits(CHAINS.mainnet.id)).toBe(false);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleAccountsCommand({}, fakeCommand({ chain: "mainnet" })),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("No Pool Accounts are visible on mainnet yet.");
    expect(stderr).toContain("privacy-pools flow start");
    expect(stderr).toContain("easiest path once you have chosen an amount and recipient");
  });

  test("accounts empty state explains status filters that remove every pool account", async () => {
    useIsolatedHome("mainnet");
    const { handleAccountsCommand } = getReadonlyCommandHandlers();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleAccountsCommand(
        { status: "declined" },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("No declined Pool Accounts are visible");
    expect(stderr).toContain("re-running accounts without --status");
  });
});
