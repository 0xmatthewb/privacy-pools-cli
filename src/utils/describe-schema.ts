import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonContractDocRelativePath } from "./json.js";

const CONTRACT_METADATA_KEYS = new Set([
  "name",
  "version",
  "schemaVersion",
  "description",
]);

const ENVELOPE_ALIAS_PATHS: Record<string, string> = {
  nextActions: "shared.nextAction",
};

function loadJsonContractDoc(): Record<string, unknown> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const contractPath = join(moduleDir, "..", "..", jsonContractDocRelativePath());
  return JSON.parse(readFileSync(contractPath, "utf8")) as Record<string, unknown>;
}

function getSchemaAtPath(root: unknown, segments: string[]): unknown {
  let current = root;
  for (const segment of segments) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      !(segment in (current as Record<string, unknown>))
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeContractToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function resolveEnvelopeAliasPath(
  contractDoc: Record<string, unknown>,
  path: string,
): unknown {
  const aliasPath = ENVELOPE_ALIAS_PATHS[path];
  if (!aliasPath) {
    return undefined;
  }

  return getSchemaAtPath(contractDoc, aliasPath.split("."));
}

export function resolveEnvelopeSchemaPath(rawPath: string): unknown {
  const normalized = rawPath.trim();
  const contractDoc = loadJsonContractDoc();
  if (normalized === "envelope") {
    return contractDoc.envelope;
  }

  if (!normalized.startsWith("envelope.")) {
    return undefined;
  }

  const envelopePath = normalized.slice("envelope.".length);
  if (envelopePath.length === 0) {
    return contractDoc.envelope;
  }

  const fullPathSchema = getSchemaAtPath(contractDoc, normalized.split("."));
  if (fullPathSchema !== undefined) {
    return fullPathSchema;
  }

  const directSchema = getSchemaAtPath(
    contractDoc,
    envelopePath.split("."),
  );
  if (directSchema !== undefined) {
    return directSchema;
  }

  return resolveEnvelopeAliasPath(contractDoc, envelopePath);
}

export function listEnvelopeRootKeys(): string[] {
  const contractDoc = loadJsonContractDoc();
  const roots = new Set<string>(Object.keys(ENVELOPE_ALIAS_PATHS));

  if (isRecord(contractDoc.envelope)) {
    for (const key of Object.keys(contractDoc.envelope)) {
      roots.add(key);
    }
  }

  for (const key of Object.keys(contractDoc)) {
    if (CONTRACT_METADATA_KEYS.has(key) || key === "envelope") {
      continue;
    }
    roots.add(key);
  }

  return [...roots].sort((left, right) => left.localeCompare(right));
}

export function listRelatedEnvelopePaths(commandPath: string): string[] {
  const contractDoc = loadJsonContractDoc();
  const commandSchemas = contractDoc.commands;
  if (!isRecord(commandSchemas)) {
    return [];
  }

  const rootCommand = commandPath.split(/\s+/, 1)[0] ?? commandPath;
  const schemaKey = commandPath in commandSchemas ? commandPath : rootCommand;
  const schemaRoot = commandSchemas[schemaKey];
  if (!isRecord(schemaRoot)) {
    return [];
  }

  const basePath = `envelope.commands.${schemaKey}`;
  const childPaths = Object.entries(schemaRoot)
    .filter(([, value]) => isRecord(value))
    .map(([key]) => `${basePath}.${key}`);
  if (childPaths.length === 0) {
    return [basePath];
  }

  const trailingTokens = commandPath
    .split(/\s+/)
    .slice(1)
    .map(normalizeContractToken)
    .filter(Boolean);
  if (trailingTokens.length === 0) {
    return childPaths;
  }

  const matchingPaths = childPaths.filter((path) => {
    const normalizedPath = normalizeContractToken(path);
    return trailingTokens.every((token) => normalizedPath.includes(token));
  });

  return matchingPaths.length > 0 ? matchingPaths : childPaths;
}
