import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonContractDocRelativePath } from "./json.js";

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

export function resolveEnvelopeSchemaPath(rawPath: string): unknown {
  const normalized = rawPath.trim();
  const contractDoc = loadJsonContractDoc();
  if (normalized === "envelope") {
    return contractDoc.envelope;
  }

  if (!normalized.startsWith("envelope.")) {
    return undefined;
  }

  const fullPathSchema = getSchemaAtPath(contractDoc, normalized.split("."));
  if (fullPathSchema !== undefined) {
    return fullPathSchema;
  }

  return getSchemaAtPath(
    contractDoc,
    normalized.slice("envelope.".length).split("."),
  );
}

