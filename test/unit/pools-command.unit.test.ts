import { describe, expect, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";
import { formatPoolDetailMyFundsWarning } from "../../src/commands/pools.ts";

describe("formatPoolDetailMyFundsWarning", () => {
  test("keeps RPC failures concise and actionable", () => {
    const warning = formatPoolDetailMyFundsWarning(
      new CLIError(
        'Network error: HTTP request failed. URL: http://127.0.0.1:1234 body: {"method":"eth_getLogs"} Method not found. viem/2.38.2',
        "RPC",
        "Check your RPC URL and network connectivity.",
        "RPC_NETWORK_ERROR",
        true,
      ),
      "sepolia",
    );

    expect(warning).toContain("Could not load your wallet state from onchain data right now.");
    expect(warning).toContain("privacy-pools status --check --chain sepolia");
    expect(warning).not.toContain("eth_getLogs");
    expect(warning).not.toContain("Method not found");
    expect(warning).not.toContain("viem");
  });

  test("gives a specific message for corrupted recovery phrases", () => {
    const warning = formatPoolDetailMyFundsWarning(
      new CLIError(
        "Stored recovery phrase is invalid or corrupted.",
        "INPUT",
      ),
      "mainnet",
    );

    expect(warning).toContain("stored recovery phrase");
    expect(warning).toContain("privacy-pools init --force");
  });

  test("keeps unknown failures generic without dumping internals", () => {
    const warning = formatPoolDetailMyFundsWarning(
      new Error("boom: low-level detail"),
      "mainnet",
    );

    expect(warning).toContain("Pool stats and recent activity are still available.");
    expect(warning).toContain("privacy-pools status --check --chain mainnet");
    expect(warning).not.toContain("low-level detail");
  });
});
