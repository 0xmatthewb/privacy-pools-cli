import { describe, expect, test } from "bun:test";
import { renderBroadcast, type BroadcastRenderData } from "../../src/output/broadcast.ts";
import { renderDepositSuccess, type DepositSuccessData } from "../../src/output/deposit.ts";
import { renderRagequitSuccess, type RagequitSuccessData } from "../../src/output/ragequit.ts";
import { renderTxStatus } from "../../src/output/tx-status.ts";
import { createOutputContext } from "../../src/output/common.ts";
import { renderWithdrawSuccess, type WithdrawSuccessData } from "../../src/output/withdraw.ts";
import type { SubmissionRecord } from "../../src/services/submissions.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { makeMode, captureOutput, parseCapturedJson } from "../helpers/output.ts";

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

const SUBMITTED_DEPOSIT: DepositSuccessData = {
  status: "submitted",
  submissionId: "sub-deposit-1",
  workflowId: "wf-deposit-review",
  txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
  amount: 100000000000000000n,
  committedValue: 99500000000000000n,
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  poolAddress: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  label: 789n,
  blockNumber: null,
  explorerUrl: "https://sepolia.etherscan.io/tx/0xaabb",
};

const SUBMITTED_WITHDRAW: WithdrawSuccessData = {
  status: "submitted",
  submissionId: "sub-withdraw-1",
  withdrawMode: "relayed",
  txHash: "0x1122334455667788990011223344556677889900112233445566778899001122",
  blockNumber: null,
  amount: 500000000000000000n,
  recipient: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  poolAccountNumber: 2,
  poolAccountId: "PA-2",
  poolAddress: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  explorerUrl: "https://sepolia.etherscan.io/tx/0x1122",
  feeBPS: "50",
  remainingBalance: 500000000000000000n,
};

const SUBMITTED_RAGEQUIT: RagequitSuccessData = {
  status: "submitted",
  submissionId: "sub-ragequit-1",
  txHash: "0x2233445566778899001122334455667788990011223344556677889900112233",
  amount: 500000000000000000n,
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  poolAccountNumber: 2,
  poolAccountId: "PA-2",
  poolAddress: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  blockNumber: null,
  explorerUrl: "https://sepolia.etherscan.io/tx/0x2233",
  destinationAddress: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
};

const SUBMITTED_BROADCAST: BroadcastRenderData = {
  mode: "broadcast",
  broadcastMode: "onchain",
  sourceOperation: "deposit",
  chain: "sepolia",
  submissionId: "sub-broadcast-1",
  transactions: [
    {
      index: 0,
      description: "Deposit ETH into Privacy Pool",
      txHash: "0x3344556677889900112233445566778899001122334455667788990011223344",
      blockNumber: null,
      explorerUrl: "https://sepolia.etherscan.io/tx/0x3344",
      status: "submitted",
    },
  ],
  localStateUpdated: false,
};

const SUBMITTED_RECORD: SubmissionRecord = {
  schemaVersion: "1",
  submissionId: "sub-status-1",
  createdAt: "2026-04-18T12:00:00.000Z",
  updatedAt: "2026-04-18T12:05:00.000Z",
  operation: "withdraw",
  sourceCommand: "withdraw",
  chain: "sepolia",
  asset: "ETH",
  poolAccountId: "PA-2",
  poolAccountNumber: 2,
  workflowId: null,
  recipient: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  status: "submitted",
  transactions: [
    {
      index: 0,
      description: "Relayed withdrawal",
      txHash: "0x4455667788990011223344556677889900112233445566778899001122334455",
      explorerUrl: "https://sepolia.etherscan.io/tx/0x4455",
      blockNumber: null,
      status: "submitted",
    },
  ],
  reconciliationRequired: false,
  localStateSynced: false,
  warningCode: null,
  lastError: null,
};

const CONFIRMED_DEPOSIT_RECORD: SubmissionRecord = {
  ...SUBMITTED_RECORD,
  submissionId: "sub-status-2",
  operation: "deposit",
  sourceCommand: "deposit",
  workflowId: "wf-deposit-review",
  status: "confirmed",
  localStateSynced: true,
  transactions: [
    {
      index: 0,
      description: "Deposit ETH into Privacy Pool",
      txHash: "0x5566778899001122334455667788990011223344556677889900112233445566",
      explorerUrl: "https://sepolia.etherscan.io/tx/0x5566",
      blockNumber: "12345",
      status: "confirmed",
    },
  ],
};

