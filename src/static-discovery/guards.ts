import type { GlobalOptions } from "../types.js";
import { CLIError } from "../utils/errors.js";
import {
  invalidOutputFormatMessage,
  isSupportedOutputFormat,
  resolveGlobalMode,
} from "../utils/mode.js";
import { parseRootArgv, type ParsedRootArgv } from "../utils/root-argv.js";

export function staticGlobalOptsFromParsedRootArgv(
  parsed: ParsedRootArgv,
  preludeGlobalOpts?: GlobalOptions,
): GlobalOptions {
  return {
    json: preludeGlobalOpts?.json ?? (parsed.isJson || undefined),
    agent: parsed.isAgent || undefined,
    quiet: parsed.isQuiet || undefined,
    output: parsed.formatFlagValue ?? undefined,
    noHeader: preludeGlobalOpts?.noHeader,
    jsonFields: preludeGlobalOpts?.jsonFields,
    jq: preludeGlobalOpts?.jq,
    jmes: preludeGlobalOpts?.jmes,
    template: preludeGlobalOpts?.template,
  };
}

export function fallbackJsonModeFromArgv(argv: string[]): boolean {
  return parseRootArgv(argv).isStructuredOutputMode;
}

export function isQuietMode(globalOpts: GlobalOptions): boolean {
  const mode = resolveGlobalMode(globalOpts);
  return mode.isQuiet || mode.isJson || mode.isCsv;
}

export function assertSupportedOutputFormat(globalOpts: GlobalOptions): void {
  if (
    globalOpts.output !== undefined &&
    !isSupportedOutputFormat(globalOpts.output)
  ) {
    throw new CLIError(
      invalidOutputFormatMessage(globalOpts.output),
      "INPUT",
      "Use --help to see usage and examples.",
    );
  }
}

export function guardStaticCsvUnsupported(
  globalOpts: GlobalOptions,
  commandName: string,
): void {
  if (resolveGlobalMode(globalOpts).isCsv) {
    throw new CLIError(
      `--output csv is not supported for '${commandName}'.`,
      "INPUT",
      "CSV output is available for: pools, accounts, activity, stats, history.",
    );
  }
}
