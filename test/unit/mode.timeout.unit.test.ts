import { describe, expect, test, beforeEach } from "bun:test";
import { resolveGlobalMode, getNetworkTimeoutMs } from "../../src/utils/mode.ts";

describe("timeout parsing via resolveGlobalMode + getNetworkTimeoutMs", () => {
  // Reset to known default (30s) before each test since module state persists.
  beforeEach(() => {
    resolveGlobalMode({ timeout: "30" });
  });

  test("valid integer seconds sets timeout in ms", () => {
    resolveGlobalMode({ timeout: "10" });
    expect(getNetworkTimeoutMs()).toBe(10000);
  });

  test("valid decimal seconds rounds to nearest ms", () => {
    resolveGlobalMode({ timeout: "1.5" });
    expect(getNetworkTimeoutMs()).toBe(1500);
  });

  test("very small decimal seconds", () => {
    resolveGlobalMode({ timeout: "0.1" });
    expect(getNetworkTimeoutMs()).toBe(100);
  });

  test("invalid string falls back to default 30000", () => {
    resolveGlobalMode({ timeout: "abc" });
    expect(getNetworkTimeoutMs()).toBe(30000);
  });

  test("negative value falls back to default", () => {
    resolveGlobalMode({ timeout: "-5" });
    expect(getNetworkTimeoutMs()).toBe(30000);
  });

  test("zero falls back to default", () => {
    resolveGlobalMode({ timeout: "0" });
    expect(getNetworkTimeoutMs()).toBe(30000);
  });

  test("very large value is accepted", () => {
    resolveGlobalMode({ timeout: "3600" });
    expect(getNetworkTimeoutMs()).toBe(3600000);
  });

  test("undefined timeout does not change existing value", () => {
    resolveGlobalMode({ timeout: "10" });
    resolveGlobalMode({});
    expect(getNetworkTimeoutMs()).toBe(10000);
  });

  test("empty string falls back to default", () => {
    resolveGlobalMode({ timeout: "" });
    expect(getNetworkTimeoutMs()).toBe(30000);
  });

  test("NaN string falls back to default", () => {
    resolveGlobalMode({ timeout: "NaN" });
    expect(getNetworkTimeoutMs()).toBe(30000);
  });

  test("Infinity string falls back to default", () => {
    resolveGlobalMode({ timeout: "Infinity" });
    expect(getNetworkTimeoutMs()).toBe(30000);
  });
});
