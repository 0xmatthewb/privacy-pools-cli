import { describe, expect, test } from "bun:test";
import {
  classifyError,
  CLIError,
  EXIT_CODES,
  exitCodeForCategory,
} from "../../src/utils/errors.ts";

describe("error classification", () => {
  test("preserves CLIError instances", () => {
    const err = new CLIError("x", "INPUT", "hint");
    expect(classifyError(err)).toBe(err);
  });

  test("maps known contract reverts", () => {
    const mapped = classifyError(
      new Error("execution reverted: NullifierAlreadySpent")
    );
    expect(mapped.category).toBe("CONTRACT");
    expect(mapped.code).toBe("CONTRACT_NULLIFIER_ALREADY_SPENT");
    expect(mapped.message.toLowerCase()).toContain("already");
  });

  test("maps sdk merkle error code", () => {
    const mapped = classifyError({ code: "MERKLE_ERROR" });
    expect(mapped.category).toBe("PROOF");
    expect(mapped.code).toBe("PROOF_MERKLE_ERROR");
    expect(mapped.retryable).toBe(true);
  });

  test("maps sdk proof generation error code", () => {
    const mapped = classifyError({ code: "PROOF_GENERATION_FAILED" });
    expect(mapped.category).toBe("PROOF");
  });

  test("maps network-looking errors to RPC", () => {
    const mapped = classifyError(new Error("fetch failed: timeout"));
    expect(mapped.category).toBe("RPC");
    expect(mapped.code).toBe("RPC_NETWORK_ERROR");
    expect(mapped.retryable).toBe(true);
  });

  test("falls back to UNKNOWN", () => {
    const mapped = classifyError(new Error("some random issue"));
    expect(mapped.category).toBe("UNKNOWN");
  });

  test("exit code map is explicit and stable", () => {
    expect(EXIT_CODES).toEqual({
      UNKNOWN: 1,
      INPUT: 2,
      RPC: 3,
      ASP: 4,
      RELAYER: 5,
      PROOF: 6,
      CONTRACT: 7,
    });

    expect(exitCodeForCategory("INPUT")).toBe(2);
    expect(exitCodeForCategory("RPC")).toBe(3);
    expect(exitCodeForCategory("ASP")).toBe(4);
    expect(exitCodeForCategory("RELAYER")).toBe(5);
    expect(exitCodeForCategory("PROOF")).toBe(6);
    expect(exitCodeForCategory("CONTRACT")).toBe(7);
    expect(exitCodeForCategory("UNKNOWN")).toBe(1);
  });
});
