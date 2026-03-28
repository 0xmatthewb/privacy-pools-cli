import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { FlowSnapshot } from "../../src/services/workflow.ts";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { makeMode, captureOutput, parseCapturedJson } from "../helpers/output.ts";

const realFormat = await import("../../src/utils/format.ts");

let createOutputContext: typeof import("../../src/output/common.ts").createOutputContext;
let renderFlowResult: typeof import("../../src/output/flow.ts").renderFlowResult;

beforeAll(async () => {
  mock.module("../../src/utils/format.ts", () => realFormat);
  ({ createOutputContext } = await import("../../src/output/common.ts?output-flow-renderers"));
  ({ renderFlowResult } = await import("../../src/output/flow.ts?output-flow-renderers"));
});

function sampleSnapshot(
  patch: Partial<FlowSnapshot> = {},
): FlowSnapshot {
  return {
    schemaVersion: WORKFLOW_SNAPSHOT_VERSION,
    workflowId: "wf-123",
    createdAt: "2026-03-24T12:00:00.000Z",
    updatedAt: "2026-03-24T12:00:00.000Z",
    phase: "awaiting_asp",
    chain: "sepolia",
    asset: "ETH",
    assetDecimals: 18,
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
    expect(json.privacyDelayProfile).toBe("off");
    expect(json.privacyDelayConfigured).toBe(false);
    expect(json.backupConfirmed).toBeUndefined();
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
          "This workflow was declined. flow ragequit is the canonical saved-workflow public recovery path.",
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
    expect(stderr).toContain("privacy-pools flow ragequit wf-123");
  });

  test("JSON mode marks PoA watch follow-up as non-runnable and surfaces public recovery", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "paused_poi_required",
          aspStatus: "poi_required",
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toEqual([
      {
        command: "flow watch",
        reason:
          "Complete Proof of Association externally first, then re-check this workflow to continue privately.",
        when: "flow_resume",
        args: ["wf-123"],
        options: { agent: true },
        runnable: false,
      },
      {
        command: "flow ragequit",
        reason:
          "Use flow ragequit instead if you want to recover publicly without completing Proof of Association.",
        when: "flow_public_recovery_optional",
        args: ["wf-123"],
        options: { agent: true },
      },
    ]);
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

  test("human mode formats saved funding and committed amounts", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "awaiting_funding",
          asset: "USDC",
          assetDecimals: 6,
          depositAmount: "100000000",
          requiredTokenFunding: "100000000",
          requiredNativeFunding: "100000000000000000",
          committedValue: "99500000",
          walletMode: "new_wallet",
          walletAddress: "0x5555555555555555555555555555555555555555",
          poolAccountId: null,
          poolAccountNumber: null,
          depositTxHash: null,
          depositBlockNumber: null,
          depositExplorerUrl: null,
          aspStatus: undefined,
        }),
      }),
    );

    expect(stderr).toContain("Deposit amount: 100 USDC");
    expect(stderr).toContain("Required token funding: 100 USDC");
    expect(stderr).toContain("Required native funding: 0.1 ETH");
    expect(stderr).toContain("Committed value: 99.5 USDC");
    expect(stderr).toContain("Wallet mode: Dedicated workflow wallet");
  });

  test("human mode falls back to raw stored amounts when snapshot values are corrupt", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "awaiting_funding",
          asset: "USDC",
          assetDecimals: 6,
          depositAmount: "not-a-bigint",
          requiredTokenFunding: "still-not-a-bigint",
          requiredNativeFunding: "bad-native-value",
          committedValue: "also-bad",
          walletMode: "new_wallet",
          walletAddress: "0x5555555555555555555555555555555555555555",
          poolAccountId: null,
          poolAccountNumber: null,
          depositTxHash: null,
          depositBlockNumber: null,
          depositExplorerUrl: null,
          aspStatus: undefined,
        }),
      }),
    );

    expect(stderr).toContain("Deposit amount: not-a-bigint");
    expect(stderr).toContain("Required token funding: still-not-a-bigint");
    expect(stderr).toContain("Required native funding: bad-native-value");
    expect(stderr).toContain("Committed value: also-bad");
  });

  test("human mode does not print the happy-path start message for declined starts", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "start",
        snapshot: sampleSnapshot({
          phase: "paused_declined",
          aspStatus: "declined",
        }),
      }),
    );

    expect(stderr).toContain("was declined by the ASP");
    expect(stderr).not.toContain(
      "the private withdrawal will run after ASP approval",
    );
  });

  test("human mode reports submitted public recovery transactions clearly", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "paused_declined",
          aspStatus: "declined",
          ragequitTxHash:
            "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          ragequitBlockNumber: null,
          ragequitExplorerUrl: "https://example.test/ragequit",
        }),
      }),
    );

    expect(stderr).toContain("already submitted the public recovery transaction");
    expect(stderr).toContain("privacy-pools flow ragequit wf-123");
  });

  test("JSON mode includes privacy warnings and delay fields for pending flows", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          asset: "USDC",
          assetDecimals: 6,
          committedValue: "100198474",
          privacyDelayProfile: "off",
          privacyDelayConfigured: true,
          privacyDelayUntil: "2026-03-24T13:00:00.000Z",
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.privacyDelayProfile).toBe("off");
    expect(json.privacyDelayConfigured).toBe(true);
    expect(json.privacyDelayUntil).toBe("2026-03-24T13:00:00.000Z");
    expect(json.warnings).toEqual([
      expect.objectContaining({
        code: "timing_delay_disabled",
        category: "privacy",
      }),
      expect.objectContaining({
        code: "amount_pattern_linkability",
        category: "privacy",
      }),
    ]);
  });

  test("human mode reports the privacy hold phase and warnings", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "watch",
        snapshot: sampleSnapshot({
          asset: "USDC",
          assetDecimals: 6,
          committedValue: "100198474",
          privacyDelayProfile: "balanced",
          privacyDelayConfigured: true,
          phase: "approved_waiting_privacy_delay",
          aspStatus: "approved",
          privacyDelayUntil: "2026-03-24T13:00:00.000Z",
        }),
      }),
    );

    expect(stderr).toContain("Approved and waiting for privacy delay");
    expect(stderr).toContain("Privacy delay until: 2026-03-24T13:00:00.000Z");
    expect(stderr).toContain("Balanced (randomized 15 to 90 minutes)");
    expect(stderr).toContain("manual round partial withdrawals");
  });

  test("human mode labels legacy off-delay snapshots without showing backup state for configured wallets", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          privacyDelayProfile: "off",
          privacyDelayConfigured: false,
        }),
      }),
    );

    expect(stderr).toContain(
      "Off (legacy workflow without a saved privacy-delay policy; behaves like no added hold)",
    );
    expect(stderr).not.toContain("Backup confirmed:");
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
    expect(json.backupConfirmed).toBe(true);
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

  test("human mode falls back to the raw phase label for unknown snapshots", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "mystery_phase" as FlowSnapshot["phase"],
        }),
      }),
    );

    expect(stderr).toContain("Workflow wf-123 is mystery_phase.");
    expect(stderr).toContain("Phase: mystery_phase");
  });
});
