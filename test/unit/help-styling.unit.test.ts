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
