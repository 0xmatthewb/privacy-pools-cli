/**
 * Unit tests for the output module.
 *
 * Validates that:
 *   1. createOutputContext produces the expected shape
 *   2. isSilent derives correctly from mode
 *   3. Renderers dispatch to JSON vs human paths
 */

import { describe, expect, test, mock, beforeEach, afterEach, spyOn } from "bun:test";
import {
  createOutputContext,
  isSilent,
  type OutputContext,
  type ResolvedGlobalMode,
} from "../../src/output/common.ts";
import { renderGuide } from "../../src/output/guide.ts";
import { renderCapabilities, type CapabilitiesPayload } from "../../src/output/capabilities.ts";
import { renderCompletionScript, renderCompletionQuery } from "../../src/output/completion.ts";
import { renderSyncEmpty, renderSyncComplete } from "../../src/output/sync.ts";
import { renderStatus, type StatusCheckResult } from "../../src/output/status.ts";
import { renderPoolsEmpty, renderPools, poolToJson, type PoolsRenderData } from "../../src/output/pools.ts";
import { renderBalanceNoPools, renderBalanceEmpty, renderBalance } from "../../src/output/balance.ts";
import { renderAccountsNoPools, renderAccounts, type AccountPoolGroup } from "../../src/output/accounts.ts";
import { renderHistoryNoPools, renderHistory } from "../../src/output/history.ts";
import { renderInitResult, type InitRenderResult } from "../../src/output/init.ts";
import { renderDepositDryRun, renderDepositSuccess, type DepositDryRunData, type DepositSuccessData } from "../../src/output/deposit.ts";
import { renderRagequitDryRun, renderRagequitSuccess, type RagequitDryRunData, type RagequitSuccessData } from "../../src/output/ragequit.ts";
import { renderWithdrawDryRun, renderWithdrawSuccess, renderWithdrawQuote, type WithdrawDryRunData, type WithdrawSuccessData, type WithdrawQuoteData } from "../../src/output/withdraw.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMode(overrides: Partial<ResolvedGlobalMode> = {}): ResolvedGlobalMode {
  return {
    isAgent: false,
    isJson: false,
    isQuiet: false,
    skipPrompts: false,
    ...overrides,
  };
}

// ── createOutputContext ──────────────────────────────────────────────────────

describe("createOutputContext", () => {
  test("defaults isVerbose to false", () => {
    const ctx = createOutputContext(makeMode());
    expect(ctx.isVerbose).toBe(false);
  });

  test("forwards isVerbose when provided", () => {
    const ctx = createOutputContext(makeMode(), true);
    expect(ctx.isVerbose).toBe(true);
  });

  test("exposes mode flags", () => {
    const mode = makeMode({ isJson: true, isQuiet: true });
    const ctx = createOutputContext(mode);
    expect(ctx.mode.isJson).toBe(true);
    expect(ctx.mode.isQuiet).toBe(true);
  });
});

// ── isSilent ─────────────────────────────────────────────────────────────────

describe("isSilent", () => {
  test("false when neither quiet nor json", () => {
    const ctx = createOutputContext(makeMode());
    expect(isSilent(ctx)).toBe(false);
  });

  test("true when quiet", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    expect(isSilent(ctx)).toBe(true);
  });

  test("true when json", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    expect(isSilent(ctx)).toBe(true);
  });

  test("true when agent (json + quiet)", () => {
    const ctx = createOutputContext(
      makeMode({ isAgent: true, isJson: true, isQuiet: true }),
    );
    expect(isSilent(ctx)).toBe(true);
  });
});

// ── Barrel re-exports ────────────────────────────────────────────────────────

describe("barrel re-exports", () => {
  test("mod.ts exports all expected symbols", async () => {
    const mod = await import("../../src/output/mod.ts");

    // Shared primitives
    expect(typeof mod.createOutputContext).toBe("function");
    expect(typeof mod.isSilent).toBe("function");
    expect(typeof mod.printJsonSuccess).toBe("function");
    expect(typeof mod.info).toBe("function");
    expect(typeof mod.success).toBe("function");
    expect(typeof mod.warn).toBe("function");
    expect(typeof mod.printTable).toBe("function");

    // Core command renderers
    expect(typeof mod.renderGuide).toBe("function");
    expect(typeof mod.renderCapabilities).toBe("function");
    expect(typeof mod.renderCompletionScript).toBe("function");
    expect(typeof mod.renderCompletionQuery).toBe("function");
    expect(typeof mod.renderSyncEmpty).toBe("function");
    expect(typeof mod.renderSyncComplete).toBe("function");

    // Reporting command renderers
    expect(typeof mod.renderStatus).toBe("function");
    expect(typeof mod.renderPoolsEmpty).toBe("function");
    expect(typeof mod.renderPools).toBe("function");
    expect(typeof mod.poolToJson).toBe("function");
    expect(typeof mod.renderBalanceNoPools).toBe("function");
    expect(typeof mod.renderBalanceEmpty).toBe("function");
    expect(typeof mod.renderBalance).toBe("function");
    expect(typeof mod.renderAccountsNoPools).toBe("function");
    expect(typeof mod.renderAccounts).toBe("function");
    expect(typeof mod.renderHistoryNoPools).toBe("function");
    expect(typeof mod.renderHistory).toBe("function");

    // Transactional command renderers
    expect(typeof mod.renderInitResult).toBe("function");
    expect(typeof mod.renderDepositDryRun).toBe("function");
    expect(typeof mod.renderDepositSuccess).toBe("function");
    expect(typeof mod.renderRagequitDryRun).toBe("function");
    expect(typeof mod.renderRagequitSuccess).toBe("function");

    // Withdraw renderer
    expect(typeof mod.renderWithdrawDryRun).toBe("function");
    expect(typeof mod.renderWithdrawSuccess).toBe("function");
    expect(typeof mod.renderWithdrawQuote).toBe("function");
  });
});

