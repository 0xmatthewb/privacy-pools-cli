/**
 * Contract tests for the shared next-step renderer.
 *
 * Verifies:
 *   1. formatNextActionCommand produces correct CLI strings
 *   2. renderNextSteps respects isSilent (quiet / agent / json / csv)
 *   3. Human-mode output only renders next-step guidance where the CLI now
 *      intentionally exposes it, and browse/post-success surfaces stay quiet
 */

import { describe, expect, test } from "bun:test";
import { createOutputContext, createNextAction, formatNextActionCommand, renderNextSteps } from "../../src/output/common.ts";
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
    groups: [
      {
        chain: "sepolia",
        chainId: 11155111,
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
      name: "renderAccounts",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderAccounts(ctx, STUB_ACCOUNTS));
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

describe("surfaces without next steps stay quiet", () => {
  const cases: Array<{ name: string; render: (json: boolean) => { stdout: string; stderr: string } }> = [
    {
      name: "renderPools",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderPools(ctx, STUB_POOLS));
      },
    },
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
      name: "renderSyncComplete",
      render: (json) => {
        const ctx = createOutputContext(makeMode({ isJson: json }));
        return captureOutput(() => renderSyncComplete(ctx, STUB_SYNC));
      },
    },
  ];

  for (const { name, render } of cases) {
    test(`${name}: JSON and human output omit next-step guidance`, () => {
      const jsonResult = render(true);
      const jsonCommands = getJsonNextActionCommands(jsonResult.stdout);
      expect(jsonCommands).toHaveLength(0);

      const humanResult = render(false);
      expect(stderrContainsNextSteps(humanResult.stderr)).toBe(false);
    });
  }
});

describe("emitted nextActions are fully runnable", () => {
  function getNextActions(stdout: string) {
    const json = JSON.parse(stdout.trim());
    return json.nextActions ?? [];
  }

  test("init nextActions omit runnable", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderInitResult(ctx, STUB_INIT));
    const actions = getNextActions(stdout);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.runnable).toBeUndefined();
    }
  });

  test("accounts poll nextActions omit runnable", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderAccounts(ctx, STUB_ACCOUNTS));
    const actions = getNextActions(stdout);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].runnable).toBeUndefined();
  });

  test("deposit nextActions omit runnable", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderDepositSuccess(ctx, STUB_DEPOSIT));
    const actions = getNextActions(stdout);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].runnable).toBeUndefined();
  });
});

// ── renderNextSteps filters out runnable: false ─────────────────────────────

describe("renderNextSteps skips runnable: false actions", () => {
  test("human output omits template actions", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderNextSteps(ctx, [
        createNextAction("deposit", "Deposit.", "test", { runnable: false }),
      ]),
    );
    expect(stderrContainsNextSteps(stderr)).toBe(false);
  });

  test("human output shows runnable actions alongside templates", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderNextSteps(ctx, [
        createNextAction("accounts", "Check accounts.", "test"),
        createNextAction("deposit", "Deposit.", "test", { runnable: false }),
      ]),
    );
    expect(stderrContainsNextSteps(stderr)).toBe(true);
    expect(stderr).toContain("accounts");
    expect(stderr).not.toContain("deposit");
  });
});

// ── Status state-aware next steps ───────────────────────────────────────────

