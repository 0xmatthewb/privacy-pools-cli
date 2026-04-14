/**
 * Unit tests for help text styling utilities.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import chalk from "chalk";
import { styleCommanderHelp } from "../../src/utils/help.ts";

/** Strip ANSI escape codes for assertion clarity. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("styleCommanderHelp", () => {
  // Force chalk color output so we can verify ANSI styling in a non-TTY env.
  let origLevel: typeof chalk.level;
  beforeAll(() => { origLevel = chalk.level; chalk.level = 3; });
  afterAll(() => { chalk.level = origLevel; });

  test("returns raw text unchanged when no Usage: header present", () => {
    const raw = "Some random text without a usage header.";
    expect(styleCommanderHelp(raw)).toBe(raw);
  });

  test("styles Usage: line", () => {
    const raw = "Usage: privacy-pools [options]\n";
    const result = styleCommanderHelp(raw);
    expect(stripAnsi(result)).toContain("Usage:");
    expect(stripAnsi(result)).toContain("privacy-pools [options]");
    // Verify ANSI codes are present (chalk is active)
    expect(result).toMatch(/\x1b\[/);
  });

  test("styles command names in Commands section", () => {
    const raw = [
      "Usage: privacy-pools [options] [command]",
      "",
      "Commands:",
      "  pools          List available pools",
      "  deposit        Deposit ETH into a pool",
    ].join("\n");
    const result = styleCommanderHelp(raw);
    const plain = stripAnsi(result);
    expect(plain).toContain("pools");
    expect(plain).toContain("deposit");
  });

  test("groups root-level commands into the curated root help categories", () => {
    const raw = [
      "Usage: privacy-pools [options] [command]",
      "",
      "Commands:",
      "  init             Initialize wallet",
      "  pools            List available pools",
      "  deposit          Deposit ETH into a pool",
      "  activity         Show public activity feed",
      "  help             display help for command",
    ].join("\n");
    const result = styleCommanderHelp(raw);
    const plain = stripAnsi(result);
    // Group headers appear
    expect(plain).toContain("Getting started");
    expect(plain).toContain("Transactions");
    expect(plain).toContain("Monitoring");
    // Group order stays curated
    const lines = plain.split("\n");
    const gettingStartedPos = lines.findIndex((line) => line.includes("Getting started"));
    const transactionsPos = lines.findIndex((line) => line.includes("Transactions"));
    const monitoringPos = lines.findIndex((line) => line.includes("Monitoring"));
    const initPos = lines.findIndex((line) => line.includes("  init"));
    const depositPos = lines.findIndex((line) => line.includes("  deposit"));
    const poolsPos = lines.findIndex((line) => line.includes("  pools"));
    expect(gettingStartedPos).toBeLessThan(transactionsPos);
    expect(transactionsPos).toBeLessThan(monitoringPos);
    expect(gettingStartedPos).toBeLessThan(initPos);
    expect(transactionsPos).toBeLessThan(depositPos);
    expect(monitoringPos).toBeLessThan(poolsPos);
    // Commander's built-in help command is omitted from grouped output
    expect(plain).not.toContain("display help for command");
  });

  test("does not group sub-commands (non-root)", () => {
    const raw = [
      "Usage: privacy-pools withdraw [options] <amount>",
      "",
      "Commands:",
      "  quote            Get a relayer fee quote",
    ].join("\n");
    const result = styleCommanderHelp(raw);
    const plain = stripAnsi(result);
    expect(plain).not.toContain("Explore");
    expect(plain).not.toContain("Transact");
    expect(plain).toContain("quote");
  });

  test("styles command|alias — primary highlighted, alias dimmed", () => {
    const raw = [
      "Usage: privacy-pools [options] [command]",
      "",
      "Commands:",
      "  ragequit|exit  Publicly withdraw funds",
      "  pools          List available pools",
    ].join("\n");
    const result = styleCommanderHelp(raw);
    const plain = stripAnsi(result);
    expect(plain).toContain("ragequit|exit");
    expect(plain).toContain("Publicly withdraw funds");
    // The ragequit line must contain ANSI codes (regex matched and styled it)
    const ragequitLine = result.split("\n").find((l) => stripAnsi(l).includes("ragequit"))!;
    expect(ragequitLine).toMatch(/\x1b\[/);
    // Primary name and alias should get separate styles: an ANSI reset/transition
    // appears between "ragequit" and the "|" pipe character.
    expect(ragequitLine).toMatch(/ragequit\x1b\[.*\|/);
  });

  test("styles options in Options section", () => {
    const raw = [
      "Usage: privacy-pools [options]",
      "",
      "Options:",
      "  -c, --chain <name>  Target chain",
      "  -h, --help          Show help",
    ].join("\n");
    const result = styleCommanderHelp(raw);
    const plain = stripAnsi(result);
    expect(plain).toContain("--chain <name>");
    expect(plain).toContain("--help");
  });

  test("styles custom command-help section headers", () => {
    const raw = [
      "Usage: privacy-pools deposit [options] <amount>",
      "",
      "Examples:",
      "  privacy-pools deposit 0.1 ETH",
      "",
      "Safety notes:",
      "  Deposits are reviewed by the ASP before approval.",
      "",
      "JSON output (--json):",
      "  { operation, txHash }",
    ].join("\n");

    const result = styleCommanderHelp(raw);
    const plain = stripAnsi(result);
    expect(plain).toContain("Examples:");
    expect(plain).toContain("Safety notes:");
    expect(plain).toContain("JSON output (--json):");

    const examplesLine = result.split("\n").find((line) => stripAnsi(line).includes("privacy-pools deposit 0.1 ETH"));
    expect(examplesLine).toBeDefined();
    expect(examplesLine).toMatch(/\x1b\[/);
  });

  test("preserves empty lines", () => {
    const raw = [
      "Usage: privacy-pools [options]",
      "",
      "Options:",
      "  -h, --help  Show help",
    ].join("\n");
    const lines = styleCommanderHelp(raw).split("\n");
    expect(lines[1]).toBe("");
  });
});
