import type { Command } from "commander";
import { join } from "path";
import { resolveConfigHome } from "./config-paths.js";
import { printJsonSuccess } from "../utils/json.js";
import { CLIError } from "../utils/errors.js";
import {
  GENERATED_COMMAND_ALIAS_MAP,
  GENERATED_COMMAND_PATHS,
  GENERATED_STATIC_LOCAL_COMMANDS,
} from "../utils/command-routing-static.js";
import { didYouMeanMany } from "../utils/fuzzy.js";

function normalizeRepositoryUrl(repository: unknown): string | null {
  const raw =
    typeof repository === "string"
      ? repository
      : typeof repository === "object" &&
          repository !== null &&
          "url" in repository &&
          typeof (repository as { url?: unknown }).url === "string"
        ? (repository as { url: string }).url
        : null;

  if (!raw) return null;

  return raw
    .replace(/^git\+/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\/git@/, "")
    .replace(/^git@github\.com:/, "github.com/")
    .replace(/\.git$/, "");
}

const STATIC_LOCAL_COMMANDS = new Set<string>(GENERATED_STATIC_LOCAL_COMMANDS);

async function maybeLoadConfigEnv(
  firstCommandToken: string | undefined,
  isHelpLike: boolean,
  isVersionLike: boolean,
  isWelcome: boolean,
): Promise<void> {
  const shouldLoadEnv =
    !isHelpLike &&
    !isVersionLike &&
    !isWelcome &&
    !STATIC_LOCAL_COMMANDS.has(firstCommandToken ?? "");

  if (!shouldLoadEnv) return;

  // Load .env from the config directory (~/.privacy-pools/.env), not CWD.
  // Loading from CWD would let a malicious .env in a cloned repo silently
  // redirect RPC/ASP/relayer endpoints or swap the signer key.
  const { config: loadEnv } = await import("dotenv");
  loadEnv({ path: join(resolveConfigHome(), ".env") });
}

function mapCommanderError(error: unknown): CLIError | null {
  return mapCommanderErrorWithContext(error);
}

function buildUnknownCommandError(unknownCommand: string): CLIError {
  const candidates = [
    ...GENERATED_COMMAND_PATHS,
    ...Object.keys(GENERATED_COMMAND_ALIAS_MAP),
  ];
  const suggestions = unknownCommand
    ? didYouMeanMany(unknownCommand, candidates)
    : [];
  return new CLIError(
    unknownCommand
      ? `Unknown command '${unknownCommand}'.`
      : "Unknown command.",
    "INPUT",
    suggestions.length > 0
      ? `Did you mean ${suggestions.map((candidate) => `'${candidate}'`).join(", ")}?`
      : "Use --help to see usage and examples.",
    "INPUT_UNKNOWN_COMMAND",
    false,
    "inline",
    { suggestions },
  );
}

function isKnownCommanderHelpTarget(token: string | undefined): boolean {
  if (!token) return false;
  return GENERATED_COMMAND_PATHS.some(
    (path) => path === token || path.startsWith(`${token} `),
  ) || token in GENERATED_COMMAND_ALIAS_MAP;
}

