import { describe, expect, test } from "bun:test";
import { createSeededHome, parseJsonOutput, runCli } from "../helpers/cli.ts";

describe("stdout/stderr stream separation", () => {
  test("JSON success goes to stdout only", () => {
    const result = runCli(["--json", "status"], {
      home: createSeededHome("sepolia"),
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{ success: boolean }>(result.stdout);
    expect(json.success).toBe(true);
    expect(result.stderr.trim()).toBe("");
  });

  test("JSON errors stay on stdout only", () => {
    const result = runCli(["--json", "deposit", "0.1", "--yes"], {
      home: createSeededHome("sepolia"),
    });
    expect(result.status).toBe(2);

    const json = parseJsonOutput<{ success: boolean }>(result.stdout);
    expect(json.success).toBe(false);
    expect(result.stderr.trim()).toBe("");
  });

  test("human-mode errors stay on stderr only", () => {
    const result = runCli(["deposit", "0.1", "--yes"], {
      home: createSeededHome("sepolia"),
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Error");
    expect(result.stdout.trim()).toBe("");
  });

  test("human-mode success output stays on stderr for status", () => {
    const result = runCli(["--no-banner", "status"], {
      home: createSeededHome("sepolia"),
      timeoutMs: 60_000,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Privacy Pools CLI Status");
    expect(result.stdout.trim()).toBe("");
  });
});
