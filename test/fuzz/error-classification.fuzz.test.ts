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

  for (let i = 0; i < fuzzInputs.length; i++) {
    test(`fuzz input #${i} does not throw`, () => {
      const result = classifyError(fuzzInputs[i]);
      expect(result).toBeInstanceOf(CLIError);
      expect(VALID_CATEGORIES.has(result.category)).toBe(true);
      expect(typeof result.message).toBe("string");
      expect(typeof result.code).toBe("string");
      expect(typeof result.retryable).toBe("boolean");
    });
  }

  test("100 seeded random strings never throw", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xDEADBEEF);

    for (let i = 0; i < 100; i++) {
      const len = Math.floor(rng.nextFloat() * 200);
      const randomStr = Array.from({ length: len }, () =>
        String.fromCharCode(Math.floor(rng.nextFloat() * 128))
      ).join("");

      const result = classifyError(randomStr);
      expect(result).toBeInstanceOf(CLIError);
      expect(VALID_CATEGORIES.has(result.category)).toBe(true);
    }
  });

  test("100 seeded random Error objects never throw", () => {
    const rng = createSeededRng(getFuzzSeed() ^ 0xCAFEBABE);

    for (let i = 0; i < 100; i++) {
      const len = Math.floor(rng.nextFloat() * 200);
      const randomMsg = Array.from({ length: len }, () =>
        String.fromCharCode(Math.floor(rng.nextFloat() * 128))
      ).join("");

      const result = classifyError(new Error(randomMsg));
      expect(result).toBeInstanceOf(CLIError);
      expect(VALID_CATEGORIES.has(result.category)).toBe(true);
    }
  });
});