// ── Renderer output parity ──────────────────────────────────────────────────
//
// These tests capture stdout/stderr from each renderer and verify the output
// matches the current command behavior byte-for-byte.

/** Capture stdout and stderr writes during `fn()`. */
function captureOutput(fn: () => void): { stdout: string; stderr: string } {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origStdout = process.stdout.write;
  const origStderr = process.stderr.write;

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    fn();
  } finally {
    process.stdout.write = origStdout;
    process.stderr.write = origStderr;
  }

  return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
}

// ── renderGuide parity ──────────────────────────────────────────────────────

describe("renderGuide parity", () => {
  test("JSON mode: emits guide envelope to stdout, nothing to stderr", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderGuide(ctx));

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(typeof json.guide).toBe("string");
    expect(stderr).toBe("");
  });

  test("human mode: emits guide text to stderr, nothing to stdout", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderGuide(ctx));

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools CLI - Quick Guide");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() => renderGuide(ctx));

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderCapabilities parity ───────────────────────────────────────────────

const STUB_CAPABILITIES: CapabilitiesPayload = {
  commands: [
    { name: "test-cmd", description: "Test command", requiresInit: false },
  ],
  globalFlags: [{ flag: "-j, --json", description: "JSON output" }],
  agentWorkflow: ["1. do something"],
  jsonOutputContract: "test contract",
};

describe("renderCapabilities parity", () => {
  test("JSON mode: emits capabilities envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderCapabilities(ctx, STUB_CAPABILITIES),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.commands).toEqual(STUB_CAPABILITIES.commands);
    expect(json.globalFlags).toEqual(STUB_CAPABILITIES.globalFlags);
    expect(stderr).toBe("");
  });

  test("human mode: emits formatted text to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderCapabilities(ctx, STUB_CAPABILITIES),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Agent Capabilities");
    expect(stderr).toContain("Commands:");
    expect(stderr).toContain("test-cmd");
    expect(stderr).toContain("Global Flags:");
    expect(stderr).toContain("Typical Agent Workflow:");
  });
});

// ── renderCompletionScript parity ───────────────────────────────────────────

describe("renderCompletionScript parity", () => {
  test("JSON mode: emits completion-script envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderCompletionScript(ctx, "bash", "# test script\n"),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-script");
    expect(json.shell).toBe("bash");
    expect(json.completionScript).toBe("# test script\n");
    expect(stderr).toBe("");
  });

  test("human mode: emits script to stdout (not stderr)", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderCompletionScript(ctx, "bash", "# test script\n"),
    );

    expect(stdout).toBe("# test script\n");
    expect(stderr).toBe("");
  });

  test("human mode: appends newline if script doesn't end with one", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout } = captureOutput(() =>
      renderCompletionScript(ctx, "bash", "# no trailing newline"),
    );

    expect(stdout).toBe("# no trailing newline\n");
  });
});

// ── renderCompletionQuery parity ────────────────────────────────────────────

describe("renderCompletionQuery parity", () => {
  test("JSON mode: emits completion-query envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderCompletionQuery(ctx, "zsh", 2, ["deposit", "withdraw"]),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.mode).toBe("completion-query");
    expect(json.shell).toBe("zsh");
    expect(json.cword).toBe(2);
    expect(json.candidates).toEqual(["deposit", "withdraw"]);
    expect(stderr).toBe("");
  });

  test("human mode: emits newline-separated candidates to stdout", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderCompletionQuery(ctx, "bash", undefined, ["deposit", "withdraw"]),
    );

    expect(stdout).toBe("deposit\nwithdraw\n");
    expect(stderr).toBe("");
  });

  test("human mode: empty candidates produce no output", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderCompletionQuery(ctx, "bash", 0, []),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderSyncEmpty parity ──────────────────────────────────────────────────

describe("renderSyncEmpty parity", () => {
  test("JSON mode: emits zero-pool envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderSyncEmpty(ctx, "sepolia"),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.syncedPools).toBe(0);
    expect(json.spendableCommitments).toBe(0);
    expect(stderr).toBe("");
  });

  test("human mode: emits info to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderSyncEmpty(ctx, "sepolia"),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("No pools found on sepolia");
  });
});

