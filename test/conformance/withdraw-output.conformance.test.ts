import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CLI_ROOT = process.cwd();
const withdrawSource = readFileSync(`${CLI_ROOT}/src/commands/withdraw.ts`, "utf8");

describe("withdraw output conformance", () => {
  test("direct and relayed JSON outputs include blockNumber", () => {
    expect(withdrawSource).toMatch(
      /mode:\s*"direct"[\s\S]*blockNumber:\s*receipt\.blockNumber\.toString\(\)/
    );
    expect(withdrawSource).toMatch(
      /mode:\s*"relayed"[\s\S]*blockNumber:\s*receipt\.blockNumber\.toString\(\)/
    );
  });

  test("relayed output exposes feeBPS only (no duplicate fee field)", () => {
    expect(withdrawSource).toContain("feeBPS: quote.feeBPS");
    expect(withdrawSource).not.toContain("fee: quote.feeBPS");
  });

  test("human explorer output is guarded when chain explorer is unavailable", () => {
    expect(withdrawSource).toContain("const directExplorerUrl = explorerTxUrl(chainConfig.id, tx.hash);");
    expect(withdrawSource).toContain("if (directExplorerUrl) info(`Explorer: ${directExplorerUrl}`, silent);");
    expect(withdrawSource).toContain("const relayedExplorerUrl = explorerTxUrl(chainConfig.id, result.txHash);");
    expect(withdrawSource).toContain("if (relayedExplorerUrl) info(`Explorer: ${relayedExplorerUrl}`, silent);");
  });
});
