#!/usr/bin/env node

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "./bench/args.mjs";
import {
  LAUNCHER_BINARY_OVERRIDE_RUNTIME,
  repoRoot,
} from "./bench/constants.mjs";
import { ensureNodeModules, withRepoBinPath } from "./bench/env.mjs";
import {
  cleanupPreparedFixtureHome,
  prepareFixtureHomeCopy,
} from "./bench/fixture-homes.mjs";
import { launchBenchFixtures } from "./bench/fixtures.mjs";
import { COMMAND_FAMILY_LABELS, getCommandMatrix } from "./bench/matrix.mjs";
import {
  assertNoThresholdFailures,
  evaluateThresholds,
  loadThresholds,
  printFamilyHeader,
  printHeader,
  printRow,
} from "./bench/report.mjs";
import { runBench } from "./bench/runner.mjs";
import {
  cleanupDistSnapshot,
  ensureNativeBinary,
  prepareDistSnapshot,
} from "./bench/artifacts.mjs";
import {
  assertNativeSupported,
  buildCheckout,
  cleanupBaselineWorktree,
  createBaselineWorktree,
} from "./bench/worktree.mjs";

function resolveRuntimes(runtime) {
  return runtime === "both"
    ? ["js", "native"]
    : runtime === "all"
      ? ["js", LAUNCHER_BINARY_OVERRIDE_RUNTIME, "native"]
      : [runtime];
}

function createEmptyBenchHome() {
  const homeRoot = mkdtempSync(join(tmpdir(), "pp-cli-bench-home-"));
  return {
    tempRoot: homeRoot,
    homeRoot,
    configHome: homeRoot,
  };
}

function prepareCommandHome(command) {
  if (command.fixtureHome) {
    return prepareFixtureHomeCopy(command.fixtureHome);
  }
  if (command.isolateHome) {
    return createEmptyBenchHome();
  }
  return null;
}

function resolveCurrentRunner(runtime, currentDist, currentNativeBinary) {
  return runtime === "native"
    ? { command: currentNativeBinary, prefixArgs: [] }
    : { command: process.execPath, prefixArgs: [currentDist] };
}

const commandArgs = parseArgs(process.argv.slice(2));
const thresholds = loadThresholds(commandArgs.assertThresholdsPath);

try {
  ensureNodeModules();
  buildCheckout(repoRoot);

  const baselineWorktree =
    commandArgs.baseRef === "self"
      ? null
      : createBaselineWorktree(commandArgs.baseRef);

  try {
    if (baselineWorktree) {
      buildCheckout(baselineWorktree);
    }

    const fixtureSet = await launchBenchFixtures();
    try {
      const baselineDir = baselineWorktree ?? repoRoot;
      const currentBaseEnv = withRepoBinPath();
      const baselineBaseEnv = withRepoBinPath();
      const runtimes = resolveRuntimes(commandArgs.runtime);
      const commands = getCommandMatrix(commandArgs.matrix);
      const thresholdFailures = [];
      let currentNativeBinary = null;

      if (
        runtimes.includes("native") ||
        runtimes.includes(LAUNCHER_BINARY_OVERRIDE_RUNTIME)
      ) {
        assertNativeSupported();
        currentNativeBinary = ensureNativeBinary(repoRoot);
      }

      const currentDistSnapshot = prepareDistSnapshot(repoRoot);
      const baselineDistSnapshot = prepareDistSnapshot(baselineDir);
      try {
        printHeader(commandArgs);

        for (const runtime of runtimes) {
          let previousFamily = null;
          for (const command of commands) {
            if (runtime === "native" && command.skipDirectNative) {
              continue;
            }

            if (command.family !== previousFamily) {
              printFamilyHeader(
                COMMAND_FAMILY_LABELS[command.family] ?? command.family,
              );
              previousFamily = command.family;
            }

            const extraEnv =
              typeof command.env === "function"
                ? command.env(fixtureSet)
                : {};
            const currentEnv =
              runtime === "native" || runtime === LAUNCHER_BINARY_OVERRIDE_RUNTIME
                ? withRepoBinPath(
                    {
                      ...extraEnv,
                      PRIVACY_POOLS_CLI_BINARY: currentNativeBinary,
                      ...(runtime === LAUNCHER_BINARY_OVERRIDE_RUNTIME
                        ? { PRIVACY_POOLS_CLI_DISABLE_LOCAL_FAST_PATH: "1" }
                        : {}),
                    },
                    { disableNative: false },
                  )
                : {
                    ...currentBaseEnv,
                    ...extraEnv,
                  };
            const baseEnv = {
              ...baselineBaseEnv,
              ...extraEnv,
            };
            const currentHome = prepareCommandHome(command);
            const baseHome = prepareCommandHome(command);

            if (currentHome) {
              currentEnv.PRIVACY_POOLS_HOME = currentHome.configHome;
            }
            if (baseHome) {
              baseEnv.PRIVACY_POOLS_HOME = baseHome.configHome;
            }

            try {
              const base = runBench(
                process.execPath,
                [baselineDistSnapshot.entrypoint],
                baselineDir,
                command.args,
                baseEnv,
                commandArgs.warmup,
                commandArgs.runs,
              );
              if (runtime === "native" || runtime === LAUNCHER_BINARY_OVERRIDE_RUNTIME) {
                currentNativeBinary = ensureNativeBinary(repoRoot);
              }
              const currentRunner = resolveCurrentRunner(
                runtime,
                currentDistSnapshot.entrypoint,
                currentNativeBinary,
              );
              const current = runBench(
                currentRunner.command,
                currentRunner.prefixArgs,
                repoRoot,
                command.args,
                currentEnv,
                commandArgs.warmup,
                commandArgs.runs,
              );

              printRow({
                runtime,
                familyLabel: COMMAND_FAMILY_LABELS[command.family] ?? command.family,
                label: command.label,
                baseMedian: base.median,
                currentMedian: current.median,
              });
              evaluateThresholds({
                thresholdFailures,
                thresholds,
                runtime,
                label: command.label,
                currentMedian: current.median,
                baseMedian: base.median,
              });
            } finally {
              cleanupPreparedFixtureHome(currentHome);
              cleanupPreparedFixtureHome(baseHome);
            }
          }
        }

        assertNoThresholdFailures(thresholdFailures);
      } finally {
        cleanupDistSnapshot(currentDistSnapshot);
        cleanupDistSnapshot(baselineDistSnapshot);
      }
    } finally {
      await fixtureSet.stop();
    }
  } finally {
    if (baselineWorktree) {
      cleanupBaselineWorktree(baselineWorktree);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
