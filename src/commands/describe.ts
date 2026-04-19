import type { Command } from "commander";
import {
  renderCommandDescription,
  renderCommandDescriptionIndex,
  renderSchemaDescription,
} from "../output/describe.js";
import { createOutputContext } from "../output/common.js";
import type { GlobalOptions } from "../types.js";
import {
  listStaticCommandPaths,
  resolveStaticCommandPath,
  STATIC_CAPABILITIES_PAYLOAD,
} from "../utils/command-discovery-static.js";
import { printError, CLIError } from "../utils/errors.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { resolveEnvelopeSchemaPath } from "../utils/describe-schema.js";

export async function handleDescribeCommand(...args: unknown[]): Promise<void> {
  const commandTokens = (args[0] as string[] | undefined) ?? [];
  const cmd = args[args.length - 1] as Command;
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  try {
    if (commandTokens.length === 0) {
      renderCommandDescriptionIndex(
        createOutputContext(mode),
        listStaticCommandPaths().map((commandPath) => {
          const descriptor = STATIC_CAPABILITIES_PAYLOAD.commandDetails[commandPath];
          return {
            command: descriptor.command,
            description: descriptor.description,
            group: descriptor.group,
          };
        }),
      );
      return;
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

function normalizeExplainPath(input: string): string {
  const trimmed = input.trim();
  return trimmed.startsWith("envelope.") ? trimmed : `envelope.${trimmed}`;
}

export async function handleExplainCommand(
  schemaPath: string,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const normalizedPath = normalizeExplainPath(schemaPath);

  try {
    const envelopeSchema = resolveEnvelopeSchemaPath(normalizedPath);
    if (envelopeSchema === undefined) {
      throw new CLIError(
        `Unknown schema path: ${schemaPath}`,
        "INPUT",
        "Use a bundled schema path such as nextActions, commands.status.successFields, or envelope.nextActions.",
      );
    }

    renderSchemaDescription(createOutputContext(mode), {
      path: normalizedPath,
      schema: envelopeSchema,
    });
  } catch (error) {
    printError(error, mode.isJson);
  }
}
