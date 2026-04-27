import { describe, expect, test } from "bun:test";
import { createTempHome, parseJsonOutput, runCli } from "../helpers/cli.ts";

describe("cli output policy regressions", () => {
  test("--quiet keeps final errors visible on stderr", () => {
    const result = runCli(["pools", "--chain", "fake-chain", "--quiet"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("INPUT_UNKNOWN_CHAIN");
  });

  test("bare welcome writes human output to stderr only", () => {
    const result = runCli([], { home: createTempHome() });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toContain("Privacy Pools");
  });

  test("--no-banner suppresses both banner art and welcome text", () => {
    const result = runCli(["--no-banner"], { home: createTempHome() });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("--help-brief and --help-full are side-effect safe help aliases", () => {
    const brief = runCli(["deposit", "--help-brief"]);
    const full = runCli(["deposit", "--help-full"]);

    expect(brief.status).toBe(0);
    expect(brief.stderr).toBe("");
    expect(brief.stdout).toContain("Usage: privacy-pools deposit");
    expect(full.status).toBe(0);
    expect(full.stderr).toBe("");
    expect(full.stdout).toContain("Safety notes");
  });

  test("--json conflicts with --output csv instead of silently choosing JSON", () => {
    const result = runCli(["pools", "--json", "--output", "csv"]);
    const json = parseJsonOutput<{ errorCode: string; error: { hint: string } }>(
      result.stdout,
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(json.errorCode).toBe("INPUT_FLAG_CONFLICT");
    expect(json.error.hint).toContain("--output csv");
  });

  test("pools list aliases route to list mode instead of asset detail", () => {
    for (const alias of ["list", "ls"]) {
      const result = runCli(["pools", alias, "--agent", "--chain", "fake-chain"]);
      const json = parseJsonOutput<{ errorCode: string }>(result.stdout);

      expect(result.status).toBe(2);
      expect(result.stderr).toBe("");
      expect(json.errorCode).toBe("INPUT_UNKNOWN_CHAIN");
    }
  });

  test("missing positionals use command-specific error codes and hints", () => {
    const deposit = runCli(["deposit", "--agent"]);
    const flow = runCli(["flow", "start", "--agent"]);
    const withdraw = runCli(["withdraw", "--agent"]);
    const poolStats = runCli(["pool-stats", "--agent"]);

    expect(parseJsonOutput<{ errorCode: string; error: { hint: string } }>(
      deposit.stdout,
    )).toEqual(expect.objectContaining({
      errorCode: "INPUT_MISSING_AMOUNT",
      error: expect.objectContaining({
        hint: expect.stringContaining("privacy-pools deposit 0.1 ETH"),
      }),
    }));
    expect(parseJsonOutput<{ errorCode: string }>(flow.stdout).errorCode).toBe(
      "INPUT_MISSING_AMOUNT",
    );
    expect(parseJsonOutput<{ errorCode: string; error: { hint: string } }>(
      withdraw.stdout,
    )).toEqual(expect.objectContaining({
      errorCode: "INPUT_MISSING_AMOUNT",
      error: expect.objectContaining({
        hint: expect.stringContaining("privacy-pools withdraw 0.05 ETH"),
      }),
    }));
    expect(parseJsonOutput<{ errorCode: string }>(
      poolStats.stdout,
    ).errorCode).toBe("INPUT_MISSING_ASSET");
  });

  test("deprecated confirmation flags emit warnings on early failures", () => {
    const withdraw = runCli([
      "withdraw",
      "0.01",
      "ETH",
      "--to",
      "0x1111111111111111111111111111111111111111",
      "--direct",
      "--confirm-direct-withdraw",
      "--agent",
    ]);
    const ragequit = runCli([
      "ragequit",
      "ETH",
      "--pool-account",
      "PA-1",
      "--confirm-ragequit",
      "--agent",
    ]);

    expect(parseJsonOutput<{
      deprecationWarning?: { code: string; replacementCommand: string };
    }>(withdraw.stdout).deprecationWarning).toEqual(
      expect.objectContaining({
        code: "FLAG_DEPRECATED",
        replacementCommand: expect.stringContaining("--confirm-direct-withdraw"),
      }),
    );
    expect(parseJsonOutput<{
      deprecationWarning?: { code: string; replacementCommand: string };
    }>(ragequit.stdout).deprecationWarning).toEqual(
      expect.objectContaining({
        code: "FLAG_DEPRECATED",
        replacementCommand: expect.stringContaining("--confirm-ragequit"),
      }),
    );
  });

  test("--web no-op warning renders as a visible callout", () => {
    const result = runCli(["status", "--no-check", "--web"], {
      home: createTempHome(),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Warning:");
    expect(result.stderr).toContain(
      "--web was requested, but this command did not provide a browser link.",
    );
  });
});
