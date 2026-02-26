import { describe, expect, test } from "bun:test";
import {
  JSON_SCHEMA_VERSION,
  printJsonSuccess,
  printJsonError,
} from "../../src/utils/json.ts";

function captureStdout(run: () => void): string {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}

describe("JSON output helpers", () => {
  test("JSON_SCHEMA_VERSION is 1.3.0", () => {
    expect(JSON_SCHEMA_VERSION).toBe("1.3.0");
  });

  describe("printJsonSuccess", () => {
    test("emits valid JSON with schemaVersion, success: true, and spread payload", () => {
      const output = captureStdout(() => {
        printJsonSuccess({ foo: "bar", count: 42 });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(parsed.success).toBe(true);
      expect(parsed.foo).toBe("bar");
      expect(parsed.count).toBe(42);
    });

    test("with pretty=true emits indented JSON", () => {
      const output = captureStdout(() => {
        printJsonSuccess({ key: "value" }, true);
      });

      // Indented JSON contains newlines and leading spaces
      expect(output).toContain("\n");
      expect(output).toContain("  ");
      // Still valid JSON
      const parsed = JSON.parse(output.trim());
      expect(parsed.success).toBe(true);
      expect(parsed.key).toBe("value");
    });

    test("with pretty=false (default) emits compact JSON", () => {
      const output = captureStdout(() => {
        printJsonSuccess({ a: 1 });
      });

      // Compact JSON has no newlines
      expect(output.trim()).not.toContain("\n");
    });
  });

  describe("printJsonError", () => {
    test("emits valid JSON with success: false, errorCode, errorMessage, and error object", () => {
      const output = captureStdout(() => {
        printJsonError({
          code: "INPUT_INVALID",
          category: "INPUT",
          message: "Bad input",
          hint: "Check your args",
          retryable: false,
        });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(parsed.success).toBe(false);
      expect(parsed.errorCode).toBe("INPUT_INVALID");
      expect(parsed.errorMessage).toBe("Bad input");
      expect(parsed.error).toEqual({
        code: "INPUT_INVALID",
        category: "INPUT",
        message: "Bad input",
        hint: "Check your args",
        retryable: false,
      });
    });

    test("defaults errorCode to UNKNOWN_ERROR when code is undefined", () => {
      const output = captureStdout(() => {
        printJsonError({ category: "UNKNOWN", message: "Something broke" });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.errorCode).toBe("UNKNOWN_ERROR");
    });

    test("uses provided code when present", () => {
      const output = captureStdout(() => {
        printJsonError({
          code: "RPC_TIMEOUT",
          category: "RPC",
          message: "Timeout",
        });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.errorCode).toBe("RPC_TIMEOUT");
    });

    test("with pretty=true emits indented JSON", () => {
      const output = captureStdout(() => {
        printJsonError(
          { category: "INPUT", message: "err" },
          true
        );
      });

      expect(output).toContain("\n");
      expect(output).toContain("  ");
      const parsed = JSON.parse(output.trim());
      expect(parsed.success).toBe(false);
    });
  });
});
