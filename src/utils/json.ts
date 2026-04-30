import jmespath from "jmespath";
import type { NextAction } from "../types.js";
import type { ErrorRetryPolicy } from "./error-recovery-table.js";
import { CLIError } from "./errors.js";
import { errorDocUrl } from "./error-code-registry.js";
import { didYouMeanMany } from "./fuzzy.js";
import { peekWebOutputStatus } from "./web-output-status.js";

export const JSON_SCHEMA_VERSION = "3.0.0";

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
let _jsonEnvelopeWarnings: Record<string, unknown>[] = [];

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

function looksLikeJqSyntax(expression: string): boolean {
  const trimmed = expression.trim();
  return (
    trimmed.startsWith(".") ||
    /\|\s*(length|map|select|keys|to_entries)\b/.test(trimmed)
  );
}

function suggestJmesPathFromJq(expression: string): string | null {
  const trimmed = expression.trim();
  if (!looksLikeJqSyntax(trimmed)) return null;
  const suggestion = trimmed
    .replace(/^\.\s*/, "")
    .replace(/\|\s*length\b/g, "| length(@)")
    .replace(/\|\s*keys\b/g, "| keys(@)")
    .replace(/\|\s*to_entries\b/g, "| to_array(@)")
    .trim();
  return suggestion.length > 0 && suggestion !== trimmed ? suggestion : null;
}

function invalidJmesHint(expression: string): string {
  const jqSuggestion = suggestJmesPathFromJq(expression);
  if (jqSuggestion) {
    return `Looks like jq syntax. Try JMESPath: ${jqSuggestion}`;
  }
  return "Provide a valid --jmes expression, for example: pools[0].asset or nextActions.";
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
        invalidJmesHint(jqExpression),
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
  resetJsonEnvelopeWarnings();
}

export function configureJsonEnvelopeWarnings(
  warnings: Record<string, unknown>[],
): void {
  _jsonEnvelopeWarnings = warnings.filter((warning) => warning !== null);
}

