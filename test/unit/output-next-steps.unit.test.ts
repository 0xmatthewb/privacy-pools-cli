/**
 * Contract tests for the shared next-step renderer.
 *
 * Verifies:
 *   1. formatNextActionCommand produces correct CLI strings
 *   2. renderNextSteps respects isSilent (quiet / agent / json / csv)
 *   3. Human-mode output from each transactional renderer includes "Next steps:"
 *      whenever the JSON output includes nextActions (parity guarantee)
 */

import { describe, expect, test } from "bun:test";
import { createOutputContext, formatNextActionCommand, renderNextSteps } from "../../src/output/common.ts";
import { renderInitResult, type InitRenderResult } from "../../src/output/init.ts";
import { renderDepositSuccess, type DepositSuccessData } from "../../src/output/deposit.ts";
import { renderWithdrawSuccess, type WithdrawSuccessData } from "../../src/output/withdraw.ts";
import { renderRagequitSuccess, type RagequitSuccessData } from "../../src/output/ragequit.ts";
import { renderWithdrawQuote, type WithdrawQuoteData } from "../../src/output/withdraw.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { makeMode, captureOutput } from "../helpers/output.ts";

// ── formatNextActionCommand ─────────────────────────────────────────────────

describe("formatNextActionCommand", () => {
  test("basic command with no args or options", () => {
    const result = formatNextActionCommand({
      command: "status",
      reason: "Check readiness.",
      when: "after_init",
    });
    expect(result).toBe("privacy-pools status");
  });

  test("command with positional args", () => {
    const result = formatNextActionCommand({
      command: "withdraw",
      reason: "Submit withdrawal.",
      when: "after_quote",
      args: ["0.1", "ETH"],
    });
    expect(result).toBe("privacy-pools withdraw 0.1 ETH");
  });

  test("command with string options (excludes agent flag)", () => {
    const result = formatNextActionCommand({
      command: "accounts",
      reason: "Check balance.",
      when: "after_deposit",
      options: { agent: true, chain: "sepolia" },
    });
    expect(result).toBe("privacy-pools accounts --chain sepolia");
    expect(result).not.toContain("--agent");
  });

  test("command with boolean option (non-agent)", () => {
    const result = formatNextActionCommand({
      command: "accounts",
      reason: "Check pending.",
      when: "has_pending",
      options: { agent: true, chain: "sepolia", pendingOnly: true },
    });
    expect(result).toBe("privacy-pools accounts --chain sepolia --pendingOnly");
  });

  test("skips null option values", () => {
    const result = formatNextActionCommand({
      command: "withdraw",
      reason: "Withdraw.",
      when: "after_quote",
      args: ["0.1", "ETH"],
      options: { agent: true, chain: "sepolia", to: null, extraGas: null },
    });
    expect(result).toBe("privacy-pools withdraw 0.1 ETH --chain sepolia");
  });

  test("handles args and options together", () => {
    const result = formatNextActionCommand({
      command: "withdraw",
      reason: "Submit.",
      when: "after_quote",
      args: ["0.05", "WETH"],
      options: { agent: true, chain: "sepolia", to: "0xabc" },
    });
    expect(result).toBe("privacy-pools withdraw 0.05 WETH --chain sepolia --to 0xabc");
  });
});

// ── renderNextSteps suppression ─────────────────────────────────────────────

describe("renderNextSteps suppression", () => {
  const sampleActions = [
    { command: "accounts", reason: "Check balance.", when: "after_deposit", options: { agent: true, chain: "sepolia" } },
  ];

  test("emits to stderr in human mode", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderNextSteps(ctx, sampleActions));
    expect(stderr).toContain("Next steps:");
    expect(stderr).toContain("privacy-pools accounts --chain sepolia");
    expect(stderr).toContain("Check balance.");
  });

  test("suppressed in quiet mode", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stderr } = captureOutput(() => renderNextSteps(ctx, sampleActions));
    expect(stderr).toBe("");
  });

  test("suppressed in JSON mode", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stderr } = captureOutput(() => renderNextSteps(ctx, sampleActions));
    expect(stderr).toBe("");
  });

  test("suppressed in CSV mode", () => {
    const ctx = createOutputContext(makeMode({ isCsv: true }));
    const { stderr } = captureOutput(() => renderNextSteps(ctx, sampleActions));
    expect(stderr).toBe("");
  });

  test("suppressed in agent mode (json + quiet)", () => {
    const ctx = createOutputContext(makeMode({ isAgent: true, isJson: true, isQuiet: true }));
    const { stderr } = captureOutput(() => renderNextSteps(ctx, sampleActions));
    expect(stderr).toBe("");
  });

  test("no-op when nextActions is undefined", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderNextSteps(ctx, undefined));
    expect(stderr).toBe("");
  });

  test("no-op when nextActions is empty", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderNextSteps(ctx, []));
    expect(stderr).toBe("");
  });
});