describe("submitted transactional renderers", () => {
  test("deposit JSON includes submission handles and async nextActions", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderDepositSuccess(ctx, SUBMITTED_DEPOSIT),
    );

    const json = parseCapturedJson(stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("deposit");
    expect(json.status).toBe("submitted");
    expect(json.submissionId).toBe("sub-deposit-1");
    expect(json.workflowId).toBe("wf-deposit-review");
    expect(json.blockNumber).toBeNull();
    expect(json.nextActions).toBeArrayOfSize(2);
    expectNextAction(
      json.nextActions[0],
      {
        command: "tx-status",
        when: "after_submit",
        args: ["sub-deposit-1"],
      },
      "privacy-pools tx-status sub-deposit-1 --agent",
    );
    expectNextAction(
      json.nextActions[1],
      {
        command: "flow status",
        when: "after_submit",
        args: ["wf-deposit-review"],
      },
      "privacy-pools flow status wf-deposit-review --agent",
    );
    expect(stderr).toBe("");
  });

  test("withdraw JSON includes submitted status and tx-status follow-up", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderWithdrawSuccess(ctx, SUBMITTED_WITHDRAW),
    );

    const json = parseCapturedJson(stdout);
    expect(json.status).toBe("submitted");
    expect(json.submissionId).toBe("sub-withdraw-1");
    expect(json.blockNumber).toBeNull();
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "tx-status",
        when: "after_submit",
        args: ["sub-withdraw-1"],
      },
      "privacy-pools tx-status sub-withdraw-1 --agent",
    );
  });

  test("ragequit JSON includes submitted status and tx-status follow-up", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderRagequitSuccess(ctx, SUBMITTED_RAGEQUIT),
    );

    const json = parseCapturedJson(stdout);
    expect(json.status).toBe("submitted");
    expect(json.submissionId).toBe("sub-ragequit-1");
    expect(json.blockNumber).toBeNull();
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "tx-status",
        when: "after_submit",
        args: ["sub-ragequit-1"],
      },
      "privacy-pools tx-status sub-ragequit-1 --agent",
    );
  });

  test("broadcast JSON includes submitted transaction status and tx-status follow-up", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderBroadcast(ctx, SUBMITTED_BROADCAST),
    );

    const json = parseCapturedJson(stdout);
    expect(json.mode).toBe("broadcast");
    expect(json.submissionId).toBe("sub-broadcast-1");
    expect(json.transactions[0]?.status).toBe("submitted");
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "tx-status",
        when: "after_submit",
        args: ["sub-broadcast-1"],
      },
      "privacy-pools tx-status sub-broadcast-1 --agent",
    );
  });
});

describe("tx-status renderer", () => {
  test("JSON mode keeps submitted polling contract stable", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderTxStatus(ctx, SUBMITTED_RECORD),
    );

    const json = parseCapturedJson(stdout);
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("tx-status");
    expect(json.submissionId).toBe("sub-status-1");
    expect(json.sourceOperation).toBe("withdraw");
    expect(json.status).toBe("submitted");
    expect(json.transactions).toBeArrayOfSize(1);
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "tx-status",
        when: "after_submit",
        args: ["sub-status-1"],
      },
      "privacy-pools tx-status sub-status-1 --agent",
    );
    expect(stderr).toBe("");
  });

  test("JSON mode routes confirmed deposit submissions back to flow status", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderTxStatus(ctx, CONFIRMED_DEPOSIT_RECORD),
    );

    const json = parseCapturedJson(stdout);
    expect(json.status).toBe("confirmed");
    expect(json.workflowId).toBe("wf-deposit-review");
    expect(json.nextActions).toBeArrayOfSize(1);
    expectNextAction(
      json.nextActions[0],
      {
        command: "flow status",
        when: "after_deposit",
        args: ["wf-deposit-review"],
      },
      "privacy-pools flow status wf-deposit-review --agent",
    );
  });

  test("human mode explains submitted polling path", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderTxStatus(ctx, SUBMITTED_RECORD),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Submission sub-status-1 is still waiting for confirmation.");
    expect(stderr).toContain("Next steps:");
    expect(stderr).toContain("privacy-pools tx-status sub-status-1");
  });
});