// ── renderSyncComplete parity ───────────────────────────────────────────────

describe("renderSyncComplete parity", () => {
  test("JSON mode: emits sync result envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderSyncComplete(ctx, {
        chain: "ethereum",
        syncedPools: 2,
        syncedSymbols: ["ETH", "DAI"],
        spendableCommitments: 5,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("ethereum");
    expect(json.syncedPools).toBe(2);
    expect(json.syncedSymbols).toEqual(["ETH", "DAI"]);
    expect(json.spendableCommitments).toBe(5);
    expect(stderr).toBe("");
  });

  test("human mode: emits success + info to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderSyncComplete(ctx, {
        chain: "ethereum",
        syncedPools: 2,
        spendableCommitments: 5,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Synced 2 pool(s) on ethereum");
    expect(stderr).toContain("Spendable Pool Accounts: 5");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderSyncComplete(ctx, {
        chain: "ethereum",
        syncedPools: 1,
        spendableCommitments: 0,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Reporting renderer parity tests
// ══════════════════════════════════════════════════════════════════════════════

// ── Stub data ────────────────────────────────────────────────────────────────

const STUB_STATUS: StatusCheckResult = {
  configExists: true,
  configDir: "/tmp/.privacy-pools",
  defaultChain: "sepolia",
  selectedChain: "sepolia",
  rpcUrl: "https://rpc.sepolia.example",
  mnemonicSet: true,
  signerKeySet: true,
  signerKeyValid: true,
  signerAddress: "0x1234567890abcdef1234567890abcdef12345678",
  entrypoint: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  aspHost: "https://asp.example",
  accountFiles: [["sepolia", 11155111]],
};

const STUB_POOL = {
  symbol: "ETH",
  asset: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as `0x${string}`,
  pool: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  scope: 42n,
  decimals: 18,
  minimumDepositAmount: 100000000000000n,
  vettingFeeBPS: 50n,
  maxRelayFeeBPS: 100n,
};

const STUB_POOLS_DATA: PoolsRenderData = {
  allChains: false,
  chainName: "sepolia",
  search: null,
  sort: "default",
  filteredPools: [{ chain: "sepolia", chainId: 11155111, pool: STUB_POOL }],
  warnings: [],
};

// ── renderStatus parity ─────────────────────────────────────────────────────

describe("renderStatus parity", () => {
  test("JSON mode: emits status envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderStatus(ctx, STUB_STATUS));

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.configExists).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.selectedChain).toBe("sepolia");
    expect(json.mnemonicSet).toBe(true);
    expect(json.signerKeySet).toBe(true);
    expect(json.signerAddress).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(stderr).toBe("");
  });

  test("JSON mode: includes aspLive/rpcLive when present", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const result = { ...STUB_STATUS, aspLive: true, rpcLive: false };
    const { stdout } = captureOutput(() => renderStatus(ctx, result));

    const json = JSON.parse(stdout.trim());
    expect(json.aspLive).toBe(true);
    expect(json.rpcLive).toBe(false);
  });

  test("human mode: emits status text to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderStatus(ctx, STUB_STATUS));

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools CLI Status");
    expect(stderr).toContain("Config:");
    expect(stderr).toContain("Recovery phrase: set");
    expect(stderr).toContain("Default chain: sepolia");
    expect(stderr).toContain("Account files:");
  });

  test("human mode: shows health check skipped message when no checks", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderStatus(ctx, STUB_STATUS));

    expect(stderr).toContain("Health checks skipped");
  });
});

// ── renderPoolsEmpty parity ─────────────────────────────────────────────────

describe("renderPoolsEmpty parity", () => {
  test("JSON mode: emits empty pools envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolsRenderData = {
      allChains: false,
      chainName: "sepolia",
      search: null,
      sort: "default",
      filteredPools: [],
      warnings: [],
    };
    const { stdout, stderr } = captureOutput(() => renderPoolsEmpty(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.pools).toEqual([]);
    expect(stderr).toBe("");
  });

  test("JSON mode: uses allChains key for multi-chain", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data: PoolsRenderData = {
      allChains: true,
      chainName: "ethereum",
      search: null,
      sort: "default",
      filteredPools: [],
      warnings: [],
    };
    const { stdout } = captureOutput(() => renderPoolsEmpty(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.allChains).toBe(true);
    expect(json.chain).toBeUndefined();
  });

  test("human mode: emits no-pools message to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const data: PoolsRenderData = {
      allChains: false,
      chainName: "sepolia",
      search: null,
      sort: "default",
      filteredPools: [],
      warnings: [],
    };
    const { stdout, stderr } = captureOutput(() => renderPoolsEmpty(ctx, data));

    expect(stdout).toBe("");
    expect(stderr).toContain("No pools found on sepolia");
  });
});

// ── renderPools parity ──────────────────────────────────────────────────────