function commanderUnknownOptionHint(
  normalized: string,
  context?: { rootCommand?: string },
): string {
  const unknownOptionMatch = normalized.match(/unknown option ['"]?(--[a-z0-9-]+)['"]?/i);
  const unknownOption = unknownOptionMatch?.[1]?.toLowerCase();

  if (unknownOption === "--pool" && context?.rootCommand === "deposit") {
    return "Use positional asset syntax instead: privacy-pools deposit <amount> <asset>.";
  }

  if (unknownOption === "--asset") {
    switch (context?.rootCommand) {
      case "deposit":
      case "withdraw":
      case "ragequit":
      case "activity":
        return "Use the asset as a positional argument instead of --asset.";
      case "stats":
        return "Use the asset as the positional argument to 'pool-stats <asset>' instead of --asset.";
      default:
        return "Use the asset as a positional argument instead of --asset.";
    }
  }

  return "Use --help to see usage and examples.";
}

function commandSpecificMissingArgumentError(
  normalized: string,
  context?: { rootCommand?: string },
): CLIError | null {
  const missingMatch = normalized.match(
    /missing (?:required )?argument ['"]?<?([^>'"]+)>?['"]?/i,
  );
  const missingName = missingMatch?.[1]?.toLowerCase();
  if (!missingName) return null;

  if (context?.rootCommand === "deposit" && missingName === "amount") {
    return new CLIError(
      "Missing amount. Specify an amount to deposit.",
      "INPUT",
      "Example: privacy-pools deposit 0.1 ETH",
      "INPUT_MISSING_AMOUNT",
    );
  }

  if (context?.rootCommand === "flow") {
    if (missingName === "amount") {
      return new CLIError(
        "Missing amount. Specify an amount for the flow deposit.",
        "INPUT",
        "Example: privacy-pools flow start 0.1 ETH --to 0xRecipient",
        "INPUT_MISSING_AMOUNT",
      );
    }
    if (missingName === "asset") {
      return new CLIError(
        "Missing asset. Specify the pool asset for the flow deposit.",
        "INPUT",
        "Example: privacy-pools flow start 0.1 ETH --to 0xRecipient",
        "INPUT_MISSING_ASSET",
      );
    }
  }

  if (context?.rootCommand === "pool-stats" && missingName === "asset") {
    return new CLIError(
      "Missing asset argument.",
      "INPUT",
      "Example: privacy-pools pool-stats ETH",
      "INPUT_MISSING_ASSET",
    );
  }

  return null;
}

function mapCommanderErrorWithContext(
  error: unknown,
  context?: { rootCommand?: string },
): CLIError | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    typeof (error as { code: unknown }).code !== "string"
  ) {
    return null;
  }

  const code = (error as { code: string }).code;
  const rawMessage = (error as { message?: unknown }).message;
  const message =
    typeof rawMessage === "string" ? rawMessage : "Invalid command input.";

  if (code.startsWith("commander.")) {
    const normalized = message.replace(/^error:\s*/i, "").trim();
    const unknownCommandMatch = normalized.match(/unknown command ['"]?([^'"]+)['"]?/i);
    if (code === "commander.unknownCommand" || unknownCommandMatch) {
      const unknownCommand = unknownCommandMatch?.[1] ?? "";
      return buildUnknownCommandError(unknownCommand);
    }
    const errorCode =
      code === "commander.missingArgument" ||
      /missing required|missing argument/i.test(normalized)
        ? "INPUT_MISSING_ARGUMENT"
        : code === "commander.unknownOption" ||
            /unknown option/i.test(normalized)
          ? "INPUT_UNKNOWN_OPTION"
          : code === "commander.invalidArgument" ||
              /invalid argument|invalid value/i.test(normalized)
            ? "INPUT_INVALID_VALUE"
            : "INPUT_PARSE_ERROR";
    if (errorCode === "INPUT_MISSING_ARGUMENT") {
      const commandSpecific = commandSpecificMissingArgumentError(
        normalized,
        context,
      );
      if (commandSpecific) return commandSpecific;
    }

    return new CLIError(
      normalized || "Invalid command input.",
      "INPUT",
      errorCode === "INPUT_UNKNOWN_OPTION"
        ? commanderUnknownOptionHint(normalized, context)
        : "Use --help to see usage and examples.",
      errorCode,
    );
  }

  return null;
}

function shouldStartUpdateCheck(
  firstCommandToken: string | undefined,
  isWelcome: boolean,
  isMachineMode: boolean,
  isQuiet: boolean,
  isHelpLike: boolean,
  isVersionLike: boolean,
): boolean {
  if (isMachineMode || isQuiet || isVersionLike) return false;
  if (isHelpLike) return false;
  if (!isWelcome) return false;
  if (STATIC_LOCAL_COMMANDS.has(firstCommandToken ?? "")) return false;
  if (!process.stdout.isTTY || !process.stderr.isTTY) return false;
  if (process.env.CI || process.env.CODESPACES) return false;
  return true;
}

export interface MachineOutputBuffer {
  value: string;
}

export interface CommanderOutputOptions {
  captureMachineOutput: boolean;
  isWelcome: boolean;
  isMachineMode: boolean;
  styleCommanderHelp: ((value: string) => string) | null;
  dangerTone: ((value: string) => string) | null;
  machineOutput: MachineOutputBuffer;
}

