import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Command } from "commander";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
} from "../helpers/output.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realBroadcastService = captureModuleExports(
  await import("../../src/services/broadcast.ts"),
);

const broadcastEnvelopeMock = mock(async () => ({
  mode: "broadcast" as const,
  broadcastMode: "onchain" as const,
  sourceOperation: "deposit" as const,
  chain: "mainnet",
  submittedBy: "0x1111111111111111111111111111111111111111",
  transactions: [
    {
      index: 0,
      description: "Deposit ETH into Privacy Pool",
      txHash: "0x" + "ab".repeat(32),
      blockNumber: "101",
      explorerUrl: "https://etherscan.io/tx/0x" + "ab".repeat(32),
      status: "confirmed" as const,
    },
  ],
  localStateUpdated: false as const,
}));

let handleBroadcastCommand: typeof import("../../src/commands/broadcast.ts").handleBroadcastCommand;

function fakeRoot(globalOpts: Record<string, unknown> = {}): Command {
  return {
    opts: () => globalOpts,
  } as unknown as Command;
}

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: fakeRoot(globalOpts),
  } as unknown as Command;
}

beforeAll(async () => {
  installModuleMocks([
    [
      "../../src/services/broadcast.ts",
      () => ({
        ...realBroadcastService,
        broadcastEnvelope: broadcastEnvelopeMock,
      }),
    ],
  ]);

  ({ handleBroadcastCommand } = await import("../../src/commands/broadcast.ts?broadcast-command-handler-tests"));
});

afterEach(() => {
  broadcastEnvelopeMock.mockClear();
  mock.restore();
});

afterAll(() => {
  restoreModuleImplementations([
    ["../../src/services/broadcast.ts", realBroadcastService],
  ]);
});

describe("broadcast command handler", () => {
  test("reads envelope JSON from a file and forwards chain/rpc overrides", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-broadcast-handler-"));
    try {
      const file = join(dir, "envelope.json");
      writeFileSync(
        file,
        JSON.stringify({
          schemaVersion: JSON_SCHEMA_VERSION,
          success: true,
          mode: "unsigned",
          operation: "deposit",
          chain: "mainnet",
          asset: "ETH",
          amount: "1",
          precommitment: "42",
          warnings: [],
          transactions: [
            {
              chainId: 1,
              from: null,
              to: "0x1111111111111111111111111111111111111111",
              value: "1",
              data: "0x1234",
              description: "Deposit ETH into Privacy Pool",
            },
          ],
          signedTransactions: ["0x02"],
        }),
      );

      const { json } = await captureAsyncJsonOutput(() =>
        handleBroadcastCommand(
          file,
          {},
          fakeCommand({ json: true, chain: "mainnet", rpcUrl: "http://rpc.local" }),
        ),
      );

      expect(broadcastEnvelopeMock).toHaveBeenCalledTimes(1);
      expect(broadcastEnvelopeMock.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          operation: "deposit",
          chain: "mainnet",
        }),
      );
      expect(broadcastEnvelopeMock.mock.calls[0]?.[1]).toEqual({
        rpcOverride: "http://rpc.local",
        expectedChain: "mainnet",
        validateOnly: false,
        noWait: false,
      });
      expect(json.success).toBe(true);
      expect(json.mode).toBe("broadcast");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects inline JSON input", async () => {
    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleBroadcastCommand(
        '{"mode":"unsigned"}',
        {},
        fakeCommand({ json: true }),
      ),
    );

    expect(broadcastEnvelopeMock).not.toHaveBeenCalled();
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_BROADCAST_INLINE_JSON_UNSUPPORTED");
    expect(exitCode).toBe(2);
  });

  test("rejects malformed JSON files before calling the broadcast service", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-broadcast-handler-invalid-"));
    try {
      const file = join(dir, "invalid.json");
      writeFileSync(file, "{ definitely-not-json", "utf8");

      const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
        handleBroadcastCommand(
          file,
          {},
          fakeCommand({ json: true }),
        ),
      );

      expect(broadcastEnvelopeMock).not.toHaveBeenCalled();
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_BROADCAST_INVALID_JSON");
      expect(exitCode).toBe(2);
      expect(readFileSync(file, "utf8")).toContain("definitely-not-json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects unreadable broadcast inputs with a CLI error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-broadcast-handler-dir-"));
    try {
      const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
        handleBroadcastCommand(
          dir,
          {},
          fakeCommand({ json: true }),
        ),
      );

      expect(broadcastEnvelopeMock).not.toHaveBeenCalled();
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_BROADCAST_INPUT_UNREADABLE");
      expect(exitCode).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("forwards --validate-only to the broadcast service", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-broadcast-handler-validate-"));
    try {
      const file = join(dir, "envelope.json");
      writeFileSync(
        file,
        JSON.stringify({
          schemaVersion: JSON_SCHEMA_VERSION,
          success: true,
          mode: "unsigned",
          operation: "deposit",
          chain: "mainnet",
          asset: "ETH",
          amount: "1",
          precommitment: "42",
          warnings: [],
          transactions: [
            {
              chainId: 1,
              from: null,
              to: "0x1111111111111111111111111111111111111111",
              value: "1",
              data: "0x1234",
              description: "Deposit ETH into Privacy Pool",
            },
          ],
          signedTransactions: ["0x02"],
        }),
      );

      await captureAsyncJsonOutput(() =>
        handleBroadcastCommand(
          file,
          { validateOnly: true },
          fakeCommand({ json: true }),
        ),
      );

      expect(broadcastEnvelopeMock).toHaveBeenCalledTimes(1);
      expect(broadcastEnvelopeMock.mock.calls[0]?.[1]).toEqual({
        rpcOverride: undefined,
        expectedChain: undefined,
        validateOnly: true,
        noWait: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