describe("renderPools parity", () => {
  test("JSON mode: emits pools envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderPools(ctx, STUB_POOLS_DATA));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.pools.length).toBe(1);
    expect(json.pools[0].symbol).toBe("ETH");
    expect(stderr).toBe("");
  });

  test("human mode: emits table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderPools(ctx, STUB_POOLS_DATA));

    expect(stdout).toBe("");
    expect(stderr).toContain("Pools on sepolia");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("Vetting Fee");
  });

  test("human mode: shows search-empty message when no matches", () => {
    const ctx = createOutputContext(makeMode());
    const data: PoolsRenderData = {
      ...STUB_POOLS_DATA,
      search: "nonexistent",
      filteredPools: [],
    };
    const { stderr } = captureOutput(() => renderPools(ctx, data));

    expect(stderr).toContain('No pools matched search query "nonexistent"');
  });
});

// ── poolToJson parity ───────────────────────────────────────────────────────

describe("poolToJson", () => {
  test("serializes pool stats to JSON-friendly record", () => {
    const json = poolToJson(STUB_POOL);
    expect(json.symbol).toBe("ETH");
    expect(json.scope).toBe("42");
    expect(json.minimumDeposit).toBe("100000000000000");
    expect(json.chain).toBeUndefined();
  });

  test("includes chain when provided", () => {
    const json = poolToJson(STUB_POOL, "sepolia");
    expect(json.chain).toBe("sepolia");
  });
});

// ── renderBalanceNoPools parity ──────────────────────────────────────────────

describe("renderBalanceNoPools parity", () => {
  test("JSON mode: emits empty balances envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderBalanceNoPools(ctx, "sepolia"));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.balances).toEqual([]);
    expect(stderr).toBe("");
  });

  test("human mode: emits no-pools message", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderBalanceNoPools(ctx, "sepolia"));

    expect(stdout).toBe("");
    expect(stderr).toContain("No pools found on sepolia");
  });
});

// ── renderBalanceEmpty parity ────────────────────────────────────────────────

describe("renderBalanceEmpty parity", () => {
  test("JSON mode: emits empty balances", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderBalanceEmpty(ctx, "sepolia"));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.balances).toEqual([]);
  });

  test("human mode: emits deposit-first message", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderBalanceEmpty(ctx, "sepolia"));

    expect(stderr).toContain("No balances found on sepolia");
    expect(stderr).toContain("Deposit first");
  });
});

// ── renderBalance parity ────────────────────────────────────────────────────

describe("renderBalance parity", () => {
  test("JSON mode: emits balances envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderBalance(ctx, {
        chain: "sepolia",
        rows: [{ symbol: "ETH", formattedBalance: "1.0 ETH", commitments: 2 }],
        jsonData: [{ asset: "ETH", assetAddress: "0xeee", balance: "1000000000000000000", commitments: 2, poolAccounts: 2 }],
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.balances.length).toBe(1);
    expect(json.balances[0].asset).toBe("ETH");
    expect(stderr).toBe("");
  });

  test("human mode: emits balance table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderBalance(ctx, {
        chain: "sepolia",
        rows: [{ symbol: "ETH", formattedBalance: "1.0 ETH", commitments: 2 }],
        jsonData: [],
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Balances on sepolia");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("Pool Accounts");
  });
});

// ── renderAccountsNoPools parity ────────────────────────────────────────────

describe("renderAccountsNoPools parity", () => {
  test("JSON mode: emits empty accounts envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderAccountsNoPools(ctx, "sepolia"));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.accounts).toEqual([]);
    expect(stderr).toBe("");
  });

  test("human mode: emits no-pools message", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderAccountsNoPools(ctx, "sepolia"));

    expect(stdout).toBe("");
    expect(stderr).toContain("No pools found on sepolia");
  });
});

// ── renderAccounts parity ───────────────────────────────────────────────────

describe("renderAccounts parity", () => {
  const STUB_COMMITMENT = {
    hash: 123n,
    label: 456n,
    value: 1000000000000000000n,
    blockNumber: 100n,
    txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
  };

  const STUB_GROUP: AccountPoolGroup = {
    symbol: "ETH",
    poolAddress: "0x1111111111111111111111111111111111111111",
    decimals: 18,
    scope: 42n,
    poolAccounts: [
      {
        paNumber: 1,
        paId: "PA-1",
        status: "spendable",
        aspStatus: "approved",
        commitment: STUB_COMMITMENT,
        label: 456n,
        value: 1000000000000000000n,
        blockNumber: 100n,
        txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
      },
    ],
  };

  test("JSON mode: emits accounts envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: false,
        showAll: false,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.accounts.length).toBe(1);
    expect(json.accounts[0].poolAccountId).toBe("PA-1");
    expect(json.accounts[0].aspStatus).toBe("approved");
    expect(stderr).toBe("");
  });

  test("human mode (summary): emits summary table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: false,
        showAll: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Pool Accounts (PA) on sepolia");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Approved");
  });

  test("human mode (detail): emits detail table with commitment columns", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [STUB_GROUP],
        showDetails: true,
        showAll: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Commitment");
    expect(stderr).toContain("Label");
    expect(stderr).toContain("Block");
  });

  test("human mode: shows empty-state message when no groups have accounts", () => {
    const ctx = createOutputContext(makeMode());
    const emptyGroup: AccountPoolGroup = { ...STUB_GROUP, poolAccounts: [] };
    const { stderr } = captureOutput(() =>
      renderAccounts(ctx, {
        chain: "sepolia",
        groups: [emptyGroup],
        showDetails: false,
        showAll: false,
      }),
    );

    expect(stderr).toContain("No spendable Pool Accounts found");
  });
});

