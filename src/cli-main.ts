import type { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import type { CliPackageInfo } from "./package-info.js";
import {
  checkForUpdateInBackground,
  getUpdateNotice,
} from "./utils/update-check.js";
import { CLIError, EXIT_CODES, printError } from "./utils/errors.js";
import { printJsonSuccess } from "./utils/json.js";
import { createRootProgram } from "./program.js";
import { GENERATED_STATIC_LOCAL_COMMANDS } from "./utils/command-discovery-static.js";
import {
  firstNonOptionToken,
  hasShortFlag,
  isWelcomeFlagOnlyInvocation,
  isWelcomeShortFlagBundle,
  parseRootArgv,
  readLongOptionValue,
} from "./utils/root-argv.js";

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

const WELCOME_BOOLEAN_FLAGS = new Set([
  "-q",
  "--quiet",
  "-v",
  "--verbose",
  "-y",
  "--yes",
  "--no-banner",
  "--no-color",
]);

const STATIC_LOCAL_COMMANDS = new Set<string>(GENERATED_STATIC_LOCAL_COMMANDS);

function configHome(): string {
  return (
    process.env.PRIVACY_POOLS_HOME?.trim() ||
    process.env.PRIVACY_POOLS_CONFIG_DIR?.trim() ||
    join(homedir(), ".privacy-pools")
  );
}

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
  loadEnv({ path: join(configHome(), ".env") });
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
  isMachineMode: boolean,
  isQuiet: boolean,
  isHelpLike: boolean,
  isVersionLike: boolean,
): boolean {
  if (isMachineMode || isQuiet || isVersionLike) return false;
  if (isHelpLike) return false;
  if (STATIC_LOCAL_COMMANDS.has(firstCommandToken ?? "")) return false;
  if (!process.stdout.isTTY || !process.stderr.isTTY) return false;
  if (process.env.CI || process.env.CODESPACES) return false;
  return true;
}

interface MachineOutputBuffer {
  value: string;
}

interface CommanderOutputOptions {
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

export async function runCli(
  pkg: CliPackageInfo,
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const parsedArgv = parseRootArgv(argv);
  const {
    firstCommandToken,
    isCsvMode,
    isMachineMode,
    isStructuredOutputMode,
    isHelpLike,
    isVersionLike,
    isQuiet,
    isWelcome,
    suppressBanner,
  } = parsedArgv;
  const shouldStyleHelp = !isStructuredOutputMode;
  const captureMachineOutput =
    isStructuredOutputMode && (isHelpLike || isVersionLike);
  const machineOutput = { value: "" };
  const [chalk, dangerTone, styleCommanderHelp] = shouldStyleHelp
    ? await Promise.all([
        import("chalk").then((mod) => mod.default),
        import("./utils/theme.js").then((mod) => mod.dangerTone),
        import("./utils/root-help.js").then((mod) => mod.styleCommanderHelp),
      ])
    : [null, null, null];

  await maybeLoadConfigEnv(
    firstCommandToken,
    isHelpLike,
    isVersionLike,
    isWelcome,
  );

  const program = await createRootProgram(pkg.version, {
    argv,
    loadAllCommands: false,
    styledHelp: shouldStyleHelp,
  });

  if (!isMachineMode) {
    program.showSuggestionAfterError(true);
    program.showHelpAfterError(
      chalk!.dim("\nUse --help to see usage and examples."),
    );
  } else {
    program.showSuggestionAfterError(false);
    program.showHelpAfterError(false);
  }

  configureCommanderOutput(program, {
    captureMachineOutput,
    isWelcome,
    isMachineMode,
    styleCommanderHelp,
    dangerTone,
    machineOutput,
  });

  if (isMachineMode) {
    applyMachineMode(program, {
      captureMachineOutput,
      styleCommanderHelp,
      machineOutput,
    });
  }

  const shouldCheckUpdates = shouldStartUpdateCheck(
    firstCommandToken,
    isMachineMode,
    isQuiet,
    isHelpLike,
    isVersionLike,
  );

  try {
    await program.parseAsync(argv, { from: "user" });
    if (shouldCheckUpdates) {
      checkForUpdateInBackground();
    }
    emitStructuredRootHelpIfNeeded(program, {
      isStructuredOutputMode,
      isHelpLike,
      isVersionLike,
      firstCommandToken,
    });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      ((err as { code?: string }).code === "commander.help" ||
        (err as { code?: string }).code === "commander.helpDisplayed" ||
        (err as { code?: string }).code === "commander.version")
    ) {
      if (isWelcome) {
        if (isQuiet) {
          process.exit(0);
        }
        if (!suppressBanner) {
          const { printBanner } = await import("./utils/banner.js");
          await printBanner({
            version: pkg.version,
            repository: normalizeRepositoryUrl(pkg.repository),
          });
        }
        const { welcomeScreen } = await import("./utils/help.js");
        process.stdout.write(welcomeScreen() + "\n");
        const notice = getUpdateNotice(pkg.version);
        if (notice) process.stderr.write(chalk!.dim(notice) + "\n");
        if (shouldCheckUpdates) {
          checkForUpdateInBackground();
        }
        process.exit(0);
      }

      const commanderCode = (err as { code?: string }).code;
      emitCommanderSignalPayload(program, commanderCode, {
        captureMachineOutput,
        isStructuredOutputMode,
        machineOutput,
        version: pkg.version,
      });
      process.exit(0);
    }

    const mapped = mapCommanderError(err);
    if (mapped) {
      if (isStructuredOutputMode) {
        printError(mapped, true);
        return;
      }
      process.exit(EXIT_CODES.INPUT);
      return;
    }

    printError(err, isStructuredOutputMode);
  }
}

export const cliMainTestInternals = {
  normalizeRepositoryUrl,
  hasShortFlag,
  readLongOptionValue,
  WELCOME_BOOLEAN_FLAGS,
  isWelcomeShortFlagBundle,
  firstNonOptionToken,
  isWelcomeFlagOnlyInvocation,
  parseRootArgv,
  configHome,
  maybeLoadConfigEnv,
  mapCommanderError,
  shouldStartUpdateCheck,
  configureCommanderOutput,
  applyMachineMode,
  emitStructuredRootHelpIfNeeded,
  emitCommanderSignalPayload,
};
