import { describe, expect, test } from "bun:test";
import { ERROR_CODE_REGISTRY } from "../../src/utils/error-code-registry.ts";
import {
  ERROR_RECOVERY_TABLE,
  buildErrorRecoveryNextActions,
  serializeErrorRecoveryTable,
} from "../../src/utils/error-recovery-table.ts";

const registryCodes = Object.keys(ERROR_CODE_REGISTRY).sort();

describe("error recovery table", () => {
  test("classifies every registered error code exactly once", () => {
    expect(Object.keys(ERROR_RECOVERY_TABLE).sort()).toEqual(registryCodes);

    for (const code of registryCodes) {
      expect(["actionable", "retry-only", "terminal-input"]).toContain(
        ERROR_RECOVERY_TABLE[code as keyof typeof ERROR_RECOVERY_TABLE].classification,
      );
    }
  });

  test("all actionable codes yield non-empty nextActions", () => {
    for (const [code, entry] of Object.entries(ERROR_RECOVERY_TABLE)) {
      const actions = buildErrorRecoveryNextActions(code, {
        amount: "0.0734",
        suggestedRoundAmount: "0.07",
        asset: "ETH",
        recipient: "0x0000000000000000000000000000000000000001",
        chain: "mainnet",
        submissionId: "123e4567-e89b-12d3-a456-426614174000",
        poolAccountId: "PA-1",
        workflowId: "latest",
        aspStatus: "pending",
      });

      if (entry.classification === "actionable") {
        expect(actions?.length, code).toBeGreaterThan(0);
      } else {
        expect(actions, code).toBeUndefined();
      }
    }
  });

  test("high-value recoveries expose deterministic command templates", () => {
    expect(
      buildErrorRecoveryNextActions("INPUT_NONROUND_AMOUNT", {
        command: "deposit",
        amount: "0.0734",
        suggestedRoundAmount: "0.07",
        asset: "ETH",
        chain: "mainnet",
      }),
    ).toEqual([
      expect.objectContaining({
        command: "deposit",
        args: ["0.07", "ETH"],
        cliCommand: "privacy-pools deposit 0.07 ETH --agent --chain mainnet",
      }),
      expect.objectContaining({
        command: "deposit",
        args: ["0.0734", "ETH"],
        cliCommand:
          "privacy-pools deposit 0.0734 ETH --agent --chain mainnet --allow-non-round-amounts",
      }),
    ]);

    expect(
      buildErrorRecoveryNextActions("RELAYER_BROADCAST_QUOTE_EXPIRED", {
        amount: "0.1",
        asset: "ETH",
        recipient: "0x0000000000000000000000000000000000000001",
        chain: "mainnet",
      })?.[0],
    ).toMatchObject({
      command: "withdraw quote",
      cliCommand:
        "privacy-pools withdraw quote 0.1 ETH --agent --chain mainnet --to 0x0000000000000000000000000000000000000001",
    });

    expect(
      buildErrorRecoveryNextActions("CONTRACT_INCORRECT_ASP_ROOT", {
        chain: "mainnet",
      })?.[0],
    ).toMatchObject({
      command: "sync",
      cliCommand: "privacy-pools sync --agent --chain mainnet",
    });

    expect(
      buildErrorRecoveryNextActions("CONTRACT_NULLIFIER_ALREADY_SPENT", {
        chain: "mainnet",
      })?.[0],
    ).toMatchObject({
      command: "accounts",
      cliCommand: "privacy-pools accounts --agent --chain mainnet",
    });

    expect(
      buildErrorRecoveryNextActions("RPC_BROADCAST_CONFIRMATION_TIMEOUT", {
        submissionId: "123e4567-e89b-12d3-a456-426614174000",
      })?.[0],
    ).toMatchObject({
      command: "tx-status",
      cliCommand:
        "privacy-pools tx-status 123e4567-e89b-12d3-a456-426614174000 --agent",
    });
  });

  test("account approval recovery branches on aspStatus", () => {
    expect(
      buildErrorRecoveryNextActions("ACCOUNT_NOT_APPROVED", {
        aspStatus: "pending",
        chain: "mainnet",
      })?.[0],
    ).toMatchObject({
      command: "accounts",
      options: { chain: "mainnet", pendingOnly: true },
      cliCommand: "privacy-pools accounts --agent --chain mainnet --pending-only",
    });

    expect(
      buildErrorRecoveryNextActions("ACCOUNT_NOT_APPROVED", {
        aspStatus: "declined",
        asset: "ETH",
        poolAccountId: "PA-1",
        chain: "mainnet",
      })?.[0],
    ).toMatchObject({
      command: "ragequit",
      cliCommand: "privacy-pools ragequit ETH --agent --chain mainnet --pool-account PA-1",
    });

    expect(
      buildErrorRecoveryNextActions("ACCOUNT_NOT_APPROVED", {
        aspStatus: "poa_required",
        chain: "mainnet",
      })?.[0],
    ).toMatchObject({
      command: "accounts",
      cliCommand: "privacy-pools accounts --agent --chain mainnet",
    });
  });

  test("retry-only entries carry retry policies without nextActions", () => {
    const entry = ERROR_RECOVERY_TABLE.LOCK_HELD;

    expect(entry.classification).toBe("retry-only");
    expect(entry.retry).toMatchObject({
      strategy: "fixed-backoff",
      initialDelayMs: 1000,
    });
    expect(buildErrorRecoveryNextActions("LOCK_HELD", {})).toBeUndefined();
  });

  test("serialized table is JSON-friendly and complete", () => {
    const serialized = serializeErrorRecoveryTable({
      chain: "mainnet",
      asset: "ETH",
    });

    expect(Object.keys(serialized).sort()).toEqual(registryCodes);
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
    expect(serialized.INPUT_NONROUND_AMOUNT).toMatchObject({
      classification: "actionable",
      nextActions: expect.any(Array),
    });
  });
});