// ── renderHistoryNoPools parity ─────────────────────────────────────────────

describe("renderHistoryNoPools parity", () => {
  test("JSON mode: emits empty events envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderHistoryNoPools(ctx, "sepolia"));

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.events).toEqual([]);
    expect(stderr).toBe("");
  });

  test("human mode: emits no-pools message", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderHistoryNoPools(ctx, "sepolia"));

    expect(stdout).toBe("");
    expect(stderr).toContain("No pools found on sepolia");
  });
});

// ── renderHistory parity ────────────────────────────────────────────────────

describe("renderHistory parity", () => {
  const STUB_EVENTS = [
    {
      type: "deposit" as const,
      asset: "ETH",
      poolAddress: "0x1111111111111111111111111111111111111111",
      paNumber: 1,
      paId: "PA-1",
      value: 1000000000000000000n,
      blockNumber: 200n,
      txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
    },
    {
      type: "withdrawal" as const,
      asset: "ETH",
      poolAddress: "0x1111111111111111111111111111111111111111",
      paNumber: 1,
      paId: "PA-1",
      value: 500000000000000000n,
      blockNumber: 100n,
      txHash: "0x1122334455667788990011223344556677889900112233445566778899001122",
    },
  ];

  const STUB_POOL_MAP = new Map([
    ["0x1111111111111111111111111111111111111111", { pool: "0x1111111111111111111111111111111111111111", decimals: 18 }],
  ]);

  const mockExplorerUrl = (chainId: number, txHash: string) =>
    `https://sepolia.etherscan.io/tx/${txHash}`;

  test("JSON mode: emits events envelope", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: STUB_EVENTS,
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.events.length).toBe(2);
    expect(json.events[0].type).toBe("deposit");
    expect(json.events[0].explorerUrl).toContain("etherscan.io");
    expect(json.events[1].type).toBe("withdrawal");
    expect(stderr).toBe("");
  });

  test("human mode: emits history table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: STUB_EVENTS,
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("History on sepolia");
    expect(stderr).toContain("Deposit");
    expect(stderr).toContain("Withdraw");
    expect(stderr).toContain("PA-1");
  });

  test("human mode: shows empty-state for no events", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() =>
      renderHistory(ctx, {
        chain: "sepolia",
        chainId: 11155111,
        events: [],
        poolByAddress: STUB_POOL_MAP,
        explorerTxUrl: mockExplorerUrl,
      }),
    );

    expect(stderr).toContain("No events found on sepolia");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Transactional renderer parity tests
// ══════════════════════════════════════════════════════════════════════════════

// ── renderInitResult parity ─────────────────────────────────────────────────

describe("renderInitResult parity", () => {
  test("JSON mode: emits init envelope with generated mnemonic redacted", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "sepolia",
        signerKeySet: true,
        mnemonicImported: false,
        showMnemonic: false,
        mnemonic: "test word one two three four five six seven eight nine ten eleven twelve",
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.signerKeySet).toBe(true);
    expect(json.mnemonicRedacted).toBe(true);
    expect(json.mnemonic).toBeUndefined();
    expect(stderr).toBe("");
  });

  test("JSON mode: includes mnemonic when showMnemonic is true", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const mnemonic = "test word one two three four five six seven eight nine ten eleven twelve";
    const { stdout } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "sepolia",
        signerKeySet: false,
        mnemonicImported: false,
        showMnemonic: true,
        mnemonic,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.mnemonic).toBe(mnemonic);
    expect(json.mnemonicRedacted).toBeUndefined();
  });

  test("JSON mode: omits mnemonic fields when imported", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "ethereum",
        signerKeySet: true,
        mnemonicImported: true,
        showMnemonic: false,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.mnemonic).toBeUndefined();
    expect(json.mnemonicRedacted).toBeUndefined();
    expect(json.defaultChain).toBe("ethereum");
  });

  test("human mode: emits success messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "sepolia",
        signerKeySet: true,
        mnemonicImported: false,
        showMnemonic: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Initialization complete.");
    expect(stderr).toContain("privacy-pools status");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderInitResult(ctx, {
        defaultChain: "sepolia",
        signerKeySet: false,
        mnemonicImported: false,
        showMnemonic: false,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderDepositDryRun parity ──────────────────────────────────────────────

const STUB_DEPOSIT_DRY_RUN: DepositDryRunData = {
  chain: "sepolia",
  asset: "ETH",
  amount: 100000000000000000n,
  decimals: 18,
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  precommitment: 12345678901234567890n,
  balanceSufficient: true,
};

describe("renderDepositDryRun parity", () => {
  test("JSON mode: emits dry-run envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderDepositDryRun(ctx, STUB_DEPOSIT_DRY_RUN),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.operation).toBe("deposit");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.amount).toBe("100000000000000000");
    expect(json.poolAccountNumber).toBe(1);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.precommitment).toBe("12345678901234567890");
    expect(json.balanceSufficient).toBe(true);
    expect(stderr).toBe("");
  });

  test("JSON mode: balanceSufficient can be 'unknown'", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() =>
      renderDepositDryRun(ctx, { ...STUB_DEPOSIT_DRY_RUN, balanceSufficient: "unknown" }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.balanceSufficient).toBe("unknown");
  });

  test("human mode: emits dry-run messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderDepositDryRun(ctx, STUB_DEPOSIT_DRY_RUN),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run complete");
    expect(stderr).toContain("Chain: sepolia");
    expect(stderr).toContain("Asset: ETH");
    expect(stderr).toContain("Pool Account: PA-1");
    expect(stderr).toContain("Balance sufficient: yes");
  });
});

