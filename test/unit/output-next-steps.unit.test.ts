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
import { renderStatus, type StatusCheckResult } from "../../src/output/status.ts";
import { renderAccounts, type AccountsRenderData } from "../../src/output/accounts.ts";
import { renderPools, type PoolsRenderData, renderPoolDetail, type PoolDetailRenderData } from "../../src/output/pools.ts";
import { renderSyncComplete, type SyncResult } from "../../src/output/sync.ts";
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

  test("command with boolean option (non-agent) uses kebab-case", () => {
    const result = formatNextActionCommand({
      command: "accounts",
      reason: "Check pending.",
      when: "has_pending",
      options: { agent: true, chain: "sepolia", pendingOnly: true },
    });
    expect(result).toBe("privacy-pools accounts --chain sepolia --pending-only");
  });

  test("boolean true camelCase option converts to kebab-case", () => {
    const result = formatNextActionCommand({
      command: "init",
      reason: "Setup.",
      when: "status_not_ready",
      options: { agent: true, showMnemonic: true },
    });
    expect(result).toBe("privacy-pools init --show-mnemonic");
  });

  test("boolean false emits --no-<kebab-flag>", () => {
    const result = formatNextActionCommand({
      command: "withdraw",
      reason: "Submit.",
      when: "after_quote",
      args: ["0.1", "ETH"],
      options: { agent: true, chain: "sepolia", to: "0xabc", extraGas: false },
    });
    expect(result).toBe("privacy-pools withdraw 0.1 ETH --chain sepolia --to 0xabc --no-extra-gas");
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

// ── Shared stubs for pools (used by both parity and JSON-only tests) ────────

const STUB_POOLS: PoolsRenderData = {
  allChains: false,
  chainName: "sepolia",
  search: null,
  sort: "tvl",
  filteredPools: [
    {
      chain: "sepolia",
      pool: {
        symbol: "ETH",
        asset: "0x" + "00".repeat(20),
        pool: "0x" + "11".repeat(20),
        scope: 1n,
        decimals: 18,
        minimumDepositAmount: 10000000000000000n,
        vettingFeeBPS: 50n,
        maxRelayFeeBPS: 100n,
        totalDepositsCount: 10,
        totalDepositsValue: 1000000000000000000n,
        acceptedDepositsValue: 900000000000000000n,
        pendingDepositsValue: 100000000000000000n,
      } as any,
    },
  ],
  warnings: [],
};

const STUB_POOL_DETAIL: PoolDetailRenderData = {
  chain: "sepolia",
  pool: {
    symbol: "ETH",
    asset: "0x" + "00".repeat(20),
    pool: "0x" + "11".repeat(20),
    scope: 1n,
    decimals: 18,
    minimumDepositAmount: 10000000000000000n,
    vettingFeeBPS: 50n,
    maxRelayFeeBPS: 100n,
  } as any,
  tokenPrice: null,
  myPoolAccounts: null,
  recentActivity: null,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function getJsonNextActionCommands(stdout: string): string[] {
  const json = JSON.parse(stdout.trim());
  return (json.nextActions ?? []).map((a: { command: string }) => a.command);
}

function stderrContainsNextSteps(stderr: string): boolean {
  return stderr.includes("Next steps:");
}

// ── Shared stubs ─────────────────────────────────────────────────────────────

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

  const STUB_STATUS: StatusCheckResult = {
    configExists: true,
    configDir: "/tmp/.privacy-pools",
    defaultChain: "sepolia",
    selectedChain: "sepolia",
    rpcUrl: "https://rpc.sepolia.example",
    rpcIsCustom: false,
    recoveryPhraseSet: true,
    signerKeySet: true,
    signerKeyValid: true,
    signerAddress: "0x" + "aa".repeat(20),
    entrypoint: "0x" + "bb".repeat(20),
    aspHost: "https://asp.example",
    accountFiles: [["sepolia", 11155111]],
  };

  const STUB_ACCOUNTS: AccountsRenderData = {
    chain: "sepolia",
    chainId: 11155111,
    groups: [
      {
        symbol: "ETH",
        poolAddress: "0x" + "11".repeat(20),
        decimals: 18,
        scope: 1n,
        tokenPrice: null,
        poolAccounts: [
          {
            paNumber: 1,
            paId: "PA-1",
            status: "spendable",
            aspStatus: "approved",
            value: 100000000000000000n,
            commitment: { hash: 1n, label: 2n },
            label: 2n,
            blockNumber: 100n,
            txHash: "0x" + "ab".repeat(32),
          } as any,
          {
            paNumber: 2,
            paId: "PA-2",
            status: "spendable",
            aspStatus: "pending",
            value: 50000000000000000n,
            commitment: { hash: 3n, label: 4n },
            label: 4n,
            blockNumber: 101n,
            txHash: "0x" + "cd".repeat(32),
          } as any,
        ],
      },
    ],
    showDetails: false,
    showAll: false,
    showSummary: false,
    showPendingOnly: false,
  };

  const STUB_SYNC: SyncResult = {
    chain: "sepolia",
    syncedPools: 2,
    syncedSymbols: ["ETH", "WETH"],
    availablePoolAccounts: 3,
    previousAvailablePoolAccounts: 1,
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

// ── Parity tests ────────────────────────────────────────────────────────────

describe("next-step parity across renderers", () => {
  // Commands where humans genuinely benefit from next-step guidance:
  // workflow inflection points with non-obvious or pre-assembled commands.
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
      name: "renderWithdrawQuote",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderWithdrawQuote(ctx, STUB_QUOTE));
      },
    },
    {
      name: "renderStatus",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderStatus(ctx, STUB_STATUS));
      },
    },
    {
      name: "renderSyncComplete",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderSyncComplete(ctx, STUB_SYNC));
      },
    },
    {
      name: "renderPools",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderPools(ctx, STUB_POOLS));
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
    });
  }
});

