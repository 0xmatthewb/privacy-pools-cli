import jmespath from "jmespath";
import { CLIError } from "./errors.js";

export const JSON_SCHEMA_VERSION = "2.0.0";

export function jsonContractDocRelativePath(
  schemaVersion: string = JSON_SCHEMA_VERSION,
): string {
  return `docs/contracts/cli-json-contract.v${schemaVersion}.json`;
}

/** Safety-net replacer: converts any BigInt to string so JSON.stringify never throws. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

// ── Module-level configuration for field selection and jq filtering ──────────

let _jsonFields: string[] | null = null;
let _jqExpression: string | null = null;

/**
 * Configure global JSON output filtering.
 *
 * Called once from `resolveGlobalMode()` so that every subsequent
 * `printJsonSuccess` call applies the active filters without requiring
 * each call-site to thread options through.
 */
export function configureJsonOutput(
  jsonFields: string[] | null,
  jqExpression: string | null,
): void {
  if (jqExpression) {
    try {
      (jmespath as unknown as { compile: (query: string) => unknown })
        .compile(jqExpression);
    } catch (err) {
      throw new CLIError(
        `Invalid --jq expression: ${(err as Error).message}`,
        "INPUT",
        "Provide a valid JMESPath expression, for example: pools[0].asset or nextActions.",
        "INPUT_INVALID_JQ",
      );
    }
  }

  _jsonFields = jsonFields;
  _jqExpression = jqExpression;
}

export function resetJsonOutputConfig(): void {
  _jsonFields = null;
  _jqExpression = null;
}

/**
 * Apply --json field selection to a payload.
 *
 * Picks only the requested top-level keys from the payload object.
 * `schemaVersion` and `success` are always preserved in the envelope.
 */
function applyFieldSelection(
  payload: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const availableFields = Object.keys(payload).sort();
  const unknownFields = fields.filter((field) => !(field in payload));
  if (unknownFields.length > 0) {
    throw new CLIError(
      `Unknown JSON field${unknownFields.length === 1 ? "" : "s"}: ${unknownFields.join(", ")}.`,
      "INPUT",
      `Available fields: ${availableFields.join(", ")}.`,
      "INPUT_UNKNOWN_JSON_FIELD",
      false,
      "inline",
      { availableFields, unknownFields },
    );
  }

  const filtered: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in payload) {
      filtered[field] = payload[field];
    }
  }
  return filtered;
}

export function printJsonSuccess(
  payload: object,
  pretty: boolean = false,
): void {
  let data: Record<string, unknown> = payload as Record<string, unknown>;

  let output: Record<string, unknown> = {
    schemaVersion: JSON_SCHEMA_VERSION,
    success: true,
    ...data,
  };

  // Apply --json <fields> selection after the envelope is assembled so
  // schemaVersion/success can appear in the field catalog too.
  if (_jsonFields && _jsonFields.length > 0) {
    output = {
      schemaVersion: JSON_SCHEMA_VERSION,
      success: true,
      ...applyFieldSelection(output, _jsonFields),
    };
  }

  // Apply --jq <expression> filtering.
  if (_jqExpression) {
    let result: unknown;
    try {
      result = jmespath.search(output, _jqExpression);
    } catch (err) {
      throw new CLIError(
        `Invalid --jq expression: ${(err as Error).message}`,
        "INPUT",
        "Provide a valid JMESPath expression (e.g. '.pools[0].symbol', 'nextActions').",
      );
    }
    process.stdout.write(`${JSON.stringify(result, bigintReplacer, pretty ? 2 : 0)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(output, bigintReplacer, pretty ? 2 : 0)}\n`);
}

export function printJsonError(
  payload: {
    code?: string;
    category: string;
    message: string;
    hint?: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  },
  pretty: boolean = false,
): void {
  const { details, ...errorPayload } = payload;
  const errorObject = details
    ? { ...errorPayload, ...details }
    : errorPayload;
  // `errorCode` and `errorMessage` are convenience aliases of `error.code` and
  // `error.message`.  Agents should prefer the flattened top-level fields; the
  // nested `error` object is retained for backward compatibility and carries
  // additional fields like `hint`, `category`, and `retryable`.
  const output: Record<string, unknown> = {
    schemaVersion: JSON_SCHEMA_VERSION,
    success: false,
    errorCode: payload.code ?? "UNKNOWN_ERROR",
    errorMessage: payload.message,
    ...(details ?? {}),
    error: errorObject,
  };

  // Apply --jq to error output as well for consistent behavior.
  if (_jqExpression) {
    const result = jmespath.search(output, _jqExpression);
    if (result !== undefined) {
      process.stdout.write(`${JSON.stringify(result, bigintReplacer, pretty ? 2 : 0)}\n`);
      return;
    }
  }

  process.stdout.write(`${JSON.stringify(output, bigintReplacer, pretty ? 2 : 0)}\n`);
}