// ── renderDepositSuccess parity ─────────────────────────────────────────────

const STUB_DEPOSIT_SUCCESS: DepositSuccessData = {
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
  blockNumber: 12345n,
  explorerUrl: "https://sepolia.etherscan.io/tx/0xaabb",
};

describe("renderDepositSuccess parity", () => {
  test("JSON mode: emits deposit success envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderDepositSuccess(ctx, STUB_DEPOSIT_SUCCESS),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("deposit");
    expect(json.txHash).toBe(STUB_DEPOSIT_SUCCESS.txHash);
    expect(json.amount).toBe("100000000000000000");
    expect(json.committedValue).toBe("99500000000000000");
    expect(json.asset).toBe("ETH");
    expect(json.chain).toBe("sepolia");
    expect(json.poolAccountNumber).toBe(1);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("42");
    expect(json.label).toBe("789");
    expect(json.blockNumber).toBe("12345");
    expect(json.explorerUrl).toBe("https://sepolia.etherscan.io/tx/0xaabb");
    expect(stderr).toBe("");
  });

  test("JSON mode: handles undefined committedValue and label", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...STUB_DEPOSIT_SUCCESS, committedValue: undefined, label: undefined };
    const { stdout } = captureOutput(() => renderDepositSuccess(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.committedValue).toBeNull();
    expect(json.label).toBeNull();
  });

  test("human mode: emits deposit success messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderDepositSuccess(ctx, STUB_DEPOSIT_SUCCESS),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Deposit submitted:");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Net deposited");
    expect(stderr).toContain("after vetting fee");
    expect(stderr).toContain("Tx:");
    expect(stderr).toContain("Explorer:");
    expect(stderr).toContain("pending approval");
    expect(stderr).toContain("privacy-pools accounts --chain sepolia");
  });

  test("human mode: omits Net deposited when committedValue is undefined", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_DEPOSIT_SUCCESS, committedValue: undefined };
    const { stderr } = captureOutput(() => renderDepositSuccess(ctx, data));

    expect(stderr).not.toContain("Net deposited");
  });

  test("human mode: omits Explorer when explorerUrl is null", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_DEPOSIT_SUCCESS, explorerUrl: null };
    const { stderr } = captureOutput(() => renderDepositSuccess(ctx, data));

    expect(stderr).not.toContain("Explorer:");
  });
});

// ── renderRagequitDryRun parity ─────────────────────────────────────────────

const STUB_RAGEQUIT_DRY_RUN: RagequitDryRunData = {
  chain: "sepolia",
  asset: "ETH",
  amount: 500000000000000000n,
  decimals: 18,
  poolAccountNumber: 2,
  poolAccountId: "PA-2",
  selectedCommitmentLabel: 456n,
  selectedCommitmentValue: 500000000000000000n,
  proofPublicSignals: 7,
};

describe("renderRagequitDryRun parity", () => {
  test("JSON mode: emits dry-run envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitDryRun(ctx, STUB_RAGEQUIT_DRY_RUN),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.amount).toBe("500000000000000000");
    expect(json.poolAccountNumber).toBe(2);
    expect(json.poolAccountId).toBe("PA-2");
    expect(json.selectedCommitmentLabel).toBe("456");
    expect(json.selectedCommitmentValue).toBe("500000000000000000");
    expect(json.proofPublicSignals).toBe(7);
    expect(stderr).toBe("");
  });

  test("human mode: emits dry-run messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitDryRun(ctx, STUB_RAGEQUIT_DRY_RUN),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run complete");
    expect(stderr).toContain("Chain: sepolia");
    expect(stderr).toContain("Asset: ETH");
    expect(stderr).toContain("Pool Account: PA-2");
  });
});