describe("status next steps vary by account state", () => {
  function getJsonNextActions(result: StatusCheckResult) {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderStatus(ctx, result));
    return JSON.parse(stdout.trim()).nextActions;
  }

  test("ready + no accounts → pools only", () => {
    const result = { ...STUB_STATUS, accountFiles: [] as [string, number][] };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("pools");
    expect(actions[0].when).toBe("status_ready_no_accounts");
  });

  test("ready + has accounts → accounts only", () => {
    const actions = getJsonNextActions(STUB_STATUS);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].when).toBe("status_ready_has_accounts");
  });

  test("unsigned-only + no accounts → pools in read-only mode", () => {
    const result = {
      ...STUB_STATUS,
      signerKeySet: false,
      signerKeyValid: false,
      signerAddress: null,
      accountFiles: [] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("pools");
    expect(actions[0].when).toBe("status_unsigned_no_accounts");
  });

  test("unsigned-only + has accounts → accounts in read-only mode", () => {
    const result = {
      ...STUB_STATUS,
      signerKeySet: false,
      signerKeyValid: false,
      signerAddress: null,
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].when).toBe("status_unsigned_has_accounts");
  });

  test("not ready → init with --default-chain (not --chain) when chain is selected", () => {
    const result = {
      ...STUB_STATUS,
      configExists: false,
      recoveryPhraseSet: false,
      signerKeySet: false,
      signerKeyValid: false,
      signerAddress: null,
      accountFiles: [] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("init");
    // init accepts --default-chain, NOT --chain (which is a global workflow flag).
    expect(actions[0].options.defaultChain).toBe("sepolia");
    expect(actions[0].options.chain).toBeUndefined();
  });
});

// ── Status chain-aware hasAccounts ──────────────────────────────────────────

describe("status chain-aware hasAccounts for next steps", () => {
  function getJsonNextActions(result: StatusCheckResult) {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderStatus(ctx, result));
    return JSON.parse(stdout.trim()).nextActions;
  }

  test("mainnet deposits + default chain → accounts in dashboard mode (no --chain)", () => {
    // User's default is mainnet, has mainnet accounts.
    // Bare `accounts` (dashboard) shows all mainnets — no --chain needed.
    const result = {
      ...STUB_STATUS,
      defaultChain: "mainnet",
      selectedChain: "mainnet",
      accountFiles: [["mainnet", 1]] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].when).toBe("status_ready_has_accounts");
    // Agent: no --chain → dashboard mode reaches the mainnet deposits.
    expect(actions[0].options?.chain).toBeUndefined();
  });

  test("cross-chain mainnet deposits + default chain → accounts in dashboard mode (no --chain)", () => {
    // User's default is mainnet, has arbitrum accounts.
    // Bare `accounts` (dashboard) shows all mainnets including arbitrum.
    const result = {
      ...STUB_STATUS,
      defaultChain: "mainnet",
      selectedChain: "mainnet",
      accountFiles: [["arbitrum", 42161]] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].when).toBe("status_ready_has_accounts");
    // No --chain: dashboard mode correctly reaches arbitrum deposits.
    expect(actions[0].options?.chain).toBeUndefined();
  });

  test("testnet-only deposits + default chain → accounts --all-chains", () => {
    // User's default is mainnet, only has sepolia deposits.
    // Bare `accounts` only shows mainnets, so sepolia deposits are invisible.
    // But they ARE reachable via `accounts --all-chains`.
    const result = {
      ...STUB_STATUS,
      defaultChain: "mainnet",
      selectedChain: "mainnet",
      accountFiles: [["sepolia", 11155111]] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].when).toBe("status_ready_has_accounts");
    expect(actions[0].options?.allChains).toBe(true);
  });

  test("accounts on different chain → pools when chain explicitly overridden", () => {
    // User overrode --chain sepolia (different from default mainnet).
    // Only accounts on the overridden chain matter for the next-step hint.
    const result = {
      ...STUB_STATUS,
      defaultChain: "mainnet",
      selectedChain: "sepolia",
      accountFiles: [["mainnet", 1]] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("pools");
    expect(actions[0].when).toBe("status_ready_no_accounts");
  });

  test("accounts on overridden chain → accounts with --chain", () => {
    // User overrode --chain arbitrum (different from default mainnet).
    // Has arbitrum deposits — suggest accounts scoped to arbitrum.
    const result = {
      ...STUB_STATUS,
      defaultChain: "mainnet",
      selectedChain: "arbitrum",
      accountFiles: [["arbitrum", 42161]] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].when).toBe("status_ready_has_accounts");
    // Chain override → agent command includes --chain to scope correctly.
    expect(actions[0].options?.chain).toBe("arbitrum");
  });

  test("testnet deposits on default testnet chain → accounts with --chain (testnet needs explicit flag)", () => {
    // Default is sepolia, deposits on sepolia. Bare `accounts` won't show
    // testnets, so the command must include --chain sepolia.
    const result = {
      ...STUB_STATUS,
      defaultChain: "sepolia",
      selectedChain: "sepolia",
      accountFiles: [["sepolia", 11155111]] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].options?.chain).toBe("sepolia");
  });

  test("mixed mainnet + testnet deposits on default testnet → accounts --all-chains", () => {
    // Default is sepolia, deposits on both sepolia and mainnet.
    // `--chain sepolia` would hide mainnet holdings; bare `accounts` would
    // hide sepolia. Only `--all-chains` surfaces everything.
    const result = {
      ...STUB_STATUS,
      defaultChain: "sepolia",
      selectedChain: "sepolia",
      accountFiles: [["sepolia", 11155111], ["mainnet", 1]] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].when).toBe("status_ready_has_accounts");
    expect(actions[0].options?.allChains).toBe(true);
    expect(actions[0].options?.chain).toBeUndefined();
  });

  test("no selectedChain + mainnet account → accounts (no --chain)", () => {
    const result = {
      ...STUB_STATUS,
      selectedChain: null,
      accountFiles: [["mainnet", 1]] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].options?.chain).toBeUndefined();
  });

  test("no selectedChain + testnet-only account → accounts --all-chains", () => {
    const result = {
      ...STUB_STATUS,
      selectedChain: null,
      defaultChain: null,
      accountFiles: [["sepolia", 11155111]] as [string, number][],
    };
    const actions = getJsonNextActions(result);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].when).toBe("status_ready_has_accounts");
    expect(actions[0].options?.allChains).toBe(true);
  });
});

