import { describe, expect, test } from "bun:test";
import {
  cliEnvelopeSchema,
  errorEnvelopeSchema,
  successEnvelopeSchema,
} from "../../src/types/envelopes/common.ts";

describe("CLI envelope schemas", () => {
  test("accepts a success envelope with nextActions", () => {
    expect(() =>
      successEnvelopeSchema.parse({
        schemaVersion: "2.0.0",
        success: true,
        mode: "status",
        nextActions: [
          {
            command: "status",
            reason: "Verify setup.",
            when: "after_upgrade",
            cliCommand: "privacy-pools status --agent",
          },
        ],
      }),
    ).not.toThrow();
  });

  test("accepts an error envelope with canonical and deprecated aliases", () => {
    const parsed = errorEnvelopeSchema.parse({
      schemaVersion: "2.0.0",
      success: false,
      errorCode: "INPUT_FLAG_CONFLICT",
      errorMessage: "Choose either JSON or CSV output, not both.",
      meta: {
        deprecated: ["errorCode", "errorMessage", "helpTopic", "nextActions"],
      },
      error: {
        code: "INPUT_FLAG_CONFLICT",
        category: "INPUT",
        message: "Choose either JSON or CSV output, not both.",
        hint: "Use --json/--agent for JSON, or remove JSON flags and use --output csv.",
        retryable: false,
      },
    });

    expect(parsed.error.code).toBe(parsed.errorCode);
  });

  test("rejects envelopes without a success discriminator", () => {
    expect(() =>
      cliEnvelopeSchema.parse({
        schemaVersion: "2.0.0",
        mode: "status",
      }),
    ).toThrow();
  });
});