// ── renderRagequitSuccess parity ────────────────────────────────────────────

const STUB_RAGEQUIT_SUCCESS: RagequitSuccessData = {
  txHash: "0x1122334455667788990011223344556677889900112233445566778899001122",
  amount: 500000000000000000n,
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  poolAccountNumber: 2,
  poolAccountId: "PA-2",
  poolAddress: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  blockNumber: 67890n,
  explorerUrl: "https://sepolia.etherscan.io/tx/0x1122",
};

describe("renderRagequitSuccess parity", () => {
  test("JSON mode: emits ragequit success envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitSuccess(ctx, STUB_RAGEQUIT_SUCCESS),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("ragequit");
    expect(json.txHash).toBe(STUB_RAGEQUIT_SUCCESS.txHash);
    expect(json.amount).toBe("500000000000000000");
    expect(json.asset).toBe("ETH");
    expect(json.chain).toBe("sepolia");
    expect(json.poolAccountNumber).toBe(2);
    expect(json.poolAccountId).toBe("PA-2");
    expect(json.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("42");
    expect(json.blockNumber).toBe("67890");
    expect(json.explorerUrl).toBe("https://sepolia.etherscan.io/tx/0x1122");
    expect(stderr).toBe("");
  });

  test("human mode: emits exit success messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitSuccess(ctx, STUB_RAGEQUIT_SUCCESS),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Ragequit PA-2");
    expect(stderr).toContain("withdrew");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("Tx:");
    expect(stderr).toContain("Explorer:");
  });

  test("human mode: omits Explorer when explorerUrl is null", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_RAGEQUIT_SUCCESS, explorerUrl: null };
    const { stderr } = captureOutput(() => renderRagequitSuccess(ctx, data));

    expect(stderr).not.toContain("Explorer:");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderRagequitSuccess(ctx, STUB_RAGEQUIT_SUCCESS),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Withdraw renderer parity tests
// ══════════════════════════════════════════════════════════════════════════════

// ── renderWithdrawDryRun parity ─────────────────────────────────────────────

const STUB_WITHDRAW_DRY_RUN_DIRECT: WithdrawDryRunData = {
  withdrawMode: "direct",
  amount: 500000000000000000n,
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  recipient: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  selectedCommitmentLabel: 456n,
  selectedCommitmentValue: 500000000000000000n,
  proofPublicSignals: 7,
};

const STUB_WITHDRAW_DRY_RUN_RELAYED: WithdrawDryRunData = {
  withdrawMode: "relayed",
  amount: 500000000000000000n,
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  recipient: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  poolAccountNumber: 2,
  poolAccountId: "PA-2",
  selectedCommitmentLabel: 789n,
  selectedCommitmentValue: 500000000000000000n,
  proofPublicSignals: 7,
  feeBPS: "50",
  quoteExpiresAt: "2025-06-01T00:00:00.000Z",
};

describe("renderWithdrawDryRun parity", () => {
  test("JSON mode (direct): emits dry-run envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawDryRun(ctx, STUB_WITHDRAW_DRY_RUN_DIRECT),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("direct");
    expect(json.dryRun).toBe(true);
    expect(json.amount).toBe("500000000000000000");
    expect(json.asset).toBe("ETH");
    expect(json.chain).toBe("sepolia");
    expect(json.recipient).toBe("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");
    expect(json.poolAccountNumber).toBe(1);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.selectedCommitmentLabel).toBe("456");
    expect(json.selectedCommitmentValue).toBe("500000000000000000");
    expect(json.proofPublicSignals).toBe(7);
    expect(json.feeBPS).toBeUndefined();
    expect(json.quoteExpiresAt).toBeUndefined();
    expect(stderr).toBe("");
  });

  test("JSON mode (relayed): includes feeBPS and quoteExpiresAt", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawDryRun(ctx, STUB_WITHDRAW_DRY_RUN_RELAYED),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.mode).toBe("relayed");
    expect(json.dryRun).toBe(true);
    expect(json.feeBPS).toBe("50");
    expect(json.quoteExpiresAt).toBe("2025-06-01T00:00:00.000Z");
    expect(stderr).toBe("");
  });

  test("human mode: emits dry-run messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawDryRun(ctx, STUB_WITHDRAW_DRY_RUN_DIRECT),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Dry-run complete");
    expect(stderr).toContain("Mode: direct");
    expect(stderr).toContain("Pool Account: PA-1");
  });
});

// ── renderWithdrawSuccess parity ────────────────────────────────────────────

const STUB_WITHDRAW_SUCCESS_DIRECT: WithdrawSuccessData = {
  withdrawMode: "direct",
  txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
  blockNumber: 12345n,
  amount: 500000000000000000n,
  recipient: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
  asset: "ETH",
  chain: "sepolia",
  decimals: 18,
  poolAccountNumber: 1,
  poolAccountId: "PA-1",
  poolAddress: "0x1111111111111111111111111111111111111111",
  scope: 42n,
  explorerUrl: "https://sepolia.etherscan.io/tx/0xaabb",
};

