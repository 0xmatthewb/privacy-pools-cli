import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import chalk from "chalk";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionList,
  formatSectionHeading,
} from "../../src/output/layout.ts";

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, "");
}

let originalChalkLevel: typeof chalk.level;

beforeAll(() => {
  originalChalkLevel = chalk.level;
  chalk.level = 3;
});

afterAll(() => {
  chalk.level = originalChalkLevel;
});

describe("formatSectionHeading", () => {
  test("renders a titled section with an optional divider", () => {
    const heading = stripAnsi(
      formatSectionHeading("Next steps", { divider: true, tone: "muted" }),
    );

    expect(heading).toMatch(/[─-]{18}/);
    expect(heading).toContain("Next steps:");
    expect(heading.startsWith("\n")).toBe(true);
  });

  test("can omit top padding for inline sections", () => {
    const heading = stripAnsi(
      formatSectionHeading("Summary", { padTop: false }),
    );

    expect(heading.startsWith("Summary:")).toBe(true);
  });
});

describe("formatKeyValueRows", () => {
  test("aligns labels to the widest key", () => {
    const rows = stripAnsi(
      formatKeyValueRows([
        { label: "Chain", value: "sepolia" },
        { label: "Default chain", value: "mainnet" },
      ]),
    ).trimEnd();

    expect(rows).toBe(
      "  Chain:         sepolia\n  Default chain: mainnet",
    );
  });

  test("returns an empty string when no rows are provided", () => {
    expect(formatKeyValueRows([])).toBe("");
  });
});

describe("formatCallout", () => {
  test("renders a titled multi-line callout", () => {
    const callout = stripAnsi(
      formatCallout("privacy", [
        "Direct withdrawals link deposit and withdrawal onchain.",
        "Relayed withdrawals preserve privacy better.",
      ]),
    );

    expect(callout).toContain("Privacy note:");
    expect(callout).toMatch(/[│|] Privacy note:/);
    expect(callout).toMatch(
      /[│|] Direct withdrawals link deposit and withdrawal onchain\./,
    );
    expect(callout).toMatch(
      /[│|] Relayed withdrawals preserve privacy better\./,
    );
  });

  test("tints the gutter by callout kind", () => {
    const success = formatCallout("success", "Ready.");
    const danger = formatCallout("danger", "Blocked.");
    const successGutter = success.match(/\x1B\[[0-9;]+m[│|]\x1B\[[0-9;]+m/)?.[0];
    const dangerGutter = danger.match(/\x1B\[[0-9;]+m[│|]\x1B\[[0-9;]+m/)?.[0];

    expect(successGutter).toBeTruthy();
    expect(dangerGutter).toBeTruthy();
    expect(successGutter).not.toBe(dangerGutter);
    expect(stripAnsi(success)).toMatch(/[│|] Success:/);
    expect(stripAnsi(danger)).toMatch(/[│|] Danger:/);
  });
});

describe("formatSectionList", () => {
  test("renders section-scoped list items", () => {
    const list = stripAnsi(
      formatSectionList("Next steps", [
        "privacy-pools status",
        "privacy-pools pools",
      ]),
    );

    expect(list).toContain("Next steps:");
    expect(list).toContain("  privacy-pools status");
    expect(list).toContain("  privacy-pools pools");
  });
});
