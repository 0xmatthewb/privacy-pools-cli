/**
 * Unit tests for utility output renderers: guide, capabilities, completion, sync, status.
 */

import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import { renderGuide } from "../../src/output/guide.ts";
import { renderCapabilities, type CapabilitiesPayload } from "../../src/output/capabilities.ts";
import { renderCompletionScript, renderCompletionQuery } from "../../src/output/completion.ts";
import { renderSyncEmpty, renderSyncComplete } from "../../src/output/sync.ts";
import { renderStatus, type StatusCheckResult } from "../../src/output/status.ts";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import { makeMode, captureOutput } from "../helpers/output.ts";

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
    // Guide outputs structural sections to stderr
    expect(stderr).toContain("Quick Start");
    expect(stderr).toContain("Workflow");
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
        chain: "mainnet",
        syncedPools: 2,
        syncedSymbols: ["ETH", "DAI"],
        spendableCommitments: 5,
      }),
    );

    const json = JSON.parse(stdout.trim());
    expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
    expect(json.success).toBe(true);
    expect(json.chain).toBe("mainnet");
    expect(json.syncedPools).toBe(2);
    expect(json.syncedSymbols).toEqual(["ETH", "DAI"]);
    expect(json.spendableCommitments).toBe(5);
    expect(stderr).toBe("");
  });

  test("human mode: emits success + info to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() =>
      renderSyncComplete(ctx, {
        chain: "mainnet",
        syncedPools: 2,
        spendableCommitments: 5,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Synced 2 pool(s) on mainnet");
    expect(stderr).toContain("Available Pool Accounts: 5");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() =>
      renderSyncComplete(ctx, {
        chain: "mainnet",
        syncedPools: 1,
        spendableCommitments: 0,
      }),
    );

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderStatus parity ─────────────────────────────────────────────────────

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