export function resetJsonEnvelopeWarnings(): void {
  _jsonEnvelopeWarnings = [];
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
      { availableFields, availableJsonFields: availableFields, unknownFields, suggestions },
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

function assertJsonFieldSelectionIsNonEmpty(
  payload: Record<string, unknown>,
): void {
  if (_jsonFields === null || _jsonFields.length > 0) return;

  const availableFields = Object.keys(payload).sort();
  throw new CLIError(
    "Specify one or more comma-separated fields for --json.",
    "INPUT",
    `Available fields: ${availableFields.join(", ")}.`,
    "INPUT_JSON_FIELDS_REQUIRED",
    false,
    "inline",
    { availableFields, availableJsonFields: availableFields },
  );
}

function appendEnvelopeWarnings(output: Record<string, unknown>): void {
  if (_jsonEnvelopeWarnings.length === 0) return;

  const existingWarnings = Array.isArray(output.warnings)
    ? output.warnings.filter(
        (warning): warning is Record<string, unknown> =>
          typeof warning === "object" && warning !== null,
      )
    : [];
  const seenCodes = new Set(
    existingWarnings
      .map((warning) => warning.code)
      .filter((code): code is string => typeof code === "string"),
  );
  const additionalWarnings = _jsonEnvelopeWarnings.filter((warning) => {
    const code = warning.code;
    if (typeof code !== "string") return true;
    if (seenCodes.has(code)) return false;
    seenCodes.add(code);
    return true;
  });

  if (existingWarnings.length > 0 || additionalWarnings.length > 0) {
    output.warnings = [...existingWarnings, ...additionalWarnings];
  }
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

const ROOT_ENVELOPE_MODES = new Set([
  "init",
  "status",
  "guide",
  "transfer",
  "deposit",
  "withdraw",
  "ragequit",
  "accounts",
  "pools",
  "recipients",
  "tx",
  "migrate",
  "config",
  "completion",
  "upgrade",
  "capabilities",
  "describe",
]);

const LEGACY_OPERATION_MAP: Record<string, string> = {
  "init-pending": "init.handoff",
  "init-staged": "init.create",
  "tx-status": "tx.status",
  broadcast: "tx.broadcast",
  "withdraw-quote": "withdraw.quote",
  "relayed-quote": "withdraw.quote",
  "private-history": "accounts.history",
  history: "accounts.history",
  sync: "accounts.sync",
  "sync-progress": "accounts.sync",
  flow: "transfer",
  "flow-progress": "transfer",
  help: "describe.help",
  version: "status.version",
  "cli-status": "status",
  "migration-status": "migrate.status",
  "recipient-history": "recipients",
  "completion-script": "completion.script",
  "completion-query": "completion.query",
  "completion-install": "completion.install",
  direct: "withdraw",
  relayed: "withdraw",
};

const OPERATION_ROOT_MAP: Record<string, string> = {
  accounts: "accounts",
  capabilities: "capabilities",
  completion: "completion",
  config: "config",
  deposit: "deposit",
  describe: "describe",
  guide: "guide",
  init: "init",
  migrate: "migrate",
  pools: "pools",
  ragequit: "ragequit",
  recipients: "recipients",
  status: "status",
  transfer: "transfer",
  tx: "tx",
  upgrade: "upgrade",
  withdraw: "withdraw",
};

function canonicalOperationFromLegacy(
  rawOperation: string | undefined,
  rawMode: string | undefined,
  rawAction: string | undefined,
): string | undefined {
  if (rawOperation) {
    if (rawOperation === "broadcast") return "tx.broadcast";
    if (rawOperation === "tx-status") return "tx.status";
    if (rawOperation === "withdraw-quote") return "withdraw.quote";
    if (rawOperation === "history") return "accounts.history";
    if (rawOperation === "sync") return "accounts.sync";
    if (rawOperation === "flow" && rawAction) return `transfer.${rawAction}`;
    if (rawOperation.startsWith("flow.")) {
      return rawOperation.replace(/^flow\./, "transfer.");
    }
    if (rawOperation.includes(".")) return rawOperation;
    if (OPERATION_ROOT_MAP[rawOperation]) return rawOperation;
  }

  if (rawMode && ROOT_ENVELOPE_MODES.has(rawMode)) {
    return rawAction ? `${rawMode}.${rawAction}` : rawMode;
  }

  if (rawMode) {
    if (
      rawMode === "recipient-history" &&
      rawOperation &&
      ["add", "clear", "list", "remove"].includes(rawOperation)
    ) {
      return `recipients.${rawOperation}`;
    }
    const mapped = LEGACY_OPERATION_MAP[rawMode];
    if (mapped) {
      if (mapped === "transfer" && rawAction) return `transfer.${rawAction}`;
      return mapped;
    }
  }

  if (rawOperation && LEGACY_OPERATION_MAP[rawOperation]) {
    return LEGACY_OPERATION_MAP[rawOperation];
  }

  return rawOperation;
}

function applyEnvelopeMetadata(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const rawMode = typeof payload.mode === "string" ? payload.mode : undefined;
  const rawAction = typeof payload.action === "string" ? payload.action : undefined;
  const rawOperation =
    typeof payload.operation === "string" ? payload.operation : undefined;
  const operation = canonicalOperationFromLegacy(rawOperation, rawMode, rawAction);
  if (!operation) return payload;

  const [mode, ...actionParts] = operation.split(".");
  if (!mode || !ROOT_ENVELOPE_MODES.has(mode)) return payload;

  const action = actionParts.length > 0 ? actionParts.join(".") : undefined;
  const normalized: Record<string, unknown> = { ...payload };
  if (
    rawMode &&
    rawMode !== mode &&
    (rawMode === "direct" || rawMode === "relayed") &&
    normalized.withdrawMode === undefined
  ) {
    normalized.withdrawMode = rawMode;
  }
  if (rawMode === "unsigned" && normalized.unsigned === undefined) {
    normalized.unsigned = true;
  }
  normalized.mode = mode;
  if (action) {
    normalized.action = action;
  } else {
    delete normalized.action;
  }
  normalized.operation = action ? `${mode}.${action}` : mode;
  return normalized;
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
  let data: Record<string, unknown> = applyEnvelopeMetadata(
    payload as Record<string, unknown>,
  );

  let output: Record<string, unknown> = {
    schemaVersion: JSON_SCHEMA_VERSION,
    success: true,
    ...data,
  };
  const webStatus = peekWebOutputStatus();
  if (webStatus.requested && !("webOpened" in output)) {
    output.webOpened = webStatus.opened;
    output.webStatus = webStatus.opened ? "opened" : "not_opened";
  }
  appendEnvelopeWarnings(output);
  assertJsonFieldSelectionIsNonEmpty(output);

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
        invalidJmesHint(_jqExpression),
        "INPUT_INVALID_JQ",
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
    retry?: ErrorRetryPolicy;
    details?: Record<string, unknown>;
    requiredAcknowledgements?: unknown[];
  },
  pretty: boolean = false,
): void {
  const {
    details,
    docsSlug: _docsSlug,
    helpTopic,
    nextActions,
    retry,
    requiredAcknowledgements,
    ...errorPayload
  } = payload;
  void _docsSlug;
  const code = payload.code ?? "UNKNOWN_ERROR";
  const docUrl = errorDocUrl(code);
  const errorObject = details
    ? {
        ...errorPayload,
        code,
        docUrl,
        ...(helpTopic ? { helpTopic } : {}),
        ...(nextActions ? { nextActions } : {}),
        ...(retry ? { retry } : {}),
        details,
      }
    : {
        ...errorPayload,
        code,
        docUrl,
        ...(helpTopic ? { helpTopic } : {}),
        ...(nextActions ? { nextActions } : {}),
        ...(retry ? { retry } : {}),
      };
  // `error.code` and `error.message` are canonical. `errorCode` and
  // `errorMessage` remain v2 compatibility aliases and must match.
  const output: Record<string, unknown> = {
    schemaVersion: JSON_SCHEMA_VERSION,
    success: false,
    errorCode: code,
    errorMessage: payload.message,
    ...(helpTopic ? { helpTopic } : {}),
    ...(nextActions ? { nextActions } : {}),
    ...(retry ? { retry } : {}),
    ...(requiredAcknowledgements ? { requiredAcknowledgements } : {}),
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
