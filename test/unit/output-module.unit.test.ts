/**
 * Unit tests for the output module scaffolding (Phase 1).
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
    expect(typeof mod.stderrLine).toBe("function");
    expect(typeof mod.printJsonSuccess).toBe("function");
    expect(typeof mod.printError).toBe("function");
    expect(typeof mod.info).toBe("function");
    expect(typeof mod.success).toBe("function");
    expect(typeof mod.warn).toBe("function");
    expect(typeof mod.verbose).toBe("function");
    expect(typeof mod.spinner).toBe("function");
    expect(typeof mod.printTable).toBe("function");

    // Command renderers (Phase 1-2)
    expect(typeof mod.renderGuide).toBe("function");
    expect(typeof mod.renderCapabilities).toBe("function");
    expect(typeof mod.renderCompletionScript).toBe("function");
    expect(typeof mod.renderCompletionQuery).toBe("function");
    expect(typeof mod.renderSyncEmpty).toBe("function");
    expect(typeof mod.renderSyncComplete).toBe("function");

    // Command renderers (Phase 3)
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
  });
});

// ── Renderer output parity ──────────────────────────────────────────────────
//
// These tests capture stdout/stderr from each renderer and verify the output
// matches the current command behavior byte-for-byte.  When Phase 2 wires
// commands to renderers, any drift will fail here.

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
    expect(stderr).toContain("Spendable commitments: 5");
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
// Phase 3 renderer parity tests
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
    expect(stderr).toContain("Accounts on sepolia");
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
