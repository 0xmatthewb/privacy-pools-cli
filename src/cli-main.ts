import type { CliPackageInfo } from "./package-info.js";
import {
  checkForUpdateInBackground,
  consumePostCommandUpdateNotice,
  getUpdateNotice,
  shouldShowPostCommandUpdateNotice,
} from "./utils/update-check.js";
import { CLIError, EXIT_CODES, printError } from "./utils/errors.js";
import { createRootProgram } from "./program.js";
import {
  allNonOptionTokens,
  firstNonOptionToken,
  hasShortFlag,
  isWelcomeFlagOnlyInvocation,
  isWelcomeShortFlagBundle,
  parseRootArgv,
  readLongOptionValue,
} from "./utils/root-argv.js";
import { setActiveProfile } from "./runtime/config-paths.js";
import {
  cliMainHelperInternals,
} from "./runtime/cli-main-helpers.js";
import { installOutputAnsiGuards } from "./utils/terminal.js";
import { guideText, resolveGuideTopic } from "./utils/help.js";
import { printJsonSuccess } from "./utils/json.js";
import { setModeArgv } from "./utils/mode.js";

const {
  normalizeRepositoryUrl,
  maybeLoadConfigEnv,
  mapCommanderError,
  shouldStartUpdateCheck,
  configureCommanderOutput,
  applyMachineMode,
  applyHelpStyling,
  emitStructuredRootHelpIfNeeded,
  emitCommanderSignalPayload,
  resolveConfigHome: configHome,
} = cliMainHelperInternals;

export async function runCli(
  pkg: CliPackageInfo,
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  installOutputAnsiGuards();
  setModeArgv(argv);

  // Activate --profile before any config loading.
  const profileValue = readLongOptionValue(argv, "--profile");
  if (profileValue) {
    setActiveProfile(profileValue);
  }

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

  const [firstToken, secondToken] = allNonOptionTokens(argv);
  const resolvedGuideTopic =
    firstToken === "help" && secondToken
      ? resolveGuideTopic(secondToken)
      : null;
  if (firstToken === "help" && secondToken && resolvedGuideTopic) {
    const help = guideText(resolvedGuideTopic);
    if (isStructuredOutputMode) {
      printJsonSuccess({ mode: "help", topic: resolvedGuideTopic, help });
    } else if (!isQuiet) {
      process.stdout.write(`${help}\n`);
    }
    process.exitCode = 0;
    return;
  }

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
  } else if (styleCommanderHelp) {
    applyHelpStyling(program, styleCommanderHelp);
  }

  const shouldCheckUpdates = shouldStartUpdateCheck(
    firstCommandToken,
    isWelcome,
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
    if (
      shouldShowPostCommandUpdateNotice({
        firstCommandToken,
        isWelcome,
        isMachineMode,
        isQuiet,
        isHelpLike,
        isVersionLike,
      })
    ) {
      const notice = consumePostCommandUpdateNotice(pkg.version);
      if (notice) {
        process.stderr.write(chalk!.dim(notice) + "\n");
      }
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
          process.exitCode = 0;
          return;
        }
        let bannerIncludedWelcome = false;
        const { getWelcomeState } = await import("./utils/welcome-readiness.js");
        const welcomeState = getWelcomeState();
        if (!suppressBanner) {
          const { printBanner } = await import("./utils/banner.js");
          const bannerResult = await printBanner({
            version: pkg.version,
            repository: normalizeRepositoryUrl(pkg.repository),
            readinessLabel: welcomeState.readinessLabel,
            actions: welcomeState.bannerActions,
          });
          bannerIncludedWelcome = bannerResult.includedWelcomeText;
        }
        if (!bannerIncludedWelcome) {
          const { welcomeScreen } = await import("./utils/help.js");
          process.stdout.write(
            welcomeScreen({
              version: pkg.version,
              readinessLabel: welcomeState.readinessLabel,
              actions: welcomeState.screenActions,
            }) + "\n",
          );
        }
        const notice = getUpdateNotice(pkg.version);
        if (notice) process.stderr.write(chalk!.dim(notice) + "\n");
        if (shouldCheckUpdates) {
          checkForUpdateInBackground();
        }
        process.exitCode = 0;
        return;
      }

      const commanderCode = (err as { code?: string }).code;
      emitCommanderSignalPayload(program, commanderCode, {
        captureMachineOutput,
        isStructuredOutputMode,
        machineOutput,
        version: pkg.version,
      });
      process.exitCode = 0;
      return;
    }

    const mapped = mapCommanderError(err);
    if (mapped) {
      if (isStructuredOutputMode) {
        printError(mapped, true);
        return;
      }
      process.exitCode = EXIT_CODES.INPUT;
      return;
    }

    printError(err, isStructuredOutputMode);
  }
}

export const cliMainTestInternals = {
  normalizeRepositoryUrl,
  hasShortFlag,
  readLongOptionValue,
  WELCOME_BOOLEAN_FLAGS: new Set([
    "-q",
    "--quiet",
    "-v",
    "--verbose",
    "-y",
    "--yes",
    "--no-banner",
    "--no-color",
    "--no-progress",
  ]),
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
  applyHelpStyling,
  emitStructuredRootHelpIfNeeded,
  emitCommanderSignalPayload,
};
