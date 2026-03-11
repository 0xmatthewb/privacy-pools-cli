import { describe, expect, test } from "bun:test";
import { createTempHome, parseJsonOutput, runCli } from "../helpers/cli.ts";

describe("completion command", () => {
  const BANNER_SENTINEL = " ,---.  ,---.";

  test("completion bash emits a bash completion script", () => {
    const result = runCli(["completion", "bash"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("_privacy_pools_completion");
    expect(result.stdout).toContain("complete -o default -F _privacy_pools_completion privacy-pools");
    expect(result.stderr).not.toContain(BANNER_SENTINEL);
  });

  test("completion zsh emits a zsh completion script", () => {
    const result = runCli(["completion", "zsh"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("#compdef privacy-pools");
    expect(result.stdout).toContain("compdef _privacy_pools_completion privacy-pools");
    expect(result.stderr).not.toContain(BANNER_SENTINEL);
  });

  test("completion fish emits a fish completion script", () => {
    const result = runCli(["completion", "fish"], { home: createTempHome() });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("function __fish_privacy_pools_complete");
    expect(result.stdout).toContain("complete -c privacy-pools -f -a \"(__fish_privacy_pools_complete)\"");
    expect(result.stderr).not.toContain(BANNER_SENTINEL);
  });

  test("completion --help hides internal query arguments", () => {
    const result = runCli(["completion", "--help"], { home: createTempHome() });
    expect(result.status).toBe(0);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).not.toContain("Internal: shell words for completion query");
    expect(combined).not.toContain("--query");
    expect(combined).not.toContain("--cword");
  });

  test("--json completion returns shell and script payload", () => {
    const result = runCli(["--json", "completion", "zsh"], { home: createTempHome() });
    expect(result.status).toBe(0);
    const parsed = parseJsonOutput<{
      schemaVersion: string;
      success: boolean;
      mode: string;
      shell: string;
      completionScript: string;
    }>(result.stdout);

    expect(parsed.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.success).toBe(true);
    expect(parsed.mode).toBe("completion-script");
    expect(parsed.shell).toBe("zsh");
    expect(parsed.completionScript).toContain("compdef _privacy_pools_completion privacy-pools");
  });

  test("query mode returns top-level command candidates", () => {
    const result = runCli(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "privacy-pools",
      ],
      { home: createTempHome() }
    );

    expect(result.status).toBe(0);
    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines).toContain("init");
    expect(lines).toContain("completion");
    expect(lines).toContain("exit");
    expect(lines).toContain("-j");
    expect(lines).toContain("--json");
    expect(lines).toContain("--agent");
    expect(lines).toContain("--quiet");
    expect(lines).toContain("--verbose");
    expect(lines).toContain("--no-banner");
    expect(lines).toContain("--rpc-url");
  });

  test("query mode suggests chain values after --chain", () => {
    const result = runCli(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "2",
        "--",
        "privacy-pools",
        "--chain",
        "",
      ],
      { home: createTempHome() }
    );

    expect(result.status).toBe(0);
    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines).toContain("mainnet");
    expect(lines).toContain("sepolia");
  });

  test("query mode includes Pool Account short alias for withdraw", () => {
    const result = runCli(
      [
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "2",
        "--",
        "privacy-pools",
        "withdraw",
        "",
      ],
      { home: createTempHome() }
    );

    expect(result.status).toBe(0);
    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines).toContain("-p");
    expect(lines).toContain("--from-pa");
  });

  test("unsupported shell returns INPUT error", () => {
    const plain = runCli(["completion", "tcsh"], { home: createTempHome() });
    expect(plain.status).toBe(2);
    expect(plain.stderr).toContain("Unsupported shell");

    const machine = runCli(["--json", "completion", "tcsh"], { home: createTempHome() });
    expect(machine.status).toBe(2);
    const parsed = parseJsonOutput<{
      success: boolean;
      error: { category: string; code: string };
    }>(machine.stdout);
    expect(parsed.success).toBe(false);
    expect(parsed.error.category).toBe("INPUT");
    expect(parsed.error.code).toBe("INPUT_ERROR");
  });
});
