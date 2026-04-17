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
let _template: string | null = null;

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
  template: string | null = null,
): void {
  if (jqExpression) {
    try {
      (jmespath as unknown as { compile: (query: string) => unknown })
        .compile(jqExpression);
    } catch (err) {
      throw new CLIError(
        `Invalid JMESPath expression: ${(err as Error).message}`,
        "INPUT",
        "Provide a valid --jmes expression, for example: pools[0].asset or nextActions.",
        "INPUT_INVALID_JQ",
      );
    }
  }

  _jsonFields = jsonFields;
  _jqExpression = jqExpression;
  _template = template;
}

export function resetJsonOutputConfig(): void {
  _jsonFields = null;
  _jqExpression = null;
  _template = null;
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

function templateValue(path: string, payload: unknown): unknown {
  const trimmed = path.trim();
  if (!trimmed) return "";
  return trimmed.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    if (
      typeof current === "object" &&
      segment in (current as Record<string, unknown>)
    ) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, payload);
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return JSON.stringify(value, bigintReplacer);
}

function maybeWriteTemplateOutput(payload: Record<string, unknown>): boolean {
  if (!_template) return false;
  const rendered = _template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) =>
    stringifyTemplateValue(templateValue(path, payload)),
  );
  process.stdout.write(`${rendered}\n`);
  return true;
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

  if (maybeWriteTemplateOutput(output)) {
    return;
  }

  // Apply --jq <expression> filtering.
  if (_jqExpression) {
    let result: unknown;
    try {
      result = jmespath.search(output, _jqExpression);
    } catch (err) {
      throw new CLIError(
        `Invalid JMESPath expression: ${(err as Error).message}`,
        "INPUT",
        "Provide a valid --jmes expression, for example: pools[0].asset or nextActions.",
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
    docsSlug?: string;
    details?: Record<string, unknown>;
  },
  pretty: boolean = false,
): void {
  const { details, ...errorPayload } = payload;
  const code = payload.code ?? "UNKNOWN_ERROR";
  const errorObject = details
    ? { ...errorPayload, code, details, ...details }
    : { ...errorPayload, code };
  // `error.code` and `error.message` are canonical. `errorCode` and
  // `errorMessage` remain v2 compatibility aliases and must match.
  const output: Record<string, unknown> = {
    schemaVersion: JSON_SCHEMA_VERSION,
    success: false,
    errorCode: code,
    errorMessage: payload.message,
    ...(details ?? {}),
    error: errorObject,
  };

  // Apply --jq to error output as well for consistent behavior.
  if (maybeWriteTemplateOutput(output)) {
    return;
  }

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
