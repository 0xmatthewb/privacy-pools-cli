import { describe, expect, test } from "bun:test";
import { classifyError, CLIError } from "../../src/utils/errors.ts";
import { createSeededRng, getFuzzSeed } from "../helpers/fuzz.ts";

/**
 * Fuzz test: classifyError should never throw, regardless of input.
 * It must always return a CLIError with a valid category.
 */
describe("error classification fuzz", () => {
  const VALID_CATEGORIES = new Set([
    "INPUT",
    "RPC",
    "ASP",
    "RELAYER",
    "PROOF",
    "CONTRACT",
    "UNKNOWN",
  ]);

  const fuzzInputs: unknown[] = [
    // Primitives
    null,
    undefined,
    0,
    -1,
    NaN,
    Infinity,
    -Infinity,
    "",
    "random string",
    true,
    false,
    42n,
    // Objects
    {},
    { code: null },
    { code: undefined },
    { code: 42 },
    { code: "" },
    { code: "UNKNOWN_CODE" },
    { message: "something" },
    { code: "MERKLE_ERROR" },
    { code: "PROOF_GENERATION_FAILED" },
    { code: "PROOF_VERIFICATION_FAILED" },
    // Arrays
    [],
    [1, 2, 3],
    ["error"],
    // Error subclasses
    new Error("plain error"),
    new TypeError("type error"),
    new RangeError("range error"),
    new CLIError("cli error", "INPUT"),
    new CLIError("retry error", "RPC", "hint", "CODE", true),
    // Error-like objects
    { name: "Error", message: "fake error" },
    { stack: "fake stack" },
    // Network-like strings
    "fetch failed",
    "ECONNREFUSED",
    "timeout exceeded",
    "connect ETIMEDOUT",
    // Contract revert strings
    new Error("execution reverted: NullifierAlreadySpent"),
    new Error("execution reverted: UnknownCustomRevert"),
    new Error("NullifierAlreadySpent()"),
    // Nested objects
    { code: "MERKLE_ERROR", nested: { deep: true } },
    // Functions
    () => "function",
    // Regex
    /pattern/,
    // Date
    new Date(),
    // Map and Set
    new Map(),
    new Set(),
  ];

  function expectValidCliError(result: CLIError): void {
    expect(result).toBeInstanceOf(CLIError);
    expect(VALID_CATEGORIES.has(result.category)).toBe(true);
    expect(typeof result.message).toBe("string");
    expect(typeof result.code).toBe("string");
    expect(result.code.length).toBeGreaterThan(0);
    expect(typeof result.retryable).toBe("boolean");
  }

  test("representative weird inputs classify into stable CLIError envelopes", () => {
    for (const input of fuzzInputs) {
      const result = classifyError(input);
      expectValidCliError(result);
      expect(classifyError(result)).toBe(result);
    }
  });

  test("representative known signals keep their exact machine contract", () => {
    const expectations: Array<{
      input: unknown;
      category: string;
      code: string;
      retryable: boolean;
    }> = [
      { input: "timeout exceeded", category: "RPC", code: "RPC_NETWORK_ERROR", retryable: true },
      { input: "429 rate limit", category: "RPC", code: "RPC_RATE_LIMITED", retryable: true },
      {
        input: new Error("execution reverted: NullifierAlreadySpent"),
        category: "CONTRACT",
        code: "CONTRACT_NULLIFIER_ALREADY_SPENT",
        retryable: false,
      },
      { input: { code: "MERKLE_ERROR" }, category: "PROOF", code: "PROOF_MERKLE_ERROR", retryable: true },
      {
        input: { code: "PROOF_GENERATION_FAILED" },
        category: "PROOF",
        code: "PROOF_GENERATION_FAILED",
        retryable: false,
      },
      {
        input: { code: "PROOF_VERIFICATION_FAILED" },
        category: "PROOF",
        code: "PROOF_VERIFICATION_FAILED",
        retryable: false,
      },
    ];

    for (const expectation of expectations) {
      const result = classifyError(expectation.input);
      expectValidCliError(result);
      expect(result.category).toBe(expectation.category);
      expect(result.code).toBe(expectation.code);
      expect(result.retryable).toBe(expectation.retryable);
    }
  });

  test("seeded random strings stay machine-safe", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xDEADBEEF);

    for (let i = 0; i < 64; i++) {
      const len = Math.floor(rng.nextFloat() * 200);
      const randomStr = Array.from({ length: len }, () =>
        String.fromCharCode(Math.floor(rng.nextFloat() * 128))
      ).join("");

      const result = classifyError(randomStr);
      expectValidCliError(result);
    }
  });

  test("seeded random Error objects stay machine-safe", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xCAFEBABE);

    for (let i = 0; i < 64; i++) {
      const len = Math.floor(rng.nextFloat() * 200);
      const randomMsg = Array.from({ length: len }, () =>
        String.fromCharCode(Math.floor(rng.nextFloat() * 128))
      ).join("");

      const result = classifyError(new Error(randomMsg));
      expectValidCliError(result);
    }
  });
});