// ── Status human-mode chain hints ──────────────────────────────────────────

describe("status human-mode chain hints", () => {
  function getHumanStderr(result: StatusCheckResult): string {
    const ctx = createOutputContext(makeMode({ isJson: false }));
    const { stderr } = captureOutput(() => renderStatus(ctx, result));
    return stderr;
  }

  test("default testnet → human pools hint includes --chain", () => {
    // User configured default=sepolia, has no accounts. Human next step
    // should include --chain sepolia so the command actually shows testnet pools.
    const result: StatusCheckResult = {
      ...STUB_STATUS,
      defaultChain: "sepolia",
      selectedChain: "sepolia",
      accountFiles: [] as [string, number][],
    };
    const stderr = getHumanStderr(result);
    expect(stderr).toContain("privacy-pools pools --chain sepolia");
  });

  test("default mainnet → human pools hint omits --chain", () => {
    const result: StatusCheckResult = {
      ...STUB_STATUS,
      defaultChain: "mainnet",
      selectedChain: "mainnet",
      accountFiles: [] as [string, number][],
    };
    const stderr = getHumanStderr(result);
    expect(stderr).toContain("privacy-pools pools");
    expect(stderr).not.toContain("--chain");
  });

  test("not ready + default testnet → human init uses --default-chain (not --chain)", () => {
    const result: StatusCheckResult = {
      ...STUB_STATUS,
      configExists: false,
      recoveryPhraseSet: false,
      signerKeySet: false,
      signerKeyValid: false,
      signerAddress: null,
      accountFiles: [] as [string, number][],
    };
    const stderr = getHumanStderr(result);
    expect(stderr).toContain("privacy-pools init --default-chain sepolia");
    expect(stderr).not.toContain("init --chain");
  });
});

// ── Init new-wallet vs restore path ─────────────────────────────────────────

