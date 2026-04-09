import { describe, expect, test } from "bun:test";
import {
  formatCallout,
  formatKeyValueRows,
  formatSectionList,
  formatSectionHeading,
} from "../../src/output/layout.ts";

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-9;]*m/g, "");
}

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
