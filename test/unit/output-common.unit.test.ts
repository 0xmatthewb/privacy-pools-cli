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
  const STABLE_PUBLIC_EXPORTS = [
    "createOutputContext",
    "isSilent",
    "printJsonSuccess",
    "renderGuide",
    "renderCapabilities",
    "renderStatus",
    "renderPools",
    "renderAccounts",
    "renderMigrationStatus",
    "renderInitResult",
    "renderDepositSuccess",
    "renderFlowResult",
    "renderRagequitSuccess",
    "renderWithdrawSuccess",
    "renderWithdrawQuote",
    "renderActivity",
    "renderGlobalStats",
    "renderPoolStats",
  ] as const;

  test("mod.ts exposes the stable public renderer entry points", async () => {
    const mod = await import("../../src/output/mod.ts");
    for (const name of STABLE_PUBLIC_EXPORTS) {
      expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
    }
  });
});
