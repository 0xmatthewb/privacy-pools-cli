import type { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import { styleCommanderHelp } from "./utils/root-help.js";
import {
  checkForUpdateInBackground,
  getUpdateNotice,
} from "./utils/update-check.js";
import { CLIError, EXIT_CODES, printError } from "./utils/errors.js";
import { printJsonSuccess } from "./utils/json.js";
import { createRootProgram } from "./program.js";

export interface CliPackageInfo {
  version: string;
  repository?: unknown;
}

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

function hasShortFlag(args: string[], flag: string): boolean {
  for (const token of args) {
    if (!token.startsWith("-") || token.startsWith("--")) continue;
    if (token === `-${flag}`) return true;
    // Support bundled short flags, e.g. -jy or -qV
    if (/^-[A-Za-z]+$/.test(token) && token.includes(flag)) return true;
  }
  return false;
}

const ROOT_OPTIONS_WITH_VALUE = new Set([
  "-c",
  "--chain",
  "--format",
  "-r",
  "--rpc-url",
  "--timeout",
]);

const ROOT_LONG_OPTIONS_WITH_INLINE_VALUE = [
  "--chain",
  "--format",
  "--rpc-url",
  "--timeout",
] as const;

function hasLongFlag(args: string[], flag: string): boolean {
  return args.some((token) => token === flag || token.startsWith(`${flag}=`));
}

function readLongOptionValue(args: string[], flag: string): string | null {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === flag) {
      return i + 1 < args.length ? args[i + 1] ?? null : null;
    }
    if (token.startsWith(`${flag}=`)) {
      return token.slice(flag.length + 1);
    }
  }
  return null;
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

const STATIC_LOCAL_COMMANDS = new Set([
  "guide",
  "capabilities",
  "describe",
  "completion",
]);

function isWelcomeShortFlagBundle(token: string): boolean {
  if (!/^-[A-Za-z]+$/.test(token) || token.startsWith("--")) return false;
  return token
    .slice(1)
    .split("")
    .every((flag) => flag === "q" || flag === "v" || flag === "y");
}

function firstNonOptionToken(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith("-")) return token;
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) i++;
  }
  return undefined;
}

function isWelcomeFlagOnlyInvocation(args: string[]): boolean {
  if (args.length === 0) return true;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (ROOT_OPTIONS_WITH_VALUE.has(token)) {
      if (i + 1 >= args.length) return false;
      i++;
      continue;
    }
    if (
      ROOT_LONG_OPTIONS_WITH_INLINE_VALUE.some((flag) =>
        token.startsWith(`${flag}=`)
      )
    ) {
      continue;
    }
    if (WELCOME_BOOLEAN_FLAGS.has(token) || isWelcomeShortFlagBundle(token)) {
      continue;
    }
    return false;
  }
  return true;
}

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

export async function runCli(
  pkg: CliPackageInfo,
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const firstCommandToken = firstNonOptionToken(argv);
  const formatFlagValue = readLongOptionValue(argv, "--format")?.toLowerCase() ?? null;
  const isJson =
    hasLongFlag(argv, "--json") ||
    hasShortFlag(argv, "j") ||
    formatFlagValue === "json";
  const isCsvMode = formatFlagValue === "csv";
  const isAgent = hasLongFlag(argv, "--agent");
  const isUnsigned = hasLongFlag(argv, "--unsigned");
  const isMachineMode = isJson || isCsvMode || isUnsigned || isAgent;
  const isHelpLike =
    argv.includes("--help") ||
    hasShortFlag(argv, "h") ||
    firstCommandToken === "help";
  const isVersionLike = argv.includes("--version") || hasShortFlag(argv, "V");
  const captureMachineOutput = isMachineMode && (isHelpLike || isVersionLike);
  const suppressBanner = argv.includes("--no-banner");
  const isQuiet = argv.includes("--quiet") || hasShortFlag(argv, "q");
  const isWelcome = isWelcomeFlagOnlyInvocation(argv) && !isMachineMode;
  let machineCapturedOut = "";
  const [chalk, dangerTone] = !isMachineMode
    ? await Promise.all([
        import("chalk").then((mod) => mod.default),
        import("./utils/theme.js").then((mod) => mod.dangerTone),
      ])
    : [null, null];

  await maybeLoadConfigEnv(
    firstCommandToken,
    isHelpLike,
    isVersionLike,
    isWelcome,
  );

  const program = createRootProgram(pkg.version);

  if (!isMachineMode) {
    program.showSuggestionAfterError(true);
    program.showHelpAfterError(
      chalk!.dim("\nUse --help to see usage and examples."),
    );
  } else {
    program.showSuggestionAfterError(false);
    program.showHelpAfterError(false);
  }

  program.configureOutput({
    writeOut: (str: string) => {
      if (captureMachineOutput) {
        machineCapturedOut += str;
        return;
      }
      if (isWelcome) return;
      const styled = styleCommanderHelp(str);
      process.stdout.write(styled);
    },
    writeErr: (str: string) => {
      if (isWelcome) return;
      if (!isMachineMode) process.stderr.write(str);
    },
    outputError: (str, write) => {
      if (!isMachineMode) {
        write(dangerTone!(str));
      }
    },
  });

  if (isMachineMode) {
    const applyMachineMode = (cmd: Command): void => {
      cmd.showSuggestionAfterError(false);
      cmd.showHelpAfterError(false);
      cmd.configureOutput({
        writeOut: (str: string) => {
          if (captureMachineOutput) {
            machineCapturedOut += str;
            return;
          }
          const styled = styleCommanderHelp(str);
          process.stdout.write(styled);
        },
        writeErr: () => {},
        outputError: () => {},
      });
      cmd.exitOverride();

      for (const sub of cmd.commands) {
        applyMachineMode(sub);
      }
    };

    applyMachineMode(program);
  }

  const shouldCheckUpdates = shouldStartUpdateCheck(
    firstCommandToken,
    isMachineMode,
    isQuiet,
    isHelpLike,
    isVersionLike,
  );

  try {
    await program.parseAsync();
    if (shouldCheckUpdates) {
      checkForUpdateInBackground();
    }
    if (
      isMachineMode &&
      !isHelpLike &&
      !isVersionLike &&
      firstCommandToken === undefined
    ) {
      printJsonSuccess({
        mode: "help",
        help: program.helpInformation().trimEnd(),
      });
    }
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
      if (captureMachineOutput) {
        if (commanderCode === "commander.version") {
          const versionLine = machineCapturedOut.trim();
          printJsonSuccess({
            mode: "version",
            version: versionLine || pkg.version,
          });
        } else {
          printJsonSuccess({
            mode: "help",
            help: machineCapturedOut.trimEnd(),
          });
        }
      } else if (isMachineMode) {
        if (commanderCode === "commander.version") {
          printJsonSuccess({
            mode: "version",
            version: pkg.version,
          });
        } else {
          printJsonSuccess({
            mode: "help",
            help: program.helpInformation().trimEnd(),
          });
        }
      }
      process.exit(0);
    }

    const mapped = mapCommanderError(err);
    if (mapped) {
      if (isMachineMode) {
        printError(mapped, true);
        return;
      }
      process.exit(EXIT_CODES.INPUT);
      return;
    }

    printError(err, isMachineMode);
  }
}
