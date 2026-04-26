import { describe, expect, test } from "bun:test";
import { createSeededHome, createTempHome, runCli } from "../helpers/cli.ts";

describe("prompt cancellation integration", () => {
  test("non-tty human init fails as missing interactive input", () => {
    const home = createTempHome();
    const result = runCli(["--no-banner", "init"], {
      home,
      input: "",
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("Error [INPUT]");
    expect(result.stderr).toContain(
      "Interactive input is required, but no terminal is available.",
    );
    expect(result.stderr).toContain(
      "Provide the required arguments or flags, or re-run from an interactive terminal.",
    );
    expect(result.stderr).not.toContain("Operation cancelled.");
    expect(result.stderr).not.toContain("User force closed the prompt");
    expect(result.stderr).not.toContain("Error [UNKNOWN]");
  });

  test("non-tty bare transaction commands exit as input errors", () => {
    const home = createSeededHome("mainnet");

    for (const command of ["deposit", "withdraw", "ragequit"]) {
      const result = runCli(["--no-banner", command], {
        home,
        input: "",
        timeoutMs: 10_000,
      });

      expect(result.status).toBe(2);
      expect(result.stdout.trim()).toBe("");
      expect(result.stderr).toContain("Error [INPUT]");
      expect(result.stderr).not.toContain("Operation cancelled.");
      expect(result.stderr).not.toContain("User force closed the prompt");
      expect(result.stderr).not.toContain("Error [UNKNOWN]");
    }
  });
});
