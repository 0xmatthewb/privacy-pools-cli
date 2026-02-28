/**
 * Unit tests for output module core: createOutputContext, isSilent, barrel re-exports.
 */

import { describe, expect, test } from "bun:test";
import {
  createOutputContext,
  isSilent,
} from "../../src/output/common.ts";
import { makeMode } from "../helpers/output.ts";

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
