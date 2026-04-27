import { afterEach, describe, expect, mock, test } from "bun:test";
import jmespath from "jmespath";
import { CLIError } from "../../src/utils/errors.ts";
import {
  configureJsonOutput,
  jsonContractDocRelativePath,
  printJsonError,
  printJsonSuccess,
  resetJsonOutputConfig,
} from "../../src/utils/json.ts";
import { captureOutput, parseCapturedJson } from "../helpers/output.ts";

afterEach(() => {
  resetJsonOutputConfig();
  mock.restore();
});

describe("json utilities", () => {
  test("builds contract-doc paths and stringifies bigint success envelopes", () => {
    expect(jsonContractDocRelativePath()).toBe(
      "docs/contracts/cli-json-contract.v2.0.0.json",
    );
    expect(jsonContractDocRelativePath("9.9.9")).toBe(
      "docs/contracts/cli-json-contract.v9.9.9.json",
    );

    const { stdout, stderr } = captureOutput(() =>
      printJsonSuccess({
        operation: "demo",
        amount: 123n,
        nested: { commitment: 456n },
      }),
    );

    expect(stderr).toBe("");
    expect(parseCapturedJson(stdout)).toEqual({
      schemaVersion: "2.0.0",
      success: true,
      operation: "demo",
      amount: "123",
      nested: { commitment: "456" },
    });
  });

  test("applies field selection and fails closed on unknown fields with suggestions", () => {
    configureJsonOutput(["schemaVersion", "success", "amount"], null);
    const { stdout } = captureOutput(() =>
      printJsonSuccess({
        amount: "1000",
        chain: "mainnet",
        warnings: [],
      }),
    );
    expect(parseCapturedJson(stdout)).toEqual({
      schemaVersion: "2.0.0",
      success: true,
      amount: "1000",
    });

    configureJsonOutput(["amunt"], null);
    let error: unknown;
    try {
      printJsonSuccess({ amount: "1000", chain: "mainnet" });
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(CLIError);
    expect((error as CLIError).code).toBe("INPUT_UNKNOWN_JSON_FIELD");
    expect((error as CLIError).hint).toContain("Available fields: amount, chain");
    expect((error as CLIError).hint).toContain("amunt -> amount");
  });

  test("validates JMESPath expressions at configuration time", () => {
    let error: unknown;
    try {
      configureJsonOutput(null, "[");
    } catch (thrown) {
      error = thrown;
    }

    expect(error).toBeInstanceOf(CLIError);
    expect((error as CLIError).code).toBe("INPUT_INVALID_JQ");
    expect((error as CLIError).message).toContain(
      "Invalid JMESPath expression:",
    );
    expect((error as CLIError).hint).toBe(
      "Provide a valid --jmes expression, for example: pools[0].asset or nextActions.",
    );
  });

  test("renders templates with escapes, sections, array indexing, and object stringification", () => {
    configureJsonOutput(
      null,
      null,
      [
        "status={{ status }}\\n",
        "first={{ items.0.name }}\\n",
        "{{#items}}- {{ name }}={{ count }} meta={{ meta }}\\n{{/items}}",
      ].join(""),
    );

    const { stdout } = captureOutput(() =>
      printJsonSuccess({
        status: "ok",
        items: [
          { name: "alpha", count: 1, meta: { kind: "warm" } },
          { name: "beta", count: 2, meta: { kind: "cold" } },
        ],
      }),
    );

    expect(stdout).toContain("status=ok\nfirst=alpha\n");
    expect(stdout).toContain('- alpha=1 meta={"kind":"warm"}');
    expect(stdout).toContain('- beta=2 meta={"kind":"cold"}');
    expect(stdout.endsWith("\n")).toBe(true);
  });

  test("supports YAML output for nested arrays, objects, scalars, and empty values", () => {
    configureJsonOutput(null, null, null, "yaml");

    const { stdout } = captureOutput(() =>
      printJsonSuccess({
        command: "broadcast",
        submitted: true,
        gas: 25n,
        notes: "",
        tags: ["relayed", 2, { nested: "value here" }],
        details: {
          path: "safe/path",
          message: "contains spaces",
          retries: 3,
          enabled: false,
          nothing: null,
          emptyList: [],
          emptyObject: {},
        },
      }),
    );

    expect(stdout).toContain("schemaVersion: 2.0.0");
    expect(stdout).toContain("success: true");
    expect(stdout).toContain("command: broadcast");
    expect(stdout).toContain("submitted: true");
    expect(stdout).toContain("gas: 25");
    expect(stdout).toContain('notes: ""');
    expect(stdout).toContain("- relayed");
    expect(stdout).toContain("- 2");
    expect(stdout).toContain("nested: \"value here\"");
    expect(stdout).toContain("path: safe/path");
    expect(stdout).toContain('message: "contains spaces"');
    expect(stdout).toContain("nothing: null");
    expect(stdout).toContain("emptyList:\n      []");
    expect(stdout).toContain("emptyObject:\n      {}");
  });

  test("filters success payloads through jmespath and reports runtime filter failures cleanly", () => {
    configureJsonOutput(null, "nextActions[0].command");
    const { stdout } = captureOutput(() =>
      printJsonSuccess({
        nextActions: [{ command: "tx-status" }],
      }),
    );
    expect(JSON.parse(stdout.trim())).toBe("tx-status");

    const originalSearch = jmespath.search;
    jmespath.search = (() => {
      throw new Error("search exploded");
    }) as typeof jmespath.search;

    configureJsonOutput(null, "success");
    expect(() =>
      printJsonSuccess({ success: true }),
    ).toThrow(
      new CLIError(
        "Invalid JMESPath expression: search exploded",
        "INPUT",
        "Provide a valid --jmes expression, for example: pools[0].asset or nextActions.",
      ),
    );

    jmespath.search = originalSearch;
  });

  test("renders error envelopes with canonical aliases, detail flattening, jq fallback, and reset behavior", () => {
    configureJsonOutput(null, "error.code");
    const { stdout: filteredStdout } = captureOutput(() =>
      printJsonError({
        code: "INPUT_BAD_ADDRESS",
        category: "INPUT",
        message: "Invalid recipient",
        hint: "Provide a checksummed address.",
        retryable: false,
        helpTopic: "withdraw",
        nextActions: [
          {
            command: "withdraw",
            reason: "Retry with a corrected recipient.",
            when: "after_dry_run",
          },
        ],
        details: {
          label: "recipient",
          chain: "mainnet",
        },
      }),
    );
    expect(JSON.parse(filteredStdout.trim())).toBe("INPUT_BAD_ADDRESS");

    const originalSearch = jmespath.search;
    jmespath.search = (() => undefined) as typeof jmespath.search;
    configureJsonOutput(null, "error.code");
    const { stdout: fullStdout } = captureOutput(() =>
      printJsonError({
        category: "ASP",
        message: "Cannot reach ASP",
        details: { endpoint: "https://asp.example" },
      }),
    );
    expect(parseCapturedJson(fullStdout)).toEqual({
      schemaVersion: "2.0.0",
      success: false,
      errorCode: "UNKNOWN_ERROR",
      errorMessage: "Cannot reach ASP",
      meta: {
        deprecated: ["errorCode", "errorMessage", "helpTopic"],
      },
      endpoint: "https://asp.example",
      error: {
        category: "ASP",
        message: "Cannot reach ASP",
        code: "UNKNOWN_ERROR",
        docUrl: "https://github.com/0xmatthewb/privacy-pools-cli/blob/main/docs/errors.md#unknown-error",
        details: { endpoint: "https://asp.example" },
        endpoint: "https://asp.example",
      },
    });
    jmespath.search = originalSearch;

    resetJsonOutputConfig();
    const { stdout: resetStdout } = captureOutput(() =>
      printJsonSuccess({ command: "status" }),
    );
    expect(parseCapturedJson(resetStdout)).toEqual({
      schemaVersion: "2.0.0",
      success: true,
      command: "status",
    });
  });
});
