/**
 * Unit tests for the activity output renderer: renderActivity.
 * Follows the parity pattern established by output-reporting-renderers.unit.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { createOutputContext } from "../../src/output/common.ts";
import {
  renderActivity,
  type ActivityRenderData,
  type NormalizedActivityEvent,
} from "../../src/output/activity.ts";
import { makeMode, captureOutput } from "../helpers/output.ts";

// ── Stub data ────────────────────────────────────────────────────────────────

const STUB_EVENT: NormalizedActivityEvent = {
  type: "deposit",
  txHash: "0xaabbccddee1234567890aabbccddee1234567890aabbccddee1234567890aabb",
  reviewStatus: "approved",
  amountRaw: "1000000000000000000",
  amountFormatted: "1.0 ETH",
  timestampMs: 1700000000000,
  timeLabel: "2023-11-14 22:13",
  poolSymbol: "ETH",
  poolAddress: "0x1111111111111111111111111111111111111111",
  chainId: 11155111,
};

const STUB_POOL_ACTIVITY: ActivityRenderData = {
  mode: "pool-activity",
  chain: "sepolia",
  page: 1,
  perPage: 10,
  total: 1,
  totalPages: 1,
  events: [STUB_EVENT],
  asset: "ETH",
  pool: "0x1111111111111111111111111111111111111111",
  scope: "42",
};

const STUB_GLOBAL_ACTIVITY: ActivityRenderData = {
  mode: "global-activity",
  chain: "sepolia",
  chains: ["sepolia", "mainnet"],
  page: 1,
  perPage: 10,
  total: 1,
  totalPages: 1,
  events: [STUB_EVENT],
};

// ── renderActivity pool-activity parity ──────────────────────────────────────

describe("renderActivity pool-activity parity", () => {
  test("JSON mode: emits pool-activity envelope with events array", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderActivity(ctx, STUB_POOL_ACTIVITY));

    const json = JSON.parse(stdout.trim());
    expect(json.mode).toBe("pool-activity");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.pool).toBe("0x1111111111111111111111111111111111111111");
    expect(json.scope).toBe("42");
    expect(json.events.length).toBe(1);
    expect(json.events[0].type).toBe("deposit");
    expect(json.events[0].timestamp).toBe(1700000000000);
    expect(stderr).toBe("");
  });

  test("JSON mode: includes pagination fields", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderActivity(ctx, STUB_POOL_ACTIVITY));

    const json = JSON.parse(stdout.trim());
    expect(json.page).toBe(1);
    expect(json.perPage).toBe(10);
    expect(json.total).toBe(1);
    expect(json.totalPages).toBe(1);
  });

  test("human mode: emits header and table to stderr", () => {
    const ctx = createOutputContext(makeMode());
    const { stdout, stderr } = captureOutput(() => renderActivity(ctx, STUB_POOL_ACTIVITY));

    expect(stdout).toBe("");
    expect(stderr).toContain("Activity for ETH on sepolia");
    expect(stderr).toContain("deposit");
    expect(stderr).toContain("1.0 ETH");
    expect(stderr).toContain("approved");
  });

  test("human mode: shows 'No activity found' for empty events", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_POOL_ACTIVITY, events: [] };
    const { stderr } = captureOutput(() => renderActivity(ctx, data));

    expect(stderr).toContain("No activity found");
  });

  test("human mode: shows pagination footer for multi-page", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_POOL_ACTIVITY, page: 1, totalPages: 3, total: 30 };
    const { stderr } = captureOutput(() => renderActivity(ctx, data));

    expect(stderr).toContain("Page 1 of 3");
    expect(stderr).toContain("next: --page 2");
  });

  test("human mode: omits 'next' hint on last page", () => {
    const ctx = createOutputContext(makeMode());
    const data = { ...STUB_POOL_ACTIVITY, page: 3, totalPages: 3, total: 30 };
    const { stderr } = captureOutput(() => renderActivity(ctx, data));

    expect(stderr).toContain("Page 3 of 3");
    expect(stderr).not.toContain("next: --page");
  });

  test("quiet mode: emits nothing", () => {
    const ctx = createOutputContext(makeMode({ isQuiet: true }));
    const { stdout, stderr } = captureOutput(() => renderActivity(ctx, STUB_POOL_ACTIVITY));

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
});

// ── renderActivity global-activity parity ────────────────────────────────────

describe("renderActivity global-activity parity", () => {
  test("JSON mode: emits global-activity envelope with chains array", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout, stderr } = captureOutput(() => renderActivity(ctx, STUB_GLOBAL_ACTIVITY));

    const json = JSON.parse(stdout.trim());
    expect(json.mode).toBe("global-activity");
    expect(json.chains).toEqual(["sepolia", "mainnet"]);
    expect(stderr).toBe("");
  });

  test("JSON mode: omits asset/pool/scope for global mode", () => {
    const ctx = createOutputContext(makeMode({ isJson: true }));
    const { stdout } = captureOutput(() => renderActivity(ctx, STUB_GLOBAL_ACTIVITY));

    const json = JSON.parse(stdout.trim());
    expect(json.asset).toBeUndefined();
    expect(json.pool).toBeUndefined();
    expect(json.scope).toBeUndefined();
  });

  test("human mode: shows chain list in header", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderActivity(ctx, STUB_GLOBAL_ACTIVITY));

    expect(stderr).toContain("Global activity (sepolia, mainnet)");
  });

  test("human mode: shows pool column via eventPoolLabel", () => {
    const ctx = createOutputContext(makeMode());
    const { stderr } = captureOutput(() => renderActivity(ctx, STUB_GLOBAL_ACTIVITY));

    // eventPoolLabel concatenates poolSymbol@chainId
    expect(stderr).toContain("ETH@11155111");
  });
});
