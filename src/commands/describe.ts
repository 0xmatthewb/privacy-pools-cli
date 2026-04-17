import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCommandDescription, renderSchemaDescription } from "../output/describe.js";
import { createOutputContext } from "../output/common.js";
import type { GlobalOptions } from "../types.js";
import {
  listStaticCommandPaths,
  resolveStaticCommandPath,
  STATIC_CAPABILITIES_PAYLOAD,
} from "../utils/command-discovery-static.js";
import { printError, CLIError } from "../utils/errors.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { jsonContractDocRelativePath } from "../utils/json.js";

function loadJsonContractDoc(): Record<string, unknown> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const contractPath = join(moduleDir, "..", "..", jsonContractDocRelativePath());
  return JSON.parse(readFileSync(contractPath, "utf8")) as Record<string, unknown>;
}

function getSchemaAtPath(
  root: unknown,
  segments: string[],
): unknown {
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

function resolveEnvelopeSchemaPath(rawPath: string): unknown {
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

export async function handleDescribeCommand(...args: unknown[]): Promise<void> {
  const commandTokens = (args[0] as string[] | undefined) ?? [];
  const cmd = args[args.length - 1] as Command;
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  try {
    if (commandTokens.length === 0) {
      throw new CLIError(
        "Missing command path for describe.",
        "INPUT",
        `Valid command paths: ${listStaticCommandPaths().join(", ")}, envelope.<path>`,
      );
    }

    const rawPath = commandTokens.join(" ").trim();
    const envelopeSchema = resolveEnvelopeSchemaPath(rawPath);
    if (envelopeSchema !== undefined) {
      renderSchemaDescription(createOutputContext(mode), {
        path: rawPath,
        schema: envelopeSchema,
      });
      return;
    }

    const commandPath = resolveStaticCommandPath(commandTokens);
    if (!commandPath) {
      throw new CLIError(
        `Unknown command path: ${commandTokens.join(" ")}`,
        "INPUT",
        `Valid command paths: ${listStaticCommandPaths().join(", ")}, envelope.<path>`,
      );
    }

    renderCommandDescription(
      createOutputContext(mode),
      STATIC_CAPABILITIES_PAYLOAD.commandDetails[commandPath],
    );
  } catch (error) {
    printError(error, mode.isJson);
  }
}
