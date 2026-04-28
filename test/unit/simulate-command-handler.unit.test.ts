import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Command } from "commander";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
} from "../helpers/output.ts";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realDeposit = captureModuleExports(
  await import("../../src/commands/deposit.ts"),
);
const realWithdraw = captureModuleExports(
  await import("../../src/commands/withdraw.ts"),
);
const realRagequit = captureModuleExports(
  await import("../../src/commands/ragequit.ts"),
);

const handleDepositMock = mock(async () => undefined);
const handleWithdrawMock = mock(async () => undefined);
const handleRagequitMock = mock(async () => undefined);

let handleSimulateDepositCommand: typeof import("../../src/commands/simulate.ts").handleSimulateDepositCommand;
let handleSimulateRootCommand: typeof import("../../src/commands/simulate.ts").handleSimulateRootCommand;
let handleSimulateWithdrawCommand: typeof import("../../src/commands/simulate.ts").handleSimulateWithdrawCommand;
let handleSimulateRagequitCommand: typeof import("../../src/commands/simulate.ts").handleSimulateRagequitCommand;

function fakeRoot(globalOpts: Record<string, unknown> = {}): Command {
  return {
    opts: () => globalOpts,
  } as unknown as Command;
}

function fakeSimulateCommand(globalOpts: Record<string, unknown> = {}): Command {
  const root = fakeRoot(globalOpts);
  const simulateRoot = {
    parent: root,
    opts: () => ({}),
  } as unknown as Command;
  return {
    parent: simulateRoot,
  } as unknown as Command;
}

beforeAll(async () => {
  installModuleMocks([
    [
      "../../src/commands/deposit.ts",
      () => ({
        ...realDeposit,
        handleDepositCommand: handleDepositMock,
      }),
    ],
    [
      "../../src/commands/withdraw.ts",
      () => ({
        ...realWithdraw,
        handleWithdrawCommand: handleWithdrawMock,
      }),
    ],
    [
      "../../src/commands/ragequit.ts",
      () => ({
        ...realRagequit,
        handleRagequitCommand: handleRagequitMock,
      }),
    ],
  ]);

  ({
    handleSimulateDepositCommand,
    handleSimulateRootCommand,
    handleSimulateWithdrawCommand,
    handleSimulateRagequitCommand,
  } = await import("../../src/commands/simulate.ts?simulate-command-handler-tests"));
});

afterEach(() => {
  handleDepositMock.mockClear();
  handleWithdrawMock.mockClear();
  handleRagequitMock.mockClear();
});

afterAll(() => {
  restoreModuleImplementations([
    ["../../src/commands/deposit.ts", realDeposit],
    ["../../src/commands/withdraw.ts", realWithdraw],
    ["../../src/commands/ragequit.ts", realRagequit],
  ]);
});

describe("simulate command handler", () => {
  test("simulate root returns stable JSON help without delegating", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleSimulateRootCommand(
        {},
        {
          parent: fakeRoot({ json: true }),
          helpInformation: () => "simulate help\n",
        } as unknown as Command,
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.command).toBe("simulate");
    expect(json.subcommands).toEqual(["deposit", "withdraw", "ragequit"]);
    expect(json.help).toBe("simulate help");
    expect(stderr).toBe("");
    expect(handleDepositMock).not.toHaveBeenCalled();
    expect(handleWithdrawMock).not.toHaveBeenCalled();
    expect(handleRagequitMock).not.toHaveBeenCalled();
  });

  test("simulate deposit delegates to deposit with dryRun forced on", async () => {
    const cmd = fakeSimulateCommand({ json: true, chain: "mainnet" });

    await handleSimulateDepositCommand(
      "0.1",
      "ETH",
      { ignoreUniqueAmount: true },
      cmd,
    );

    expect(handleDepositMock).toHaveBeenCalledTimes(1);
    const [amount, asset, opts, delegatedCmd] = handleDepositMock.mock.calls[0]!;
    expect(amount).toBe("0.1");
    expect(asset).toBe("ETH");
    expect(opts).toEqual({
      ignoreUniqueAmount: true,
      dryRun: true,
      unsigned: undefined,
    });
    expect((delegatedCmd as Command).parent?.opts()).toEqual({
      json: true,
      chain: "mainnet",
    });
  });

  test("simulate withdraw delegates to withdraw with dryRun forced on", async () => {
    const cmd = fakeSimulateCommand({ json: true, chain: "mainnet" });

    await handleSimulateWithdrawCommand(
      "0.05",
      "ETH",
      {
        to: "0x1111111111111111111111111111111111111111",
        direct: true,
        confirmDirectWithdraw: true,
      },
      cmd,
    );

    expect(handleWithdrawMock).toHaveBeenCalledTimes(1);
    const [amount, asset, opts] = handleWithdrawMock.mock.calls[0]!;
    expect(amount).toBe("0.05");
    expect(asset).toBe("ETH");
    expect(opts).toEqual({
      to: "0x1111111111111111111111111111111111111111",
      direct: true,
      confirmDirectWithdraw: true,
      dryRun: true,
      unsigned: undefined,
    });
  });

  test("simulate ragequit delegates to ragequit with dryRun forced on", async () => {
    const cmd = fakeSimulateCommand({ json: true, chain: "mainnet" });

    await handleSimulateRagequitCommand(
      "ETH",
      {
        poolAccount: "PA-1",
        confirmRagequit: true,
      },
      cmd,
    );

    expect(handleRagequitMock).toHaveBeenCalledTimes(1);
    const [asset, opts] = handleRagequitMock.mock.calls[0]!;
    expect(asset).toBe("ETH");
    expect(opts).toEqual({
      poolAccount: "PA-1",
      confirmRagequit: true,
      dryRun: true,
      unsigned: undefined,
    });
  });

  test("simulate rejects --unsigned before delegating", async () => {
    const cmd = fakeSimulateCommand({ json: true });
    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleSimulateDepositCommand(
        "0.1",
        "ETH",
        { unsigned: true },
        cmd,
      ),
    );

    expect(handleDepositMock).not.toHaveBeenCalled();
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_SIMULATE_UNSIGNED_UNSUPPORTED");
    expect(json.error.message ?? json.errorMessage).toContain(
      "does not accept --unsigned",
    );
    expect(exitCode).toBe(2);
  });
});
