import { beforeAll, describe, expect, mock, test } from "bun:test";
import { POA_PORTAL_URL } from "../../src/config/chains.ts";
import type { FlowSnapshot } from "../../src/services/workflow.ts";
import { WORKFLOW_SNAPSHOT_VERSION } from "../../src/services/workflow-storage-version.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { makeMode, captureOutput, parseCapturedJson } from "../helpers/output.ts";

const realFormat = await import("../../src/utils/format.ts");

let createOutputContext: typeof import("../../src/output/common.ts").createOutputContext;
let formatFlowStartReview: typeof import("../../src/output/flow.ts").formatFlowStartReview;
let formatFlowRagequitReview: typeof import("../../src/output/flow.ts").formatFlowRagequitReview;
let renderFlowStartDryRun: typeof import("../../src/output/flow.ts").renderFlowStartDryRun;
let renderFlowResult: typeof import("../../src/output/flow.ts").renderFlowResult;

function expectNextAction(
  action: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
  cliCommand: string,
): void {
  const { options, ...rest } = expected;
  const normalizedOptions =
    options && typeof options === "object"
      ? Object.fromEntries(
          Object.entries(options as Record<string, unknown>).filter(
            ([key]) => key !== "agent",
          ),
        )
      : undefined;
  expect(action).toMatchObject({
    ...rest,
    ...(normalizedOptions && Object.keys(normalizedOptions).length > 0
      ? { options: normalizedOptions }
      : {}),
  });
  expect((action?.options as Record<string, unknown> | undefined)?.agent).toBeUndefined();
  expect(action?.cliCommand).toBe(cliCommand);
}

