import "./runtime/color-env-bootstrap.js";
import type { CliPackageInfo } from "./package-info.js";
import {
  checkForUpdateInBackground,
  consumePostCommandUpdateNotice,
  getUpdateNotice,
  getUpdateNoticeWarning,
  shouldShowPostCommandUpdateNotice,
} from "./utils/update-check.js";
import { CLIError, printError } from "./utils/errors.js";
import { createRootProgram } from "./program.js";
import {
  allNonOptionTokens,
  firstNonOptionToken,
  hasLongFlag,
  hasShortFlag,
  isWelcomeFlagOnlyInvocation,
  isWelcomeShortFlagBundle,
  normalizeJsonFieldSelectionArgv,
  parseRootArgv,
  readLongOptionValue,
} from "./utils/root-argv.js";
import { setActiveProfile } from "./runtime/config-paths.js";
import {
  cliMainHelperInternals,
} from "./runtime/cli-main-helpers.js";
import {
  consumeOutputEnvironmentWarnings,
  installOutputAnsiGuards,
} from "./utils/terminal.js";
import { buildGuidePayload, guideText, resolveGuideTopic } from "./utils/help.js";
import {
  configureJsonEnvelopeWarnings,
  printJsonSuccess,
  resetJsonEnvelopeWarnings,
} from "./utils/json.js";
import { setModeArgv } from "./utils/mode.js";
import {
  markWebRequested,
  resetWebOutputStatus,
} from "./utils/web-output-status.js";

function normalizeHelpVerbosityArgv(argv: string[]): string[] {
  const requestsHelpVerbosity =
    hasLongFlag(argv, "--help-brief") || hasLongFlag(argv, "--help-full");
  const alreadyRequestsHelp = hasLongFlag(argv, "--help") || hasShortFlag(argv, "h");
  if (!requestsHelpVerbosity || alreadyRequestsHelp) {
    return argv;
  }
  return [...argv, "--help"];
}