function configureCommanderOutput(
  program: Command,
  options: CommanderOutputOptions,
): void {
  const {
    captureMachineOutput,
    isWelcome,
    styleCommanderHelp,
    machineOutput,
  } = options;

  program.configureOutput({
    writeOut: (str: string) => {
      if (captureMachineOutput) {
        machineOutput.value += str;
        return;
      }
      if (isWelcome) return;
      const styled = styleCommanderHelp ? styleCommanderHelp(str) : str;
      process.stdout.write(styled);
    },
    writeErr: () => {},
    // Commander parse errors are rendered through the CLIError envelope in the
    // outer catch path, so suppress the stock error text here to avoid dupes.
    outputError: () => {},
  });

  for (const sub of program.commands) {
    configureCommanderOutput(sub as Command, options);
  }
}

function applyMachineMode(
  cmd: Command,
  options: Pick<
    CommanderOutputOptions,
    "captureMachineOutput" | "styleCommanderHelp" | "machineOutput"
  >,
): void {
  cmd.showSuggestionAfterError(false);
  cmd.showHelpAfterError(false);
  cmd.configureOutput({
    writeOut: (str: string) => {
      if (options.captureMachineOutput) {
        options.machineOutput.value += str;
        return;
      }
      const styled = options.styleCommanderHelp
        ? options.styleCommanderHelp(str)
        : str;
      process.stdout.write(styled);
    },
    writeErr: () => {},
    outputError: () => {},
  });
  cmd.exitOverride();

  for (const sub of cmd.commands) {
    applyMachineMode(sub as Command, options);
  }
}

function applyHelpStyling(
  cmd: Command,
  styleHelp: (value: string) => string,
): void {
  const prev = cmd.configureOutput();
  const prevWriteErr = prev?.writeErr;
  const prevOutputError = prev?.outputError;
  cmd.configureOutput({
    writeOut: (str: string) => {
      process.stdout.write(styleHelp(str));
    },
    writeErr: prevWriteErr ?? ((str: string) => process.stderr.write(str)),
    outputError: prevOutputError ?? ((str: string, write: (s: string) => void) => write(str)),
  });

  for (const sub of cmd.commands) {
    applyHelpStyling(sub as Command, styleHelp);
  }
}

function emitStructuredRootHelpIfNeeded(
  program: Pick<Command, "helpInformation">,
  options: {
    isStructuredOutputMode: boolean;
    isHelpLike: boolean;
    isVersionLike: boolean;
    firstCommandToken: string | undefined;
  },
): void {
  const {
    isStructuredOutputMode,
    isHelpLike,
    isVersionLike,
    firstCommandToken,
  } = options;

  if (
    isStructuredOutputMode &&
    !isHelpLike &&
    !isVersionLike &&
    firstCommandToken === undefined
  ) {
    printJsonSuccess({
      mode: "help",
      help: program.helpInformation().trimEnd(),
    });
  }
}

function emitCommanderSignalPayload(
  program: Pick<Command, "helpInformation">,
  commanderCode: string | undefined,
  options: {
    captureMachineOutput: boolean;
    isStructuredOutputMode: boolean;
    machineOutput: MachineOutputBuffer;
    version: string;
  },
): void {
  const {
    captureMachineOutput,
    isStructuredOutputMode,
    machineOutput,
    version,
  } = options;

  if (captureMachineOutput) {
    if (commanderCode === "commander.version") {
      const versionLine = machineOutput.value.trim();
      printJsonSuccess({
        mode: "version",
        version: versionLine || version,
      });
    } else {
      printJsonSuccess({
        mode: "help",
        help: machineOutput.value.trimEnd(),
      });
    }
  } else if (isStructuredOutputMode) {
    if (commanderCode === "commander.version") {
      printJsonSuccess({
        mode: "version",
        version,
      });
    } else {
      printJsonSuccess({
        mode: "help",
        help: program.helpInformation().trimEnd(),
      });
    }
  }
}

export const cliMainHelperInternals = {
  normalizeRepositoryUrl,
  maybeLoadConfigEnv,
  mapCommanderError: mapCommanderErrorWithContext,
  buildUnknownCommandError,
  isKnownCommanderHelpTarget,
  shouldStartUpdateCheck,
  configureCommanderOutput,
  applyMachineMode,
  applyHelpStyling,
  emitStructuredRootHelpIfNeeded,
  emitCommanderSignalPayload,
  resolveConfigHome,
};