beforeAll(async () => {
  mock.module("../../src/utils/format.ts", () => realFormat);
  ({ createOutputContext } = await import("../../src/output/common.ts"));
  ({
    formatFlowStartReview,
    formatFlowRagequitReview,
    renderFlowStartDryRun,
    renderFlowResult,
  } = await import("../../src/output/flow.ts"));
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
  test("formatFlowRagequitReview includes the original depositor caveat for configured wallets", () => {
    const review = formatFlowRagequitReview(
      sampleSnapshot({
        walletMode: "configured",
        committedValue: "9950000000000000",
        poolAccountId: "PA-9",
      }),
    );

    expect(review).toContain("Saved flow ragequit");
    expect(review).toContain("Workflow");
    expect(review).toContain("PA-9");
    expect(review).toContain("original deposit address");
    expect(review).toContain("original depositor signer");
  });

  test("formatFlowStartReview renders embedded callouts without nested gutters", () => {
    const review = formatFlowStartReview({
      amount: 100000000000000000n,
      feeAmount: 500000000000000n,
      estimatedCommitted: 99500000000000000n,
      asset: "ETH",
      chain: "mainnet",
      decimals: 18,
      recipient: "0x4444444444444444444444444444444444444444",
      privacyDelaySummary: "Balanced",
      newWallet: false,
      isErc20: false,
    });

    expect(review).toContain("Privacy note:");
    expect(review).not.toContain("| | Privacy note:");
    expect(review).not.toContain("│ │ Privacy note:");
  });

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
    expect(json.privacyDelayRandom).toBe(false);
    expect(json.privacyDelayRangeSeconds).toEqual([0, 0]);
    expect(json.backupConfirmed).toBeUndefined();
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "flow watch",
        reason:
          "Resume this saved workflow and continue toward the private withdrawal.",
        when: "flow_resume",
        args: ["wf-123"],
        options: { agent: true },
      },
      "privacy-pools flow watch wf-123 --agent",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode emits flow start dry-run privacy-delay metadata", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderFlowStartDryRun(ctx, {
        chain: "sepolia",
        asset: "ETH",
        assetDecimals: 18,
        depositAmount: 100000000000000000n,
        recipient: "0x4444444444444444444444444444444444444444",
        walletMode: "configured",
        privacyDelayProfile: "balanced",
        vettingFee: 500000000000000n,
        estimatedCommittedValue: 99500000000000000n,
        isErc20: false,
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("flow");
    expect(json.action).toBe("start");
    expect(json.dryRun).toBe(true);
    expect(json.privacyDelayRandom).toBe(true);
    expect(json.privacyDelayRangeSeconds).toEqual([900, 5400]);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "flow start",
        reason: "Start this saved workflow for real when you are ready to deposit.",
        when: "after_dry_run",
        args: ["0.1", "ETH"],
        options: {
          agent: true,
          chain: "sepolia",
          to: "0x4444444444444444444444444444444444444444",
          privacyDelay: "balanced",
        },
      },
      "privacy-pools flow start 0.1 ETH --agent --chain sepolia --to 0x4444444444444444444444444444444444444444 --privacy-delay balanced",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode hides tentative Pool Account ids before the public deposit is confirmed", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "awaiting_funding",
          walletMode: "new_wallet",
          walletAddress: "0x5555555555555555555555555555555555555555",
          requiredNativeFunding: "10000000000000000",
          poolAccountId: "PA-7",
          poolAccountNumber: 7,
          depositTxHash: null,
          depositBlockNumber: null,
          depositExplorerUrl: null,
          committedValue: null,
          aspStatus: undefined,
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.poolAccountId).toBeNull();
    expect(json.poolAccountNumber).toBeNull();
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
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "flow ragequit",
        reason:
          "This workflow was declined. flow ragequit is the canonical saved-workflow public recovery path. This configured-wallet workflow still requires the original depositor signer.",
        when: "flow_declined",
        args: ["wf-123"],
        options: {
          agent: true,
        },
      },
      "privacy-pools flow ragequit wf-123 --agent",
    );
  });

  test("JSON mode keeps flow watch nextActions for depositing and withdrawing phases", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));

    for (const phase of ["depositing_publicly", "withdrawing"] as const) {
      const { stdout } = captureOutput(() =>
        renderFlowResult(ctx, {
          action: "status",
          snapshot: sampleSnapshot({
            phase,
          }),
        }),
      );

      const json = parseCapturedJson(stdout);
      expect(json.nextActions).toBeArrayOfSize(1);
      expectNextAction(
        json.nextActions[0],
        {
          command: "flow watch",
          reason:
            "Resume this saved workflow and continue toward the private withdrawal.",
          when: "flow_resume",
          args: ["wf-123"],
          options: { agent: true },
        },
        "privacy-pools flow watch wf-123 --agent",
      );
    }
  });

  test("JSON mode switches to public recovery when the relayer minimum blocks the flow", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
          lastError: {
            step: "withdraw",
            errorCode: "FLOW_RELAYER_MINIMUM_BLOCKED",
            errorMessage:
              "Workflow amount is below the relayer minimum of 0.01 ETH.",
            retryable: false,
            at: "2026-03-24T12:00:00.000Z",
          },
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "flow ragequit",
        reason:
          "This saved workflow cannot continue privately because the full remaining balance is below the relayer minimum. Use flow ragequit for public recovery instead. This configured-wallet workflow still requires the original depositor signer.",
        when: "flow_public_recovery_required",
        args: ["wf-123"],
        options: { agent: true },
      },
      "privacy-pools flow ragequit wf-123 --agent",
    );
  });

  test("human mode prints PoA guidance and the saved watcher step", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "paused_poa_required",
          aspStatus: "poa_required",
        }),
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Proof of Association");
    expect(stderr).toContain(POA_PORTAL_URL);
    expect(stderr).toContain("Next steps:");
    expect(stderr).toContain("privacy-pools flow watch wf-123");
    expect(stderr).toContain("privacy-pools flow ragequit wf-123");
  });

  test("human mode reframes relayer-minimum blocks as public recovery required", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
          lastError: {
            step: "withdraw",
            errorCode: "FLOW_RELAYER_MINIMUM_BLOCKED",
            errorMessage:
              "Workflow amount is below the relayer minimum of 0.01 ETH.",
            retryable: false,
            at: "2026-03-24T12:00:00.000Z",
          },
        }),
      }),
    );

    expect(stderr).toContain("Public recovery required");
    expect(stderr).not.toContain("Approved and ready to withdraw");
    expect(stderr).toContain("Recover publicly");
    expect(stderr).toContain("privacy-pools flow ragequit wf-123");
  });

  test("JSON mode keeps the PoA watch follow-up runnable and surfaces public recovery", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "paused_poa_required",
          aspStatus: "poa_required",
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toBeArrayOfSize(2);
    expectNextAction(
      json.nextActions[0],
      {
        command: "flow watch",
        reason:
          `Complete Proof of Association at ${POA_PORTAL_URL} first, then re-check this workflow to continue privately.`,
        when: "flow_resume",
        args: ["wf-123"],
        options: { agent: true },
      },
      "privacy-pools flow watch wf-123 --agent",
    );
    expectNextAction(
      json.nextActions[1],
      {
        command: "flow ragequit",
        reason:
          "Use flow ragequit instead if you want to recover publicly without completing Proof of Association. This configured-wallet workflow still requires the original depositor signer.",
        when: "flow_public_recovery_optional",
        args: ["wf-123"],
        options: { agent: true },
      },
      "privacy-pools flow ragequit wf-123 --agent",
    );
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

    expect(stderr).toContain("Completed saved flow");
    expect(stderr).toContain("Block 12399");
    expect(stderr).not.toContain("Next steps:");
  });

  test("human mode reports successful flow ragequit actions", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "ragequit",
        snapshot: sampleSnapshot({
          phase: "completed_public_recovery",
          ragequitTxHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          ragequitBlockNumber: "12400",
          ragequitExplorerUrl: "https://example.test/ragequit",
        }),
      }),
    );

    expect(stderr).toContain("Ragequit saved flow");
    expect(stderr).toContain("Block 12400");
    expect(stderr).toContain(
      "Public recovery destination: original deposit address",
    );
    expect(stderr).not.toContain(
      "Recipient: 0x4444444444444444444444444444444444444444",
    );
  });

  test("human mode reports flow ragequit destination when wallet address is available", () => {
    const ctx = createOutputContext(makeMode());
    const destination = "0x5555555555555555555555555555555555555555";
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "ragequit",
        snapshot: sampleSnapshot({
          phase: "completed_public_recovery",
          walletAddress: destination,
          ragequitTxHash:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          ragequitBlockNumber: "12400",
          ragequitExplorerUrl: "https://example.test/ragequit",
        }),
      }),
    );

    expect(stderr).toContain(`Public recovery destination: ${destination}`);
    expect(stderr).toContain("Funds returned safely to");
    expect(stderr).toContain(`${destination}, but privacy was not preserved.`);
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

    expect(stderr).toMatch(/Deposit target:\s+100 USDC/);
    expect(stderr).toMatch(/Token funding:\s+100 USDC/);
    expect(stderr).toMatch(/Native gas:\s+0\.1 ETH/);
    // Committed value is phase-gated: not shown during awaiting_funding
    expect(stderr).not.toContain("Committed value:");
    // Wallet mode removed from human output (shown in JSON only)
    expect(stderr).not.toContain("Wallet mode:");
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

    expect(stderr).toMatch(/Deposit target:\s+not-a-bigint/);
    expect(stderr).toMatch(/Token funding:\s+still-not-a-bigint/);
    expect(stderr).toMatch(/Native gas:\s+bad-native-value/);
    // Committed value is phase-gated: not shown during awaiting_funding
    expect(stderr).not.toContain("Committed value:");
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

  test("human mode reports completed public recovery, leftover wallet funds, and last errors", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "completed_public_recovery",
          walletMode: "new_wallet",
          walletAddress: "0x5555555555555555555555555555555555555555",
          ragequitTxHash:
            "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          ragequitBlockNumber: "12401",
          ragequitExplorerUrl: "https://example.test/ragequit",
          lastError: {
            step: "watch",
            errorCode: "FLOW_STOPPED_EXTERNALLY",
            errorMessage: "The Pool Account changed outside this workflow.",
            retryable: false,
            at: "2026-03-24T12:30:00.000Z",
          },
        }),
      }),
    );

    expect(stderr).toContain("Ragequit saved flow");
    expect(stderr).toContain("Block 12401");
    expect(stderr).toContain(
      "Any leftover funds or gas reserve remain in the dedicated workflow wallet until you move them manually.",
    );
    expect(stderr).toContain(
      "Last error (watch): The Pool Account changed outside this workflow.",
    );
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
    expect(stderr).toMatch(
      /Privacy delay:\s+Balanced \(randomized 15 to 90 minutes\)/,
    );
    expect(stderr).toContain("Delay ends:");
    expect(stderr).toContain("local time");
    expect(stderr).toContain("manual round partial withdrawals");
  });

  test("human mode guides externally stopped workflows back to accounts", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "stopped_external",
          aspStatus: "approved",
          lastError: undefined,
        }),
      }),
    );

    expect(stderr).toContain("changed outside this saved workflow");
    expect(stderr).toContain(
      "Inspect the latest account state, then choose the right manual next step from there.",
    );
    expect(stderr).toContain("privacy-pools accounts --chain sepolia");
    expect(stderr).not.toContain("Optional public recovery");
  });

  test("JSON mode gives delay-specific resume guidance while the privacy hold is active", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "approved_waiting_privacy_delay",
          aspStatus: "approved",
          privacyDelayProfile: "balanced",
          privacyDelayConfigured: true,
          privacyDelayUntil: "2026-03-24T13:00:00.000Z",
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toHaveLength(1);
    expect(json.nextActions[0].command).toBe("flow watch");
    expect(json.nextActions[0].reason).toContain("holding until");
    expect(json.nextActions[0].reason).toContain("before requesting the relayed private withdrawal");
  });

  test("human mode labels legacy off-delay snapshots and hides backup state for configured wallets", () => {
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

    // Privacy delay profile shown during awaiting_asp phase
    expect(stderr).toContain(
      "Off (legacy workflow without a saved privacy-delay policy; behaves like no added hold)",
    );
    expect(stderr).not.toContain("Backup confirmed:");
  });

  test("human status mode explains that flow status is snapshot-only", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "awaiting_asp",
          aspStatus: "pending",
        }),
      }),
    );

    expect(stderr).toContain(
      "This is the saved local workflow snapshot. Run flow watch for a live re-check and to advance it.",
    );
  });

  test("human status mode suppresses optional public recovery copy when relayer minimum already blocks the private path", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "approved_ready_to_withdraw",
          aspStatus: "approved",
          lastError: {
            step: "withdraw",
            errorCode: "FLOW_RELAYER_MINIMUM_BLOCKED",
            errorMessage:
              "Workflow amount is below the relayer minimum of 0.01 ETH.",
            retryable: false,
            at: "2026-03-24T12:00:00.000Z",
          },
        }),
      }),
    );

    expect(stderr).not.toContain("Optional public recovery");
    expect(stderr).toContain("privacy-pools flow ragequit wf-123");
  });

  test("human status mode suppresses optional public recovery copy for terminal workflows", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
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

    expect(stderr).not.toContain("Optional public recovery");
    expect(stderr).toContain("Withdrawal:");
    expect(stderr).toContain("https://example.test/withdraw");
  });

  test("JSON mode includes funding guidance for awaiting_funding workflows", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "awaiting_funding",
          asset: "USDC",
          assetDecimals: 6,
          walletMode: "new_wallet",
          walletAddress: "0x5555555555555555555555555555555555555555",
          requiredNativeFunding: "123000000000000000",
          requiredTokenFunding: "456000000",
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
    expect(json.requiredNativeFunding).toBe("123000000000000000");
    expect(json.requiredTokenFunding).toBe("456000000");
    expect(json.backupConfirmed).toBe(true);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "flow watch",
        reason:
          "Fund the dedicated workflow wallet with 456 USDC and 0.123 ETH first, then re-run flow watch to continue.",
        when: "flow_resume",
        args: ["wf-123"],
        options: { agent: true },
      },
      "privacy-pools flow watch wf-123 --agent",
    );
  });

  test("JSON mode adds signer caveats to configured-wallet public recovery guidance", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          walletMode: "configured",
          phase: "paused_declined",
          aspStatus: "declined",
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "flow ragequit",
        reason:
          "This workflow was declined. flow ragequit is the canonical saved-workflow public recovery path. This configured-wallet workflow still requires the original depositor signer.",
        when: "flow_declined",
        args: ["wf-123"],
        options: { agent: true },
      },
      "privacy-pools flow ragequit wf-123 --agent",
    );
  });

  test("JSON mode surfaces a manual accounts follow-up for externally stopped workflows", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderFlowResult(ctx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "stopped_external",
          aspStatus: "approved",
        }),
      }),
    );

    const json = parseCapturedJson(stdout);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "accounts",
        reason:
          "This saved workflow stopped after PA-1 changed externally. Inspect the latest account state, then choose the manual follow-up from the current account state.",
        when: "flow_manual_followup",
        options: { agent: true, chain: "sepolia" },
      },
      "privacy-pools accounts --agent --chain sepolia",
    );
  });

  test("JSON mode suppresses privacy warnings for terminal and ragequit outputs", () => {
    const jsonCtx = createOutputContext(makeMode({ isJson: true }));

    const completed = captureOutput(() =>
      renderFlowResult(jsonCtx, {
        action: "status",
        snapshot: sampleSnapshot({
          phase: "completed",
          aspStatus: "approved",
          committedValue: "100198474",
          privacyDelayProfile: "off",
          privacyDelayConfigured: true,
        }),
      }),
    );
    expect(parseCapturedJson(completed.stdout).warnings).toBeUndefined();

    const watchedCompleted = captureOutput(() =>
      renderFlowResult(jsonCtx, {
        action: "watch",
        snapshot: sampleSnapshot({
          phase: "completed",
          aspStatus: "approved",
          committedValue: "100198474",
          privacyDelayProfile: "off",
          privacyDelayConfigured: true,
        }),
      }),
    );
    expect(parseCapturedJson(watchedCompleted.stdout).warnings).toEqual([
      {
        code: "timing_delay_disabled",
        category: "privacy",
        message:
          "Privacy delay is disabled for this saved flow. Once approval is observed, flow watch will request the relayed private withdrawal immediately, which may create an off-chain timing signal.",
      },
    ]);

    const ragequit = captureOutput(() =>
      renderFlowResult(jsonCtx, {
        action: "ragequit",
        snapshot: sampleSnapshot({
          phase: "completed_public_recovery",
          aspStatus: "declined",
          committedValue: "100198474",
          privacyDelayProfile: "off",
          privacyDelayConfigured: true,
        }),
      }),
    );
    expect(parseCapturedJson(ragequit.stdout).warnings).toBeUndefined();
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
    expect(stderr).toMatch(/Phase:\s+mystery_phase/);
  });
});
