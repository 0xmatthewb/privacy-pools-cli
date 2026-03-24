import { describe, expect, test } from "bun:test";
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";

describe("transaction input validation", () => {
  const missingInputCases = [
    {
      name: "deposit without --asset in --yes mode",
      args: ["--json", "deposit", "0.1", "--yes"],
      initChain: "sepolia",
    },
    {
      name: "withdraw without --to in relayed mode",
      args: ["--json", "withdraw", "0.1", "--yes"],
      initChain: "sepolia",
    },
    {
      name: "ragequit without --asset in --yes mode",
      args: ["--json", "ragequit", "--yes"],
    },
    {
      name: "exit alias without --asset in --yes mode",
      args: ["--json", "exit", "--yes"],
    },
  ] as const;

  for (const testCase of missingInputCases) {
    test(`${testCase.name} fails with INPUT error`, () => {
      const home = createTempHome();
      if (testCase.initChain) {
        mustInitSeededHome(home, testCase.initChain);
      }

      const result = runCli(testCase.args, { home });
      expect(result.status).toBe(2);

      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        error: { category: string };
      }>(result.stdout);
      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
    });
  }

  const unsignedCases = [
    ["deposit", ["deposit", "0.1", "--unsigned"]],
    ["withdraw", ["withdraw", "0.1", "--unsigned"]],
    ["ragequit", ["ragequit", "--unsigned"]],
  ] as const;

  for (const [command, args] of unsignedCases) {
    test(`${command} --unsigned emits machine-readable INPUT error without --asset`, () => {
      const home = createTempHome();
      mustInitSeededHome(home, "sepolia");

      const result = runCli(args, { home, timeoutMs: 60_000 });
      expect(result.status).toBe(2);

      const json = parseJsonOutput<{
        schemaVersion: string;
        success: boolean;
        error: { category: string; code: string };
      }>(result.stdout);

      expect(json.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.code).toBe("INPUT_ERROR");
    });
  }

  test("machine-mode transaction commands fail fast without prompting for a missing asset", () => {
    const cases = [
      {
        args: ["--json", "deposit", "0.1"],
        hiddenPrompt: "Select asset to deposit",
      },
      {
        args: ["--json", "withdraw", "0.1", "--direct"],
        hiddenPrompt: "Select asset to withdraw",
      },
      {
        args: ["--json", "ragequit"],
        hiddenPrompt: "Select asset pool for ragequit",
      },
      {
        args: ["--json", "exit"],
        hiddenPrompt: "Select asset pool for ragequit",
      },
    ] as const;

    for (const testCase of cases) {
      const home = createTempHome();
      mustInitSeededHome(home, "sepolia");

      const result = runCli(testCase.args, {
        home,
        timeoutMs: 60_000,
      });
      expect(result.status).toBe(2);
      expect(result.stderr).not.toContain(testCase.hiddenPrompt);

      const json = parseJsonOutput<{
        success: boolean;
        error: { category: string; message: string };
      }>(result.stdout);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("No asset specified");
    }
  });
});

describe("transaction argument parsing", () => {
  const assetAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

  test("deposit positional alias parses asset-first form", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "mainnet");

    const result = runCli(
      [
        "--json",
        "--chain",
        "mainnet",
        "--rpc-url",
        "http://127.0.0.1:9",
        "deposit",
        assetAddress,
        "0.1",
        "--yes",
      ],
      { home, timeoutMs: 60_000 },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain(`No pool found for asset ${assetAddress}`);
  });

  test("withdraw positional alias parses asset-first form", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "mainnet");

    const result = runCli(
      [
        "--json",
        "--chain",
        "mainnet",
        "--rpc-url",
        "http://127.0.0.1:9",
        "withdraw",
        assetAddress,
        "0.1",
        "--direct",
        "--yes",
      ],
      { home, timeoutMs: 60_000 },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain(`No pool found for asset ${assetAddress}`);
  });

  test("ragequit positional alias parses asset-only form", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "mainnet");

    const result = runCli(
      [
        "--json",
        "--chain",
        "mainnet",
        "--rpc-url",
        "http://127.0.0.1:9",
        "ragequit",
        assetAddress,
        "--yes",
      ],
      { home, timeoutMs: 60_000 },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain(`No pool found for asset ${assetAddress}`);
  });

  test("positional + --asset together is rejected as ambiguous", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "mainnet");

    const result = runCli(["--json", "deposit", "ETH", "0.1", "--asset", "ETH", "--yes"], {
      home,
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Ambiguous positional arguments");
  });
});

describe("transaction pre-network guards", () => {
  test("withdraw rejects malformed --from-pa before network calls", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      [
        "--json",
        "withdraw",
        "0.1",
        "--asset",
        "ETH",
        "--to",
        "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
        "--from-pa",
        "not-a-pa",
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 10_000 },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Invalid --from-pa");
  });

  test("direct withdraw rejects --to that does not match signer before network calls", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      [
        "--json",
        "withdraw",
        "0.1",
        "--asset",
        "ETH",
        "--direct",
        "--to",
        "0x0000000000000000000000000000000000000001",
        "--chain",
        "sepolia",
      ],
      { home, timeoutMs: 10_000 },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("must match your signer address");
  });

  test("ragequit rejects malformed --from-pa before network calls", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--from-pa", "not-a-pa", "--chain", "sepolia"],
      { home, timeoutMs: 10_000 },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Invalid --from-pa");
  });

  test("ragequit rejects --from-pa when combined with deprecated --commitment", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      ["--json", "ragequit", "--asset", "ETH", "--from-pa", "PA-1", "--commitment", "0", "--chain", "sepolia"],
      { home, timeoutMs: 10_000 },
    );
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{
      success: boolean;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("Cannot use --from-pa and --commitment together");
  });
});
