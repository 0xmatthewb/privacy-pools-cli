import jmespath from "jmespath";
import type { NextAction } from "../types.js";
import { CLIError } from "./errors.js";
import { didYouMeanMany } from "./fuzzy.js";

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
let _structuredFormat: "json" | "yaml" = "json";

function decodeTemplateEscapes(template: string): string {
  return template.replace(/\\([ntr\\])/g, (_match, code: string) => {
    switch (code) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "\\":
        return "\\";
      default:
        return `\\${code}`;
    }
  });
}

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
  structuredFormat: "json" | "yaml" = "json",
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
  _template = typeof template === "string" ? decodeTemplateEscapes(template) : null;
  _structuredFormat = structuredFormat;
}

export function resetJsonOutputConfig(): void {
  _jsonFields = null;
  _jqExpression = null;
  _template = null;
  _structuredFormat = "json";
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
    const suggestions = Object.fromEntries(
      unknownFields.map((field) => [
        field,
        didYouMeanMany(field, availableFields),
      ]),
    );
    const suggestionText = unknownFields
      .map((field) => {
        const matches = suggestions[field] ?? [];
        return matches.length > 0
          ? `${field} -> ${matches.join(", ")}`
          : null;
      })
      .filter((value): value is string => value !== null)
      .join("; ");
    throw new CLIError(
      `Unknown JSON field${unknownFields.length === 1 ? "" : "s"}: ${unknownFields.join(", ")}.`,
      "INPUT",
      suggestionText.length > 0
        ? `Available fields: ${availableFields.join(", ")}. Did you mean: ${suggestionText}?`
        : `Available fields: ${availableFields.join(", ")}.`,
      "INPUT_UNKNOWN_JSON_FIELD",
      false,
      "inline",
      { availableFields, unknownFields, suggestions },
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
  if (!trimmed || trimmed === ".") return payload;
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

function renderTemplateSection(
  template: string,
  currentPayload: unknown,
  rootPayload: unknown,
): string {
  const withSections = template.replace(
    /\{\{#\s*([^}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*\1\s*\}\}/g,
    (_match, rawPath: string, inner: string) => {
      const path = rawPath.trim();
      const sectionValue =
        templateValue(path, currentPayload) ?? templateValue(path, rootPayload);
      if (!Array.isArray(sectionValue) || sectionValue.length === 0) {
        return "";
      }
      return sectionValue
        .map((entry) => renderTemplateSection(inner, entry, rootPayload))
        .join("");
    },
  );

  return withSections.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, rawPath: string) => {
    const path = rawPath.trim();
    const value =
      templateValue(path, currentPayload) ?? templateValue(path, rootPayload);
    return stringifyTemplateValue(value);
  });
}

function yamlScalar(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string") {
    if (value.length === 0) return '""';
    if (/^[A-Za-z0-9._/@:+-]+$/.test(value)) {
      return value;
    }
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, bigintReplacer);
}

function indentMultiline(value: string, indent: number): string {
  const prefix = " ".repeat(indent);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function serializeYaml(value: unknown, indent: number = 0): string {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return yamlScalar(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((item) => {
        if (
          item === null ||
          item === undefined ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean" ||
          typeof item === "bigint"
        ) {
          return `${" ".repeat(indent)}- ${yamlScalar(item)}`;
        }
        return `${" ".repeat(indent)}-\n${indentMultiline(
          serializeYaml(item, indent + 2),
          indent + 2,
        )}`;
      })
      .join("\n");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return entries
    .map(([key, entryValue]) => {
      if (
        entryValue === null ||
        entryValue === undefined ||
        typeof entryValue === "string" ||
        typeof entryValue === "number" ||
        typeof entryValue === "boolean" ||
        typeof entryValue === "bigint"
      ) {
        return `${" ".repeat(indent)}${key}: ${yamlScalar(entryValue)}`;
      }
      return `${" ".repeat(indent)}${key}:\n${indentMultiline(
        serializeYaml(entryValue, indent + 2),
        indent + 2,
      )}`;
    })
    .join("\n");
}

function writeStructuredValue(
  value: unknown,
  pretty: boolean,
): void {
  if (_structuredFormat === "yaml") {
    process.stdout.write(`${serializeYaml(value)}\n`);
    return;
  }
  process.stdout.write(
    `${JSON.stringify(value, bigintReplacer, pretty ? 2 : 0)}\n`,
  );
}

function maybeWriteTemplateOutput(payload: Record<string, unknown>): boolean {
  if (!_template) return false;
  const rendered = renderTemplateSection(_template, payload, payload);
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
    writeStructuredValue(result ?? null, pretty);
    return;
  }

  writeStructuredValue(output, pretty);
}

export function printJsonError(
  payload: {
    code?: string;
    category: string;
    message: string;
    hint?: string;
    retryable?: boolean;
    docsSlug?: string;
    helpTopic?: string;
    nextActions?: NextAction[];
    details?: Record<string, unknown>;
  },
  pretty: boolean = false,
): void {
  const { details, helpTopic, nextActions, ...errorPayload } = payload;
  const code = payload.code ?? "UNKNOWN_ERROR";
  const errorObject = details
    ? { ...errorPayload, code, ...(helpTopic ? { helpTopic } : {}), ...(nextActions ? { nextActions } : {}), details, ...details }
    : { ...errorPayload, code, ...(helpTopic ? { helpTopic } : {}), ...(nextActions ? { nextActions } : {}) };
  // `error.code` and `error.message` are canonical. `errorCode` and
  // `errorMessage` remain v2 compatibility aliases and must match.
  const output: Record<string, unknown> = {
    schemaVersion: JSON_SCHEMA_VERSION,
    success: false,
    errorCode: code,
    errorMessage: payload.message,
    meta: {
      deprecated: ["errorCode", "errorMessage", "helpTopic", "nextActions"],
    },
    ...(helpTopic ? { helpTopic } : {}),
    ...(nextActions ? { nextActions } : {}),
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
      writeStructuredValue(result, pretty);
      return;
    }
  }

  writeStructuredValue(output, pretty);
}
