import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import { renderBroadcast } from "../../src/output/broadcast.ts";
import {
  captureOutput,
  makeMode,
  parseCapturedJson,
} from "../helpers/output.ts";

const TX_HASH = `0x${"ab".repeat(32)}`;

describe("broadcast output", () => {
  test("json mode emits a templated tx-status next action when submission ids are missing", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));

    const { stdout, stderr } = captureOutput(() =>
      renderBroadcast(ctx, {
        mode: "broadcast",
        broadcastMode: "relayed",
        sourceOperation: "withdraw",
        chain: "sepolia",
        submissionId: null,
        transactions: [
          {
            index: 0,
            description: "Relay withdrawal",
            txHash: TX_HASH,
            blockNumber: null,
            explorerUrl: null,
            status: "submitted",
          },
        ],
        localStateUpdated: false,
      }),
    );

    expect(stderr).toBe("");
    const json = parseCapturedJson(stdout);
    expect(json.transactions).toHaveLength(1);
    expect(json.nextActions).toHaveLength(1);
    expect(json.nextActions[0]).toMatchObject({
      command: "tx-status",
      when: "after_submit",
      runnable: false,
      parameters: [
        {
          name: "submissionId",
          type: "submission_id",
          required: true,
        },
      ],
    });
    expect(json.nextActions[0].cliCommand).toBeUndefined();
  });

  test("json mode emits withdraw follow-up guidance after confirmed bundles", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));

    const { stdout } = captureOutput(() =>
      renderBroadcast(ctx, {
        mode: "broadcast",
        broadcastMode: "onchain",
        sourceOperation: "withdraw",
        chain: "mainnet",
        submissionId: "sub-123",
        transactions: [
          {
            index: 0,
            description: "Direct withdrawal",
            txHash: TX_HASH,
            blockNumber: "123456",
            explorerUrl: "https://etherscan.io/tx/test",
            status: "confirmed",
          },
        ],
        localStateUpdated: false,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toEqual([
      expect.objectContaining({
        command: "accounts",
        when: "after_withdraw",
        options: { chain: "mainnet" },
        cliCommand: "privacy-pools accounts --agent --chain mainnet",
      }),
    ]);
  });

  test("human mode renders validation-only summaries without next steps", () => {
    const ctx = createOutputContext(makeMode());

    const { stdout, stderr } = captureOutput(() =>
      renderBroadcast(ctx, {
        mode: "broadcast",
        broadcastMode: "relayed",
        sourceOperation: "deposit",
        chain: "mainnet",
        validatedOnly: true,
        submittedBy: "0x1111111111111111111111111111111111111111",
        warnings: [
          {
            code: "VALIDATION_WARNING",
            category: "INPUT",
            message: "Validation used a cached quote.",
          },
        ],
        transactions: [
          {
            index: 0,
            description: "Approve token",
            txHash: null,
            blockNumber: null,
            explorerUrl: null,
            status: "validated",
          },
        ],
        localStateUpdated: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Broadcast validation complete: 1 transaction checked for mainnet.");
    expect(stderr).toContain("Validated signer: 0x1111111111111111111111111111111111111111");
    expect(stderr).toContain("Validation used a cached quote.");
    expect(stderr).toContain("1. Approve token");
    expect(stderr).toContain("validated only");
    expect(stderr).not.toContain("Next steps:");
  });

  test("human mode renders confirmed ragequit summaries and follow-up commands", () => {
    const ctx = createOutputContext(makeMode());

    const { stderr } = captureOutput(() =>
      renderBroadcast(ctx, {
        mode: "broadcast",
        broadcastMode: "onchain",
        sourceOperation: "ragequit",
        chain: "sepolia",
        submittedBy: "0x2222222222222222222222222222222222222222",
        warnings: [
          {
            code: "SYNC_PENDING",
            category: "SETUP",
            message: "Local state will refresh on the next sync.",
          },
        ],
        transactions: [
          {
            index: 0,
            description: "Public recovery transaction",
            txHash: TX_HASH,
            blockNumber: "42",
            explorerUrl: "https://sepolia.etherscan.io/tx/test",
            status: "confirmed",
          },
        ],
        localStateUpdated: false,
      }),
    );

    expect(stderr).toContain("Broadcast complete: 1 transaction confirmed on sepolia.");
    expect(stderr).toContain("Mode: onchain");
    expect(stderr).toContain("Source: ragequit");
    expect(stderr).toContain("Submitted by: 0x2222222222222222222222222222222222222222");
    expect(stderr).toContain("Local state will refresh on the next sync.");
    expect(stderr).toContain("Public recovery transaction");
    expect(stderr).toContain("block 42");
    expect(stderr).toContain("https://sepolia.etherscan.io/tx/test");
    expect(stderr).toContain("privacy-pools accounts --chain sepolia");
  });
});
