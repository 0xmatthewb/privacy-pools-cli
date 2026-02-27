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

    // Command renderers
    expect(typeof mod.renderGuide).toBe("function");
    expect(typeof mod.renderCapabilities).toBe("function");
    expect(typeof mod.renderCompletionScript).toBe("function");
    expect(typeof mod.renderCompletionQuery).toBe("function");
    expect(typeof mod.renderSyncEmpty).toBe("function");
    expect(typeof mod.renderSyncComplete).toBe("function");
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
