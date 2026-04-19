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
import {
  listEnvelopeRootKeys,
  resolveEnvelopeSchemaPath,
} from "../utils/describe-schema.js";

function envelopeRootsHint(): string {
  const rootPaths = [
    "envelope",
    ...listEnvelopeRootKeys().map((root) => `envelope.${root}`),
  ];
  return rootPaths.join(", ");
}

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
        listEnvelopeRootKeys(),
      );
      return;
    }

    const rawPath = commandTokens.join(" ").trim();
    if (rawPath === "envelope" || rawPath.startsWith("envelope.")) {
      const envelopeSchema = resolveEnvelopeSchemaPath(rawPath);
      if (envelopeSchema === undefined) {
        throw new CLIError(
          `Unknown schema path: ${rawPath}`,
          "INPUT",
          `Envelope schema roots: ${envelopeRootsHint()}`,
        );
      }

      renderSchemaDescription(createOutputContext(mode), {
        path: rawPath,
        schema: envelopeSchema,
      });
      return;
    }

    const commandPath = resolveStaticCommandPath(commandTokens);
    if (commandPath) {
      renderCommandDescription(
        createOutputContext(mode),
        STATIC_CAPABILITIES_PAYLOAD.commandDetails[commandPath],
      );
      return;
    }

    if (commandTokens.length === 1) {
      const normalizedSchemaPath = `envelope.${rawPath}`;
      const envelopeSchema = resolveEnvelopeSchemaPath(normalizedSchemaPath);
      if (envelopeSchema !== undefined) {
        renderSchemaDescription(createOutputContext(mode), {
          path: normalizedSchemaPath,
          schema: envelopeSchema,
        });
        return;
      }
    }

    throw new CLIError(
      `Unknown command path: ${commandTokens.join(" ")}`,
      "INPUT",
      `Valid command paths: ${listStaticCommandPaths().join(", ")}. Envelope schema roots: ${envelopeRootsHint()}`,
    );
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export const describeCommandTestInternals = {
  envelopeRootsHint,
};
