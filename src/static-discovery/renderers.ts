import type { GlobalOptions } from "../types.js";
import { CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { resolveGlobalMode } from "../utils/mode.js";
import {
  listEnvelopeRootKeys,
  resolveEnvelopeSchemaPath,
} from "../utils/describe-schema.js";
import { guardStaticCsvUnsupported, isQuietMode } from "./guards.js";

export async function renderStaticCapabilities(
  globalOpts: GlobalOptions,
): Promise<void> {
  guardStaticCsvUnsupported(globalOpts, "capabilities");
  const { STATIC_CAPABILITIES_PAYLOAD } = await import(
    "../utils/command-discovery-static.js"
  );
  const payload = STATIC_CAPABILITIES_PAYLOAD;
  const mode = resolveGlobalMode(globalOpts);

  if (mode.isJson) {
    printJsonSuccess(payload);
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

  const { renderHumanCapabilities } = await import("../output/discovery.js");
  renderHumanCapabilities(payload);
}

export async function renderStaticGuide(
  globalOpts: GlobalOptions,
): Promise<void> {
  guardStaticCsvUnsupported(globalOpts, "guide");
  const mode = resolveGlobalMode(globalOpts);
  const { buildGuidePayload, guideText } = await import("../utils/help.js");

  if (mode.isJson) {
    printJsonSuccess(buildGuidePayload());
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

  const { renderHumanGuideText } = await import("../output/discovery.js");
  renderHumanGuideText(guideText());
}

export async function renderStaticDescribe(
  globalOpts: GlobalOptions,
  commandTokens: string[],
): Promise<void> {
  guardStaticCsvUnsupported(globalOpts, "describe");
  const mode = resolveGlobalMode(globalOpts);
  const {
    listStaticCommandPaths,
    resolveStaticCommandPath,
    STATIC_CAPABILITIES_PAYLOAD,
  } = await import("../utils/command-discovery-static.js");
  const { createOutputContext } = await import("../output/common.js");
  const {
    renderCommandDescription,
    renderCommandDescriptionIndex,
    renderSchemaDescription,
  } = await import("../output/describe.js");
  const outputContext = createOutputContext(mode);

  if (commandTokens.length === 0) {
    const commands = listStaticCommandPaths().map((commandPath) => {
      const descriptor = STATIC_CAPABILITIES_PAYLOAD.commandDetails[commandPath];
      return {
        command: descriptor.command,
        description: descriptor.description,
        group: descriptor.group,
      };
    });
    renderCommandDescriptionIndex(
      outputContext,
      commands,
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
        `Envelope schema roots: envelope, ${listEnvelopeRootKeys()
          .map((root) => `envelope.${root}`)
          .join(", ")}`,
      );
    }

    renderSchemaDescription(outputContext, {
      path: rawPath,
      schema: envelopeSchema,
    });
    return;
  }

  const commandPath = resolveStaticCommandPath(commandTokens);
  if (commandPath) {
    renderCommandDescription(
      outputContext,
      STATIC_CAPABILITIES_PAYLOAD.commandDetails[commandPath],
    );
    return;
  }

  if (commandTokens.length === 1) {
    const normalizedSchemaPath = `envelope.${rawPath}`;
    const envelopeSchema = resolveEnvelopeSchemaPath(normalizedSchemaPath);
    if (envelopeSchema !== undefined) {
      renderSchemaDescription(outputContext, {
        path: normalizedSchemaPath,
        schema: envelopeSchema,
      });
      return;
    }
  }

  throw new CLIError(
    `Unknown command path: ${commandTokens.join(" ")}`,
    "INPUT",
    `Valid command paths: ${listStaticCommandPaths().join(", ")}. Envelope schema roots: envelope, ${listEnvelopeRootKeys()
      .map((root) => `envelope.${root}`)
      .join(", ")}`,
  );
}

export async function renderStaticRootHelp(
  isMachineMode: boolean,
): Promise<void> {
  const {
    rootHelpBaseText,
    rootHelpFooter,
    rootHelpText,
    styleCommanderHelp,
  } = await import("../utils/root-help.js");

  if (isMachineMode) {
    printJsonSuccess({
      mode: "help",
      help: rootHelpText(),
    });
    return;
  }

  process.stdout.write(
    `${styleCommanderHelp(rootHelpBaseText())}\n${rootHelpFooter()}\n`,
  );
}