// ── JSON-only nextActions (human path intentionally quiet) ──────────────────
// These commands provide nextActions for agents but stay quiet for humans because
// either the next step is obvious (accounts after withdraw/ragequit) or requires
// user-supplied args (deposit after browsing pools).

describe("JSON-only nextActions (agent-only follow-ups)", () => {
  const jsonOnlyCases: Array<{ name: string; render: (json: boolean) => { stdout: string; stderr: string } }> = [
    {
      name: "renderPoolDetail",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderPoolDetail(ctx, STUB_POOL_DETAIL));
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
      name: "renderAccounts",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderAccounts(ctx, STUB_ACCOUNTS));
      },
    },
  ];

  for (const { name, render } of jsonOnlyCases) {
    test(`${name}: JSON nextActions present, human "Next steps:" absent`, () => {
      const jsonResult = render(true);
      const jsonCommands = getJsonNextActionCommands(jsonResult.stdout);
      expect(jsonCommands.length).toBeGreaterThan(0);

      const humanResult = render(false);
      expect(stderrContainsNextSteps(humanResult.stderr)).toBe(false);
    });
  }
});

// ── runnable: false on template nextActions ──────────────────────────────────
// Commands that suggest follow-ups requiring user-supplied args should mark
// them as templates so agents know they can't be executed as-is.

describe("template nextActions marked runnable: false", () => {
  function getNextActions(stdout: string) {
    const json = JSON.parse(stdout.trim());
    return json.nextActions ?? [];
  }

  test("pools → deposit is marked runnable: false", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderPools(ctx, STUB_POOLS));
    const actions = getNextActions(stdout);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].command).toBe("deposit");
    expect(actions[0].runnable).toBe(false);
  });

  test("pool detail → deposit is marked runnable: false", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderPoolDetail(ctx, STUB_POOL_DETAIL));
    const actions = getNextActions(stdout);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].command).toBe("deposit");
    expect(actions[0].runnable).toBe(false);
  });

  test("accounts → withdraw is marked runnable: false", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderAccounts(ctx, STUB_ACCOUNTS));
    const actions = getNextActions(stdout);
    const withdrawAction = actions.find((a: any) => a.command === "withdraw");
    expect(withdrawAction).toBeDefined();
    expect(withdrawAction.runnable).toBe(false);
  });

  test("fully-specified nextActions omit runnable (defaults to true)", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderInitResult(ctx, STUB_INIT));
    const actions = getNextActions(stdout);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.runnable).toBeUndefined();
    }
  });
});