const {
  normalizeRepositoryUrl,
  maybeLoadConfigEnv,
  mapCommanderError,
  buildUnknownCommandError,
  isKnownCommanderHelpTarget,
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
  const normalizedArgv = normalizeHelpVerbosityArgv(
    normalizeJsonFieldSelectionArgv(argv),
  );
  installOutputAnsiGuards();
  setModeArgv(normalizedArgv);
  resetWebOutputStatus();
  resetJsonEnvelopeWarnings();
  const outputWarnings = consumeOutputEnvironmentWarnings();

  // Activate --profile before any config loading.
  const profileValue = readLongOptionValue(normalizedArgv, "--profile");
  if (profileValue) {
    setActiveProfile(profileValue);
  }

  const parsedArgv = parseRootArgv(normalizedArgv);
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
  const topLevelCommand = (firstCommandToken ?? "").trim();
  if (
    isStructuredOutputMode &&
    !isWelcome &&
    !isHelpLike &&
    !isVersionLike &&
    topLevelCommand !== "upgrade" &&
    topLevelCommand !== "completion"
  ) {
    const updateWarning = getUpdateNoticeWarning(pkg.version);
    const warnings = [
      ...outputWarnings,
      ...(updateWarning ? [{ ...updateWarning }] : []),
    ];
    if (warnings.length > 0) {
      configureJsonEnvelopeWarnings(warnings);
    }
  }
  if (hasLongFlag(normalizedArgv, "--web")) {
    markWebRequested();
  }
  const captureMachineOutput =
    isStructuredOutputMode && (isHelpLike || isVersionLike);
  const machineOutput = { value: "" };
  const [muted, dangerTone, styleCommanderHelp] = shouldStyleHelp
    ? await Promise.all([
        import("./utils/theme.js").then((mod) => mod.muted),
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

  if (
    isMachineMode &&
    !firstCommandToken &&
    !isHelpLike &&
    !isVersionLike
  ) {
    printError(
      new CLIError(
        "No command specified.",
        "INPUT",
        "Run 'privacy-pools capabilities --agent' for machine-readable discovery or 'privacy-pools guide --agent' for the guide index.",
        "INPUT_NO_COMMAND",
        false,
        "inline",
        undefined,
        undefined,
        {
          nextActions: [
            {
              command: "capabilities",
              reason: "Discover supported commands, flags, schemas, and error codes.",
              when: "after_capabilities",
              options: { agent: true },
              cliCommand: "privacy-pools capabilities --agent",
            },
            {
              command: "guide",
              reason: "Read the machine-readable guide index.",
              when: "after_guide",
              options: { agent: true },
              cliCommand: "privacy-pools guide --agent",
            },
          ],
        },
      ),
      true,
    );
    return;
  }

  const [firstToken, secondToken] = allNonOptionTokens(normalizedArgv);
  const resolvedGuideTopic =
    firstToken === "help" && secondToken
      ? resolveGuideTopic(secondToken)
      : null;
  if (firstToken === "help" && secondToken && resolvedGuideTopic) {
    const help = guideText(resolvedGuideTopic);
    if (isStructuredOutputMode) {
      printJsonSuccess(buildGuidePayload(resolvedGuideTopic));
    } else if (!isQuiet) {
      process.stdout.write(`${help}\n`);
    }
    process.exitCode = 0;
    return;
  }
  if (
    firstToken === "help" &&
    secondToken &&
    !resolvedGuideTopic &&
    !isKnownCommanderHelpTarget(secondToken)
  ) {
    const help = guideText(secondToken);
    if (isStructuredOutputMode) {
      printJsonSuccess(buildGuidePayload(secondToken));
    } else if (!isQuiet) {
      const { renderHumanGuideText } = await import("./output/discovery.js");
      renderHumanGuideText(help);
    }
    process.exitCode = 0;
    return;
  }
  if (
    isHelpLike &&
    firstToken !== "help" &&
    firstCommandToken &&
    !isKnownCommanderHelpTarget(firstCommandToken)
  ) {
    printError(buildUnknownCommandError(firstCommandToken), isStructuredOutputMode);
    return;
  }

  const program = await createRootProgram(pkg.version, {
    argv: normalizedArgv,
    loadAllCommands: false,
    styledHelp: shouldStyleHelp,
  });

  if (!isMachineMode) {
    program.showSuggestionAfterError(true);
    program.showHelpAfterError(
      muted!("\nUse --help to see usage and examples."),
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
    await program.parseAsync(normalizedArgv, { from: "user" });
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
        process.stderr.write(muted!(notice) + "\n");
      }
    }
    if (hasLongFlag(normalizedArgv, "--web") && !isMachineMode && !isQuiet) {
      const { consumeBrowserLaunchTracking } = await import("./utils/web.js");
      const browserLaunch = consumeBrowserLaunchTracking();
      if (!browserLaunch.attempted) {
        const { formatCallout } = await import("./output/layout.js");
        process.stderr.write(formatCallout(
          "warning",
          "--web was requested, but this command did not provide a browser link.",
        ));
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
          process.stdout.write(`${program.helpInformation().trimEnd()}\n`);
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
            bannerHint: welcomeState.bannerHint,
            actions: welcomeState.bannerActions,
          });
          bannerIncludedWelcome = bannerResult.includedWelcomeText;
        }
        if (!bannerIncludedWelcome) {
          const { welcomeScreen } = await import("./utils/help.js");
          process.stderr.write(
            welcomeScreen({
              version: pkg.version,
              readinessLabel: welcomeState.readinessLabel,
              bannerHint: welcomeState.bannerHint,
              actions: welcomeState.screenActions,
            }) + "\n",
          );
        }
        const notice = getUpdateNotice(pkg.version);
        if (notice) process.stderr.write(muted!(notice) + "\n");
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

    const mapped = mapCommanderError(err, { rootCommand: firstCommandToken, program });
    if (mapped) {
      printError(mapped, isStructuredOutputMode);
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
  buildUnknownCommandError,
  isKnownCommanderHelpTarget,
  shouldStartUpdateCheck,
  configureCommanderOutput,
  applyMachineMode,
  applyHelpStyling,
  emitStructuredRootHelpIfNeeded,
  emitCommanderSignalPayload,
};
