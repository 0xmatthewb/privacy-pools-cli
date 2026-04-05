import type { Command } from "commander";
import { join } from "path";
import { resolveConfigHome } from "./config-paths.js";
import { printJsonSuccess } from "../utils/json.js";
import { CLIError } from "../utils/errors.js";
import { GENERATED_STATIC_LOCAL_COMMANDS } from "../utils/command-routing-static.js";

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
    return new CLIError(
      normalized || "Invalid command input.",
      "INPUT",
      "Use --help to see usage and examples.",
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
    isMachineMode,
    styleCommanderHelp,
    dangerTone,
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
    writeErr: (str: string) => {
      if (isWelcome) return;
      if (!isMachineMode) process.stderr.write(str);
    },
    outputError: (str, write) => {
      if (!isMachineMode && dangerTone) {
        write(dangerTone(str));
      }
    },
  });
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
  mapCommanderError,
  shouldStartUpdateCheck,
  configureCommanderOutput,
  applyMachineMode,
  emitStructuredRootHelpIfNeeded,
  emitCommanderSignalPayload,
  resolveConfigHome,
};