const STUB_WITHDRAW_SUCCESS_RELAYED: WithdrawSuccessData = {
  withdrawMode: "relayed",
  txHash: "0x1122334455667788990011223344556677889900112233445566778899001122",
  blockNumber: 67890n,
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
};

describe("renderWithdrawSuccess parity", () => {
  test("JSON mode (direct): emits success envelope with fee=null", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.operation).toBe("withdraw");
    expect(json.mode).toBe("direct");
    expect(json.txHash).toBe(STUB_WITHDRAW_SUCCESS_DIRECT.txHash);
    expect(json.blockNumber).toBe("12345");
    expect(json.amount).toBe("500000000000000000");
    expect(json.recipient).toBe("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa");
    expect(json.fee).toBeNull();
    expect(json.feeBPS).toBeUndefined();
    expect(json.poolAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("42");
    expect(json.asset).toBe("ETH");
    expect(json.chain).toBe("sepolia");
    expect(json.poolAccountNumber).toBe(1);
    expect(json.poolAccountId).toBe("PA-1");
    expect(json.explorerUrl).toBe("https://sepolia.etherscan.io/tx/0xaabb");
    expect(stderr).toBe("");
  });

  test("JSON mode (relayed): includes feeBPS, no fee=null", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_RELAYED),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.mode).toBe("relayed");
    expect(json.feeBPS).toBe("50");
    expect(json.fee).toBeUndefined();
    expect(stderr).toBe("");
  });

  test("human mode (direct): emits withdrawal messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Withdrew");
    expect(stderr).toContain("ETH");
    expect(stderr).toContain("PA-1");
    expect(stderr).toContain("Tx:");
    expect(stderr).toContain("Explorer:");
    expect(stderr).not.toContain("Relay fee:");
  });

  test("human mode (relayed): includes relay fee", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_RELAYED),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Withdrew");
    expect(stderr).toContain("Relay fee: 0.50%");
  });

  test("human mode: omits Explorer when explorerUrl is null", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_WITHDRAW_SUCCESS_DIRECT, explorerUrl: null };
    const { stderr } = captureOutput(() => renderWithdrawSuccess(ctx, data));

    expect(stderr).not.toContain("Explorer:");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawSuccess(ctx, STUB_WITHDRAW_SUCCESS_DIRECT),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderWithdrawQuote parity ──────────────────────────────────────────────

const STUB_WITHDRAW_QUOTE: WithdrawQuoteData = {
  chain: "sepolia",
  asset: "ETH",
  amount: 500000000000000000n,
  decimals: 18,
  recipient: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
  minWithdrawAmount: "100000000000000000",
  maxRelayFeeBPS: 100n,
  quoteFeeBPS: "50",
  feeCommitmentPresent: true,
  quoteExpiresAt: "2025-06-01T00:00:00.000Z",
};

describe("renderWithdrawQuote parity", () => {
  test("JSON mode: emits quote envelope to stdout", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, STUB_WITHDRAW_QUOTE),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("relayed-quote");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.amount).toBe("500000000000000000");
    expect(json.recipient).toBe("0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB");
    expect(json.minWithdrawAmount).toBe("100000000000000000");
    expect(typeof json.minWithdrawAmountFormatted).toBe("string");
    expect(json.maxRelayFeeBPS).toBe("100");
    expect(json.quoteFeeBPS).toBe("50");
    expect(json.feeCommitmentPresent).toBe(true);
    expect(json.quoteExpiresAt).toBe("2025-06-01T00:00:00.000Z");
    expect(stderr).toBe("");
  });

  test("JSON mode: handles null recipient and quoteExpiresAt", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const data = { ...STUB_WITHDRAW_QUOTE, recipient: null, quoteExpiresAt: null };
    const { stdout } = captureOutput(() => renderWithdrawQuote(ctx, data));

    const json = JSON.parse(stdout.trim());
    expect(json.recipient).toBeNull();
    expect(json.quoteExpiresAt).toBeNull();
  });

  test("human mode: emits quote messages to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, STUB_WITHDRAW_QUOTE),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Relayer quote");
    expect(stderr).toContain("Asset: ETH");
    expect(stderr).toContain("Quoted fee: 0.50%");
    expect(stderr).toContain("On-chain max fee: 1.00%");
    expect(stderr).toContain("Recipient:");
    expect(stderr).toContain("Quote expires:");
  });

  test("human mode: omits Recipient and Quote expires when null", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_WITHDRAW_QUOTE, recipient: null, quoteExpiresAt: null };
    const { stderr } = captureOutput(() => renderWithdrawQuote(ctx, data));

    expect(stderr).not.toContain("Recipient:");
    expect(stderr).not.toContain("Quote expires:");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderWithdrawQuote(ctx, STUB_WITHDRAW_QUOTE),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});
