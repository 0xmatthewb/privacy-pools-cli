/**
 * Unit tests for output module core: createOutputContext, isSilent, barrel re-exports.
 */

import { describe, expect, test } from "bun:test";
import {
  appendNextActions,
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

  test("true when csv", () => {
    const ctx = createOutputContext(makeMode({ isCsv: true, format: "csv" }));
    expect(isSilent(ctx)).toBe(true);
  });

  test("true when agent (json + quiet)", () => {
    const ctx = createOutputContext(
      makeMode({ isAgent: true, isJson: true, isQuiet: true }),
    );
    expect(isSilent(ctx)).toBe(true);
  });
});

// ── appendNextActions ────────────────────────────────────────────────────────

describe("appendNextActions", () => {
  test("returns a new payload with nextActions when provided", () => {
    const payload = { operation: "deposit" };
    const nextActions = [
      {
        command: "accounts",
        reason: "Poll for approval.",
        when: "after_deposit",
        options: { agent: true },
      },
    ] as const;

    const result = appendNextActions(payload, [...nextActions]);

    expect(result).toEqual({
      operation: "deposit",
      nextActions,
    });
    expect(result).not.toBe(payload);
    expect(payload).toEqual({ operation: "deposit" });
  });

  test("returns a copied payload without mutating when nextActions are absent", () => {
    const payload = { operation: "status" };

    const result = appendNextActions(payload, undefined);

    expect(result).toEqual({ operation: "status" });
    expect(result).not.toBe(payload);
    expect(payload).toEqual({ operation: "status" });
  });
});

// ── Barrel re-exports ────────────────────────────────────────────────────────

describe("barrel re-exports", () => {
  // Exhaustive list of expected function exports from mod.ts.
  // If a renderer is added or removed, this test must be updated.
  const EXPECTED_FUNCTIONS = [
    // Shared primitives
    "createOutputContext",
    "isSilent",
    "isCsv",
    "printJsonSuccess",
    "printCsv",
    "info",
    "success",
    "warn",
    "printTable",
    "renderNextSteps",
    "formatNextActionCommand",
    // Core command renderers
    "renderGuide",
    "renderCapabilities",
    "renderCommandDescription",
    "renderCompletionScript",
    "renderCompletionQuery",
    "renderSyncEmpty",
    "renderSyncComplete",
    // Reporting command renderers
    "renderStatus",
    "renderPoolsEmpty",
    "renderPools",
    "renderPoolDetail",
    "poolToJson",
    "renderAccountsNoPools",
    "renderAccounts",
    "renderHistoryNoPools",
    "renderHistory",
    // Transactional command renderers
    "renderInitResult",
    "renderDepositDryRun",
    "renderDepositSuccess",
    "renderRagequitDryRun",
    "renderRagequitSuccess",
    // Withdraw renderers
    "renderWithdrawDryRun",
    "renderWithdrawSuccess",
    "renderWithdrawQuote",
    // Activity + stats renderers
    "renderActivity",
    "renderGlobalStats",
    "renderPoolStats",
    "parseUsd",
    "parseCount",
  ] as const;

  test("mod.ts exports all expected function symbols", async () => {
    const mod = await import("../../src/output/mod.ts");
    for (const name of EXPECTED_FUNCTIONS) {
      expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
    }
  });

  test("mod.ts does not export unexpected function symbols", async () => {
    const mod = await import("../../src/output/mod.ts");
    const actualFunctions = Object.entries(mod)
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k)
      .sort();
    const expectedSorted = [...EXPECTED_FUNCTIONS].sort();
    expect(actualFunctions).toEqual(expectedSorted);
  });
});
