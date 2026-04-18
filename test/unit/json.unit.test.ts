import { afterEach, describe, expect, test } from "bun:test";
import {
  JSON_SCHEMA_VERSION,
  configureJsonOutput,
  printJsonSuccess,
  printJsonError,
  resetJsonOutputConfig,
} from "../../src/utils/json.ts";
import { CLIError } from "../../src/utils/errors.ts";

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
  afterEach(() => {
    resetJsonOutputConfig();
  });

  test("JSON_SCHEMA_VERSION is 2.0.0", () => {
    expect(JSON_SCHEMA_VERSION).toBe("2.0.0");
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

    test("rejects unknown --json-fields with an available field catalog", () => {
      configureJsonOutput(["foo", "missing"], null);
      expect(() => {
        printJsonSuccess({ foo: "bar" });
      }).toThrow(CLIError);
      try {
        printJsonSuccess({ foo: "bar" });
      } catch (error) {
        expect(error).toBeInstanceOf(CLIError);
        expect((error as CLIError).code).toBe("INPUT_UNKNOWN_JSON_FIELD");
        expect((error as CLIError).details?.availableFields).toContain("foo");
        expect((error as CLIError).details?.availableFields).toContain("schemaVersion");
      }
    });

    test("validates --jmes expressions before output is configured", () => {
      expect(() => configureJsonOutput(null, "foo[")).toThrow(CLIError);
    });

    test("renders lightweight template output from the final success envelope", () => {
      configureJsonOutput(null, null, "{{success}} {{command}} {{group}}");

      const output = captureStdout(() => {
        printJsonSuccess({ command: "withdraw", group: "transaction" });
      });

      expect(output).toBe("true withdraw transaction\n");
    });

    test("decodes common escape sequences in --template strings before rendering", () => {
      configureJsonOutput(null, null, "{{command}}\\n{{group}}\\t\\\\done");

      const output = captureStdout(() => {
        printJsonSuccess({ command: "withdraw", group: "transaction" });
      });

      expect(output).toBe("withdraw\ntransaction\t\\done\n");
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
      expect(parsed.errorCode).toBe(parsed.error.code);
      expect(parsed.errorMessage).toBe(parsed.error.message);
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
      expect(parsed.error.code).toBe("UNKNOWN_ERROR");
    });

    test("promotes error details to top level and preserves error.details", () => {
      const output = captureStdout(() => {
        printJsonError({
          code: "INPUT_UNKNOWN_COMMAND",
          category: "INPUT",
          message: "Unknown command.",
          details: { suggestions: ["accounts", "activity"] },
        });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.suggestions).toEqual(["accounts", "activity"]);
      expect(parsed.error.suggestions).toEqual(["accounts", "activity"]);
      expect(parsed.error.details).toEqual({ suggestions: ["accounts", "activity"] });
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

    test("includes docsSlug in structured error output when provided", () => {
      const output = captureStdout(() => {
        printJsonError({
          code: "RPC_TIMEOUT",
          category: "RPC",
          message: "Timeout",
          docsSlug: "guide/troubleshooting#rpc",
        });
      });

      const parsed = JSON.parse(output.trim());
      expect(parsed.error.docsSlug).toBe("guide/troubleshooting#rpc");
    });

    test("renders lightweight template output from the final error envelope", () => {
      configureJsonOutput(null, null, "{{success}} {{error.code}} {{error.docsSlug}}");

      const output = captureStdout(() => {
        printJsonError({
          code: "RPC_TIMEOUT",
          category: "RPC",
          message: "Timeout",
          docsSlug: "reference/status#status",
        });
      });

      expect(output).toBe("false RPC_TIMEOUT reference/status#status\n");
    });
  });
});