// ── Parity: JSON nextActions ↔ human "Next steps:" ─────────────────────────

describe("next-step parity across renderers", () => {
  /**
   * For each renderer, verify that when JSON mode emits nextActions,
   * human mode emits "Next steps:" with a matching command string.
   */

  const STUB_INIT: InitRenderResult = {
    defaultChain: "sepolia",
    signerKeySet: true,
    mnemonicImported: false,
    showMnemonic: false,
  };

  const STUB_DEPOSIT: DepositSuccessData = {
    txHash: "0x" + "ab".repeat(32),
    amount: 100000000000000000n,
    committedValue: 90000000000000000n,
    asset: "ETH",
    chain: "sepolia",
    decimals: 18,
    poolAccountNumber: 1,
    poolAccountId: "PA-1",
    poolAddress: "0x" + "11".repeat(20),
    scope: 1n,
    label: 2n,
    blockNumber: 100n,
    explorerUrl: "https://sepolia.etherscan.io/tx/0xab",
  };

  const STUB_WITHDRAW: WithdrawSuccessData = {
    withdrawMode: "relayed",
    txHash: "0x" + "cd".repeat(32),
    blockNumber: 200n,
    amount: 50000000000000000n,
    recipient: "0x" + "22".repeat(20),
    asset: "ETH",
    chain: "sepolia",
    decimals: 18,
    poolAccountNumber: 1,
    poolAccountId: "PA-1",
    poolAddress: "0x" + "11".repeat(20),
    scope: 1n,
    explorerUrl: null,
    feeBPS: "100",
    remainingBalance: 40000000000000000n,
    tokenPrice: null,
  };

  const STUB_RAGEQUIT: RagequitSuccessData = {
    txHash: "0x" + "ef".repeat(32),
    amount: 50000000000000000n,
    asset: "ETH",
    chain: "sepolia",
    decimals: 18,
    poolAccountNumber: 1,
    poolAccountId: "PA-1",
    poolAddress: "0x" + "11".repeat(20),
    scope: 1n,
    blockNumber: 300n,
    explorerUrl: null,
  };

  const STUB_QUOTE: WithdrawQuoteData = {
    chain: "sepolia",
    asset: "ETH",
    amount: 50000000000000000n,
    decimals: 18,
    recipient: "0x" + "22".repeat(20),
    minWithdrawAmount: "10000000000000000",
    quoteFeeBPS: "100",
    feeCommitmentPresent: true,
    quoteExpiresAt: new Date(Date.now() + 60000).toISOString(),
    tokenPrice: null,
  };

  function getJsonNextActionCommands(stdout: string): string[] {
    const json = JSON.parse(stdout.trim());
    return (json.nextActions ?? []).map((a: { command: string }) => a.command);
  }

  function stderrContainsNextSteps(stderr: string): boolean {
    return stderr.includes("Next steps:");
  }

  const cases: Array<{ name: string; render: (json: boolean) => { stdout: string; stderr: string } }> = [
    {
      name: "renderInitResult",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderInitResult(ctx, STUB_INIT));
      },
    },
    {
      name: "renderDepositSuccess",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderDepositSuccess(ctx, STUB_DEPOSIT));
      },
    },
    {
      name: "renderWithdrawSuccess",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderWithdrawSuccess(ctx, STUB_WITHDRAW));
      },
    },
    {
      name: "renderRagequitSuccess",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderRagequitSuccess(ctx, STUB_RAGEQUIT));
      },
    },
    {
      name: "renderWithdrawQuote",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderWithdrawQuote(ctx, STUB_QUOTE));
      },
    },
  ];

  for (const { name, render } of cases) {
    test(`${name}: JSON nextActions present → human "Next steps:" present`, () => {
      const jsonResult = render(true);
      const jsonCommands = getJsonNextActionCommands(jsonResult.stdout);
      expect(jsonCommands.length).toBeGreaterThan(0);

      const humanResult = render(false);
      expect(stderrContainsNextSteps(humanResult.stderr)).toBe(true);

      // Each command from JSON nextActions should appear in human output
      for (const cmd of jsonCommands) {
        expect(humanResult.stderr).toContain(`privacy-pools ${cmd}`);
      }
    });
  }
});
