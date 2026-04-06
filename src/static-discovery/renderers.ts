import type { GlobalOptions } from "../types.js";
import { CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import { resolveGlobalMode } from "../utils/mode.js";
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
  const { guideText } = await import("../utils/help.js");

  if (mode.isJson) {
    printJsonSuccess({
      mode: "help",
      help: guideText(),
    });
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
  const commandPath = resolveStaticCommandPath(commandTokens);
  if (!commandPath) {
    throw new CLIError(
      `Unknown command path: ${commandTokens.join(" ")}`,
      "INPUT",
      `Valid command paths: ${listStaticCommandPaths().join(", ")}`,
    );
  }

  const descriptor = STATIC_CAPABILITIES_PAYLOAD.commandDetails[commandPath];
  if (mode.isJson) {
    printJsonSuccess(descriptor);
    return;
  }

  if (isQuietMode(globalOpts)) {
    return;
  }

  const { renderHumanCommandDescription } = await import(
    "../output/discovery.js"
  );
  renderHumanCommandDescription(descriptor);
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
