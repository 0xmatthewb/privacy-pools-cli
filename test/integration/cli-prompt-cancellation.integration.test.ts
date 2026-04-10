import { describe, expect, test } from "bun:test";
import { createTempHome, runCli } from "../helpers/cli.ts";

describe("prompt cancellation integration", () => {
  test("non-tty human init exits cleanly when the first prompt cannot open", () => {
    const home = createTempHome();
    const result = runCli(["--no-banner", "init"], {
      home,
      input: "",
      timeoutMs: 10_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("Operation cancelled.");
    expect(result.stderr).not.toContain("User force closed the prompt");
    expect(result.stderr).not.toContain("Error [UNKNOWN]");
  });
});
