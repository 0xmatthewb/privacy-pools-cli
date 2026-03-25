import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import { renderFlowResult } from "../../src/output/flow.ts";
import type { FlowSnapshot } from "../../src/services/workflow.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { makeMode, captureOutput, parseCapturedJson } from "../helpers/output.ts";

function sampleSnapshot(
  patch: Partial<FlowSnapshot> = {},
): FlowSnapshot {
  return {
    schemaVersion: "1.5.0",
    workflowId: "wf-123",
    createdAt: "2026-03-24T12:00:00.000Z",
    updatedAt: "2026-03-24T12:00:00.000Z",
    phase: "awaiting_asp",
    chain: "sepolia",
    asset: "ETH",
    depositAmount: "10000000000000000",
    recipient: "0x4444444444444444444444444444444444444444",
    poolAccountId: "PA-1",
    poolAccountNumber: 1,
    depositTxHash:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    depositBlockNumber: "12345",
    depositExplorerUrl: "https://example.test/deposit",
    committedValue: "9950000000000000",
    aspStatus: "pending",
    ...patch,
  };
}

describe("renderFlowResult", () => {
  test("JSON mode emits the shared flow snapshot contract with watch nextActions", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot(),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("flow");
    expect(json.action).toBe("status");
    expect(json.workflowId).toBe("wf-123");
    expect(json.phase).toBe("awaiting_asp");
    expect(json.nextActions).toEqual([
      {
        command: "flow watch",
        reason:
          "Resume this saved workflow and continue toward the private withdrawal.",
        when: "flow_resume",
        args: ["wf-123"],
        options: { agent: true },
      },
    ]);
    expect(stderr).toBe("");
  });

  test("JSON mode surfaces ragequit nextActions for declined workflows", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "watch",
        snapshot: sampleSnapshot({
          phase: "paused_declined",
          aspStatus: "declined",
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toEqual([
      {
        command: "flow ragequit",
        reason:
          "This workflow was declined. flow ragequit is the canonical saved-workflow recovery path.",
        when: "flow_declined",
        args: ["wf-123"],
        options: {
          agent: true,
        },
      },
    ]);
  });

  test("human mode prints PoA guidance and the saved watcher step", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "paused_poi_required",
          aspStatus: "poi_required",
        }),
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Proof of Association");
    expect(stderr).toContain("tornado.0xbow.io");
    expect(stderr).toContain("Next steps:");
    expect(stderr).toContain("privacy-pools flow watch wf-123");
  });

  test("human mode omits next steps for completed workflows", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "watch",
        snapshot: sampleSnapshot({
          phase: "completed",
          aspStatus: "approved",
          withdrawTxHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          withdrawBlockNumber: "12399",
          withdrawExplorerUrl: "https://example.test/withdraw",
        }),
      }),
    );

    expect(stderr).toContain("Flow completed");
    expect(stderr).not.toContain("Next steps:");
  });

  test("JSON mode includes funding guidance for awaiting_funding workflows", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "awaiting_funding",
          walletMode: "new_wallet",
          walletAddress: "0x5555555555555555555555555555555555555555",
          requiredNativeFunding: "123",
          requiredTokenFunding: "456",
          backupConfirmed: true,
          poolAccountId: null,
          poolAccountNumber: null,
          depositTxHash: null,
          depositBlockNumber: null,
          depositExplorerUrl: null,
          committedValue: null,
          aspStatus: undefined,
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.phase).toBe("awaiting_funding");
    expect(json.walletMode).toBe("new_wallet");
    expect(json.walletAddress).toBe("0x5555555555555555555555555555555555555555");
    expect(json.requiredNativeFunding).toBe("123");
    expect(json.requiredTokenFunding).toBe("456");
    expect(json.nextActions).toEqual([
      {
        command: "flow watch",
        reason:
          "Resume this saved workflow and continue toward the private withdrawal.",
        when: "flow_resume",
        args: ["wf-123"],
        options: { agent: true },
      },
    ]);
  });

  test("JSON mode keeps internal deposit label anchors out of the public contract", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          depositLabel: "91",
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.depositLabel).toBeUndefined();
  });
});