describe("init next steps: new wallet vs restore", () => {
  function getJsonNextActions(data: InitRenderResult) {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderInitResult(ctx, data));
    return JSON.parse(stdout.trim()).nextActions;
  }

  function getHumanStderr(data: InitRenderResult): string {
    const ctx = createOutputContext(makeMode({ isJson: false }));
    const { stderr } = captureOutput(() => renderInitResult(ctx, data));
    return stderr;
  }

  test("new wallet → agent gets status, human gets pools", () => {
    const actions = getJsonNextActions(STUB_INIT);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("status");

    const stderr = getHumanStderr(STUB_INIT);
    expect(stderr).toContain("privacy-pools pools");
    expect(stderr).not.toContain("privacy-pools accounts");
  });

  test("restore (imported mnemonic) → agent gets accounts, human gets accounts", () => {
    const restored = { ...STUB_INIT, mnemonicImported: true };
    const actions = getJsonNextActions(restored);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("accounts");
    expect(actions[0].when).toBe("after_restore");

    const stderr = getHumanStderr(restored);
    expect(stderr).toContain("privacy-pools accounts");
    expect(stderr).not.toContain("privacy-pools pools");
  });

  test("restore on testnet → both agent and human use --all-chains (broadest sync)", () => {
    const restored: InitRenderResult = {
      ...STUB_INIT,
      mnemonicImported: true,
      defaultChain: "sepolia",
    };
    const actions = getJsonNextActions(restored);
    expect(actions[0].command).toBe("accounts");
    // Restore always uses --all-chains regardless of defaultChain,
    // because we don't know which chains hold recoverable state.
    expect(actions[0].options?.allChains).toBe(true);
    expect(actions[0].options?.chain).toBeUndefined();

    const stderr = getHumanStderr(restored);
    expect(stderr).toContain("privacy-pools accounts --all-chains");
  });

  test("restore on mainnet → both agent and human use --all-chains (broadest sync)", () => {
    const restored: InitRenderResult = {
      ...STUB_INIT,
      mnemonicImported: true,
      defaultChain: "mainnet",
    };
    const actions = getJsonNextActions(restored);
    expect(actions[0].command).toBe("accounts");
    // Restore always uses --all-chains so testnet-only wallets see their funds too.
    expect(actions[0].options?.allChains).toBe(true);
    expect(actions[0].options?.chain).toBeUndefined();

    const stderr = getHumanStderr(restored);
    expect(stderr).toContain("privacy-pools accounts --all-chains");
  });

  test("new wallet on testnet → human pools hint includes --chain", () => {
    const testnet = { ...STUB_INIT, defaultChain: "sepolia" };
    const stderr = getHumanStderr(testnet);
    expect(stderr).toContain("privacy-pools pools --chain sepolia");
  });
});

// ── Withdraw quote recipient guard ─────────────────────────────────────────

describe("withdraw quote next-step recipient guard", () => {
  function getJsonNextActions(data: WithdrawQuoteData) {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderWithdrawQuote(ctx, data));
    return JSON.parse(stdout.trim()).nextActions;
  }

  function getHumanStderr(data: WithdrawQuoteData): string {
    const ctx = createOutputContext(makeMode({ isJson: false }));
    const { stderr } = captureOutput(() => renderWithdrawQuote(ctx, data));
    return stderr;
  }

  const BASE_QUOTE: WithdrawQuoteData = {
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

  test("with recipient → agent action includes --to and is runnable", () => {
    const actions = getJsonNextActions(BASE_QUOTE);
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("withdraw");
    expect(actions[0].options.to).toBe(BASE_QUOTE.recipient);
    expect(actions[0].runnable).not.toBe(false);
  });

  test("null recipient → agent action omits --to and is not runnable", () => {
    const actions = getJsonNextActions({ ...BASE_QUOTE, recipient: null });
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("withdraw");
    expect(actions[0].options.to).toBeUndefined();
    expect(actions[0].runnable).toBe(false);
  });

  test("null recipient → human output hides the withdraw next step", () => {
    const stderr = getHumanStderr({ ...BASE_QUOTE, recipient: null });
    expect(stderr).not.toContain("privacy-pools withdraw");
  });

  test("with recipient → human output shows the withdraw next step", () => {
    const stderr = getHumanStderr(BASE_QUOTE);
    expect(stderr).toContain("privacy-pools withdraw");
    expect(stderr).toContain("--to");
  });
});
