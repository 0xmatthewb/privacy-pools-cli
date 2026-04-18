import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  captureOutput,
  captureJsonOutput,
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import { restoreProcessExitCode } from "../helpers/process.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realProgram = captureModuleExports(await import("../../src/program.ts"));
const realBanner = captureModuleExports(
  await import("../../src/utils/banner.ts"),
);
const realHelp = captureModuleExports(await import("../../src/utils/help.ts"));
const realRootHelp = captureModuleExports(
  await import("../../src/utils/root-help.ts"),
);
const realTheme = captureModuleExports(await import("../../src/utils/theme.ts"));
const realDotenv = captureModuleExports(await import("dotenv"));
const realStaticDiscovery = captureModuleExports(
  await import("../../src/static-discovery.ts"),
);
const realCliMain = captureModuleExports(await import("../../src/cli-main.ts"));
const realCliMainHelpers = captureModuleExports(
  await import("../../src/runtime/cli-main-helpers.ts"),
);
const realLauncher = captureModuleExports(await import("../../src/launcher.ts"));
const realConsoleGuard = captureModuleExports(
  await import("../../src/utils/console-guard.ts"),
);
const realUpdateCheck = captureModuleExports(
  await import("../../src/utils/update-check.ts"),
);
const realJson = captureModuleExports(await import("../../src/utils/json.ts"));
const realConfigPaths = captureModuleExports(
  await import("../../src/runtime/config-paths.ts"),
);
const LAUNCHER_MODULE_PATHS = [
  "../../src/launcher.ts",
  "../../src/launcher.js",
] as const;

const BOOTSTRAP_RUNTIME_MODULE_RESTORES = [
  ["../../src/program.ts", realProgram],
  ["../../src/utils/banner.ts", realBanner],
  ["../../src/utils/help.ts", realHelp],
  ["../../src/utils/root-help.ts", realRootHelp],
  ["../../src/utils/theme.ts", realTheme],
  ["dotenv", realDotenv],
  ["../../src/static-discovery.ts", realStaticDiscovery],
  ["../../src/cli-main.ts", realCliMain],
  ["../../src/runtime/cli-main-helpers.ts", realCliMainHelpers],
  ...LAUNCHER_MODULE_PATHS.map((path) => [path, realLauncher] as const),
  ["../../src/utils/console-guard.ts", realConsoleGuard],
  ["../../src/utils/update-check.ts", realUpdateCheck],
  ["../../src/utils/json.ts", realJson],
  ["../../src/runtime/config-paths.ts", realConfigPaths],
] as const;

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_NO_COLOR = process.env.NO_COLOR;
const ORIGINAL_PRIVACY_POOLS_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_PRIVACY_POOLS_CONFIG_DIR = process.env.PRIVACY_POOLS_CONFIG_DIR;
const ORIGINAL_DISABLE_NATIVE = process.env.PRIVACY_POOLS_CLI_DISABLE_NATIVE;
const ORIGINAL_CI = process.env.CI;
const ORIGINAL_CODESPACES = process.env.CODESPACES;
const ORIGINAL_STDOUT_IS_TTY = process.stdout.isTTY;
const ORIGINAL_STDERR_IS_TTY = process.stderr.isTTY;
const ORIGINAL_EXIT_CODE = process.exitCode;
const ORIGINAL_BUN_VERSION = process.versions.bun;

function setTty(stdoutIsTty: boolean, stderrIsTty = stdoutIsTty): void {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: stdoutIsTty,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: stderrIsTty,
  });
}

function makeCommanderExit(code: string) {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function forceJsLauncherFallback(): void {
  process.env.PRIVACY_POOLS_CLI_DISABLE_NATIVE = "1";
}

function setIndexArgv(args: string[]): void {
  process.argv = ["node", "privacy-pools-test", ...args];
}

function setDirectIndexArgv(
  args: string[],
  runtime = "node",
  entryPath = realpathSync(resolve(process.cwd(), "src/index.ts")),
): void {
  process.argv = [runtime, entryPath, ...args];
}

async function runImportedIndex(
  query: string,
  options: { simulateNodeRuntime?: boolean } = {},
): Promise<void> {
  const shouldSimulateNodeRuntime = options.simulateNodeRuntime !== false;
  const originalBunVersion = process.versions.bun;

  if (shouldSimulateNodeRuntime) {
    delete process.versions.bun;
  }

  try {
    const module = await import(`../../src/index.ts?${query}=${Date.now()}`);
    await module.runCliEntrypoint();
  } finally {
    if (originalBunVersion === undefined) {
      delete process.versions.bun;
    } else {
      Object.defineProperty(process.versions, "bun", {
        configurable: true,
        value: originalBunVersion,
      });
    }
  }
}

function makeProgram(
  parseAsyncFactory: (program: {
    configuredOutput: {
      writeOut?: (value: string) => void;
      writeErr?: (value: string) => void;
      outputError?: (
        value: string,
        write: (value: string) => void,
      ) => void;
    };
  }) => () => Promise<void>,
) {
  const program = {
    configuredOutput: {} as {
      writeOut?: (value: string) => void;
      writeErr?: (value: string) => void;
      outputError?: (
        value: string,
        write: (value: string) => void,
      ) => void;
    },
    commands: [],
    showSuggestionAfterError() {},
    showHelpAfterError() {},
    configureOutput(output?: {
      writeOut?: (value: string) => void;
      writeErr?: (value: string) => void;
      outputError?: (
        value: string,
        write: (value: string) => void,
      ) => void;
    }) {
      if (!output) return this.configuredOutput;
      this.configuredOutput = { ...this.configuredOutput, ...output };
      return this;
    },
    exitOverride() {},
    helpInformation() {
      return "stub help";
    },
    parseAsync() {
      return parseAsyncFactory(program)();
    },
  };

  return program;
}

afterEach(() => {
  process.argv = [...ORIGINAL_ARGV];
  if (ORIGINAL_NO_COLOR === undefined) {
    delete process.env.NO_COLOR;
  } else {
    process.env.NO_COLOR = ORIGINAL_NO_COLOR;
  }
  if (ORIGINAL_PRIVACY_POOLS_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_PRIVACY_POOLS_HOME;
  }
  if (ORIGINAL_PRIVACY_POOLS_CONFIG_DIR === undefined) {
    delete process.env.PRIVACY_POOLS_CONFIG_DIR;
  } else {
    process.env.PRIVACY_POOLS_CONFIG_DIR = ORIGINAL_PRIVACY_POOLS_CONFIG_DIR;
  }
  if (ORIGINAL_DISABLE_NATIVE === undefined) {
    delete process.env.PRIVACY_POOLS_CLI_DISABLE_NATIVE;
  } else {
    process.env.PRIVACY_POOLS_CLI_DISABLE_NATIVE = ORIGINAL_DISABLE_NATIVE;
  }
  if (ORIGINAL_CI === undefined) {
    delete process.env.CI;
  } else {
    process.env.CI = ORIGINAL_CI;
  }
  if (ORIGINAL_CODESPACES === undefined) {
    delete process.env.CODESPACES;
  } else {
    process.env.CODESPACES = ORIGINAL_CODESPACES;
  }
  restoreProcessExitCode(ORIGINAL_EXIT_CODE);
  if (ORIGINAL_BUN_VERSION === undefined) {
    delete process.versions.bun;
  } else {
    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: ORIGINAL_BUN_VERSION,
    });
  }
  setTty(Boolean(ORIGINAL_STDOUT_IS_TTY), Boolean(ORIGINAL_STDERR_IS_TTY));
  restoreModuleImplementations(BOOTSTRAP_RUNTIME_MODULE_RESTORES);
});

describe("bootstrap runtime coverage", () => {
  test("createRootProgram resolves root command aliases for partial command loading", async () => {
    const program = await realProgram.createRootProgram("1.2.3", {
      argv: ["exit"],
      loadAllCommands: false,
      styledHelp: false,
    });

    expect(program.commands.map((command) => command.name())).toContain("ragequit");
    expect(program.commands).toHaveLength(1);
  });

  test("createRootProgram falls back to all root commands for unknown invocations", async () => {
    const program = await realProgram.createRootProgram("1.2.3", {
      argv: ["definitely-not-a-command"],
      loadAllCommands: false,
      styledHelp: false,
    });

    const commandNames = program.commands.map((command) => command.name());
    expect(commandNames).toContain("status");
    expect(commandNames).toContain("ragequit");
    expect(commandNames.length).toBeGreaterThan(5);
  });

  test("runCli prints the welcome screen and banner for bare invocation", async () => {
    const program = makeProgram(() => async () => {
      throw makeCommanderExit("commander.helpDisplayed");
    });
    const printBannerMock = mock(async () => ({ includedWelcomeText: false }));
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));
    mock.module("../../src/utils/banner.ts", () => ({
      printBanner: printBannerMock,
    }));

    const { runCli } = await import("../../src/cli-main.ts?welcome-runtime");
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      runCli({ version: "1.2.3", repository: "https://github.com/example/repo" }, []),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("privacy-pools flow start 0.1 ETH");
    expect(stderr).toBe("");
    expect(printBannerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        version: "1.2.3",
        repository: "github.com/example/repo",
      }),
    );
  });

  test("runCli returns machine-readable help for structured help invocations", async () => {
    const program = makeProgram((configuredProgram) => async () => {
      configuredProgram.configuredOutput.writeOut?.("stub help");
      throw makeCommanderExit("commander.help");
    });
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?machine-help-runtime");
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      runCli({ version: "1.2.3" }, ["--json", "--help"]),
    );

    expect(exitCode).toBe(0);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toBe("stub help");
    expect(stderr).toBe("");
  });

  test("runCli returns machine-readable help for bare structured invocations", async () => {
    const program = makeProgram(() => async () => undefined);
    program.helpInformation = () => "root help body";
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?machine-root-help-runtime");
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runCli({ version: "1.2.3" }, ["--json"]),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toBe("root help body");
    expect(stderr).toBe("");
  });

  test("runCli returns machine-readable version payloads", async () => {
    const program = makeProgram((configuredProgram) => async () => {
      configuredProgram.configuredOutput.writeOut?.("9.9.9");
      throw makeCommanderExit("commander.version");
    });
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?machine-version-runtime");
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      runCli({ version: "1.2.3" }, ["--json", "--version"]),
    );

    expect(exitCode).toBe(0);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("version");
    expect(json.version).toBe("9.9.9");
    expect(stderr).toBe("");
  });

  test("runCli root signal paths do not force process exit", async () => {
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`unexpected exit(${code ?? 0})`);
    }) as never;

    try {
      const welcomeProgram = makeProgram(() => async () => {
        throw makeCommanderExit("commander.helpDisplayed");
      });
      const printBannerMock = mock(async () => ({ includedWelcomeText: false }));
      mock.module("../../src/program.ts", () => ({
        createRootProgram: async () => welcomeProgram,
      }));
      mock.module("../../src/utils/banner.ts", () => ({
        printBanner: printBannerMock,
      }));

      const { runCli: runWelcomeCli } = await import(
        "../../src/cli-main.ts?no-force-welcome-runtime"
      );
      let welcomeExitCode: number | undefined;
      const welcomeResult = await captureAsyncOutput(async () => {
        await runWelcomeCli(
          {
            version: "1.2.3",
            repository: "https://github.com/example/repo",
          },
          [],
        );
        welcomeExitCode = process.exitCode;
      });
      expect(welcomeExitCode).toBe(0);
      expect(welcomeResult.stdout).toContain("privacy-pools flow start 0.1 ETH");
      expect(welcomeResult.stderr).toBe("");

      const versionProgram = makeProgram((configuredProgram) => async () => {
        configuredProgram.configuredOutput.writeOut?.("9.9.9");
        throw makeCommanderExit("commander.version");
      });
      mock.module("../../src/program.ts", () => ({
        createRootProgram: async () => versionProgram,
      }));

      const { runCli: runVersionCli } = await import(
        "../../src/cli-main.ts?no-force-version-runtime"
      );
      let versionExitCode: number | undefined;
      const versionResult = await captureAsyncJsonOutput(async () => {
        await runVersionCli({ version: "1.2.3" }, ["--json", "--version"]);
        versionExitCode = process.exitCode;
      });
      expect(versionExitCode).toBe(0);
      expect(versionResult.json.success).toBe(true);
      expect(versionResult.json.mode).toBe("version");
      expect(versionResult.stderr).toBe("");
    } finally {
      process.exit = originalExit;
    }
  });

  test("runCli maps commander input errors into structured machine errors", async () => {
    const program = makeProgram(() => async () => {
      throw {
        code: "commander.unknownOption",
        message: "error: unknown option '--oops'",
      };
    });
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?machine-input-error-runtime");
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      runCli({ version: "1.2.3" }, ["--json", "--oops"]),
    );

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_UNKNOWN_OPTION");
    expect(json.error.message).toContain("unknown option '--oops'");
    expect(stderr).toBe("");
  });

  test("runCli exits with INPUT status for commander input errors in human mode", async () => {
    const program = makeProgram(() => async () => {
      throw {
        code: "commander.invalidArgument",
        message: "error: invalid value for '--timeout'",
      };
    });
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?human-input-error-runtime");
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      runCli({ version: "1.2.3" }, ["--timeout", "NaN"]),
    );

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("Error [INPUT]: invalid value for '--timeout'");
    expect(stderr).toContain("Hint: Use --help to see usage and examples.");
  });

  test("runCli human commander input errors set exitCode without forcing exit", async () => {
    const program = makeProgram(() => async () => {
      throw {
        code: "commander.invalidArgument",
        message: "error: invalid value for '--timeout'",
      };
    });
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      throw new Error(`unexpected exit(${code ?? 0})`);
    }) as never;

    try {
      const { runCli } = await import(
        "../../src/cli-main.ts?no-force-human-input-error-runtime"
      );
      let seenExitCode: number | undefined;
      const { stdout, stderr } = await captureAsyncOutput(async () => {
        await runCli({ version: "1.2.3" }, ["--timeout", "NaN"]);
        seenExitCode = process.exitCode;
      });

      expect(seenExitCode).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toContain("Error [INPUT]: invalid value for '--timeout'");
      expect(stderr).toContain("Hint: Use --help to see usage and examples.");
    } finally {
      process.exit = originalExit;
    }
  });

  test("runCli renders the describe index in human mode when no command path is provided", async () => {
    const { runCli } = await import("../../src/cli-main.ts?real-human-missing-arg-runtime");
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      runCli({ version: "1.2.3" }, ["describe"]),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("Describe: commands");
    expect(stderr).toContain("Available command paths");
  });

  test("runCli quiet welcome exits cleanly without banner or welcome output", async () => {
    const program = makeProgram(() => async () => {
      throw makeCommanderExit("commander.helpDisplayed");
    });
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?quiet-welcome-runtime");
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      runCli({ version: "1.2.3", repository: "https://github.com/example/repo" }, ["--quiet"]),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("runCli skips the banner when --no-banner is set", async () => {
    const program = makeProgram(() => async () => {
      throw makeCommanderExit("commander.helpDisplayed");
    });
    const printBannerMock = mock(async () => ({ includedWelcomeText: false }));
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));
    mock.module("../../src/utils/banner.ts", () => ({
      printBanner: printBannerMock,
    }));
    mock.module("../../src/utils/help.ts", () => ({
      ...realHelp,
        welcomeScreen: () => "welcome body",
    }));

    const { runCli } = await import("../../src/cli-main.ts?no-banner-welcome-runtime");
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      runCli({ version: "1.2.3", repository: { url: "git+https://github.com/example/repo.git" } }, ["--no-banner"]),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("welcome body");
    expect(stderr).toBe("");
    expect(printBannerMock).not.toHaveBeenCalled();
  });

  test("runCli styles human help output and commander errors for subcommands", async () => {
    const program = makeProgram((configuredProgram) => async () => {
      configuredProgram.configuredOutput.writeOut?.("help body");
      configuredProgram.configuredOutput.writeErr?.("stderr note");
      configuredProgram.configuredOutput.outputError?.(
        "danger body",
        (value: string) => configuredProgram.configuredOutput.writeErr?.(value),
      );
      throw makeCommanderExit("commander.help");
    });
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));
    mock.module("../../src/utils/root-help.ts", () => ({
      styleCommanderHelp: (value: string) => `styled:${value}`,
    }));
    mock.module("../../src/utils/theme.ts", () => ({
      dangerTone: (value: string) => `danger:${value}`,
    }));

    const { runCli } = await import("../../src/cli-main.ts?human-help-styling");
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      runCli({ version: "1.2.3" }, ["status", "--help"]),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("styled:help body");
    expect(stderr).toBe("");
  });

  test("runCli loads config-home dotenv for runtime commands", async () => {
    const dotenvConfigMock = mock(() => undefined);
    const program = makeProgram(() => async () => undefined);
    process.env.PRIVACY_POOLS_HOME = "/tmp/privacy-pools-home";
    mock.module("dotenv", () => ({
      config: dotenvConfigMock,
    }));
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?dotenv-runtime-command");
    await captureAsyncOutput(() => runCli({ version: "1.2.3" }, ["status"]));

    expect(dotenvConfigMock).toHaveBeenCalledWith({
      path: "/tmp/privacy-pools-home/.env",
    });
  });

  test("runCli loads config-home dotenv from PRIVACY_POOLS_CONFIG_DIR when home is unset", async () => {
    const dotenvConfigMock = mock(() => undefined);
    const program = makeProgram(() => async () => undefined);
    delete process.env.PRIVACY_POOLS_HOME;
    process.env.PRIVACY_POOLS_CONFIG_DIR = "/tmp/privacy-pools-config";
    mock.module("dotenv", () => ({
      config: dotenvConfigMock,
    }));
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?dotenv-config-dir");
    await captureAsyncOutput(() => runCli({ version: "1.2.3" }, ["status"]));

    expect(dotenvConfigMock).toHaveBeenCalledWith({
      path: "/tmp/privacy-pools-config/.env",
    });
  });

  test("runCli skips config-home dotenv for static local commands", async () => {
    const dotenvConfigMock = mock(() => undefined);
    const program = makeProgram(() => async () => undefined);
    process.env.PRIVACY_POOLS_HOME = "/tmp/privacy-pools-home";
    mock.module("dotenv", () => ({
      config: dotenvConfigMock,
    }));
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?dotenv-static-command");
    await captureAsyncOutput(() => runCli({ version: "1.2.3" }, ["guide"]));

    expect(dotenvConfigMock).not.toHaveBeenCalled();
  });

  test("runCli activates --profile before config loading and emits post-parse notices", async () => {
    const program = makeProgram(() => async () => undefined);
    const setActiveProfileMock = mock(() => undefined);
    const maybeLoadConfigEnvMock = mock(async () => undefined);
    const emitStructuredRootHelpIfNeededMock = mock(() => undefined);
    const checkForUpdateInBackgroundMock = mock(() => undefined);
    const consumePostCommandUpdateNoticeMock = mock(() => "profile notice");
    const shouldShowPostCommandUpdateNoticeMock = mock(() => true);
    setTty(true);

    mock.module("../../src/runtime/config-paths.ts", () => ({
      ...realConfigPaths,
      setActiveProfile: setActiveProfileMock,
    }));
    mock.module("../../src/runtime/cli-main-helpers.ts", () => ({
      cliMainHelperInternals: {
        ...realCliMainHelpers.cliMainHelperInternals,
        maybeLoadConfigEnv: maybeLoadConfigEnvMock,
        shouldStartUpdateCheck: () => true,
        emitStructuredRootHelpIfNeeded: emitStructuredRootHelpIfNeededMock,
      },
    }));
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));
    mock.module("../../src/utils/update-check.ts", () => ({
      checkForUpdateInBackground: checkForUpdateInBackgroundMock,
      getUpdateNotice: () => null,
      consumePostCommandUpdateNotice: consumePostCommandUpdateNoticeMock,
      shouldShowPostCommandUpdateNotice: shouldShowPostCommandUpdateNoticeMock,
    }));

    const { runCli } = await import("../../src/cli-main.ts?profile-success-runtime");
    const { stderr } = await captureAsyncOutput(() =>
      runCli({ version: "1.2.3" }, ["--profile", "team", "status"]),
    );

    expect(setActiveProfileMock).toHaveBeenCalledWith("team");
    expect(maybeLoadConfigEnvMock).toHaveBeenCalledWith(
      "status",
      false,
      false,
      false,
    );
    expect(checkForUpdateInBackgroundMock).toHaveBeenCalledTimes(1);
    expect(emitStructuredRootHelpIfNeededMock).toHaveBeenCalledTimes(1);
    expect(consumePostCommandUpdateNoticeMock).toHaveBeenCalledWith("1.2.3");
    expect(shouldShowPostCommandUpdateNoticeMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("profile notice");
  });

  test("runCli keeps the background update check off runtime commands", async () => {
    const checkForUpdateInBackgroundMock = mock(() => undefined);
    const getUpdateNoticeMock = mock(() => null);
    const program = makeProgram(() => async () => undefined);
    delete process.env.CI;
    delete process.env.CODESPACES;
    setTty(true);

    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));
    mock.module("../../src/utils/update-check.ts", () => ({
      checkForUpdateInBackground: checkForUpdateInBackgroundMock,
      getUpdateNotice: getUpdateNoticeMock,
      consumePostCommandUpdateNotice: () => null,
      shouldShowPostCommandUpdateNotice: () => false,
    }));

    const { runCli } = await import("../../src/cli-main.ts?update-check-runtime");
    await captureAsyncOutput(() => runCli({ version: "1.2.3" }, ["status"]));

    expect(checkForUpdateInBackgroundMock).not.toHaveBeenCalled();
    expect(getUpdateNoticeMock).not.toHaveBeenCalled();
  });

  test("runCli keeps static local commands out of the background update path", async () => {
    const checkForUpdateInBackgroundMock = mock(() => undefined);
    const program = makeProgram(() => async () => undefined);
    setTty(true);

    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));
    mock.module("../../src/utils/update-check.ts", () => ({
      checkForUpdateInBackground: checkForUpdateInBackgroundMock,
      getUpdateNotice: () => null,
      consumePostCommandUpdateNotice: () => null,
      shouldShowPostCommandUpdateNotice: () => false,
    }));

    const { runCli } = await import("../../src/cli-main.ts?update-check-static-local");
    await captureAsyncOutput(() => runCli({ version: "1.2.3" }, ["guide"]));

    expect(checkForUpdateInBackgroundMock).not.toHaveBeenCalled();
  });

  test("runCli suppresses the background update check in CI mode", async () => {
    const checkForUpdateInBackgroundMock = mock(() => undefined);
    const program = makeProgram(() => async () => undefined);
    process.env.CI = "1";
    setTty(true);

    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));
    mock.module("../../src/utils/update-check.ts", () => ({
      checkForUpdateInBackground: checkForUpdateInBackgroundMock,
      getUpdateNotice: () => null,
      consumePostCommandUpdateNotice: () => null,
      shouldShowPostCommandUpdateNotice: () => false,
    }));

    const { runCli } = await import("../../src/cli-main.ts?update-check-ci");
    await captureAsyncOutput(() => runCli({ version: "1.2.3" }, ["status"]));

    expect(checkForUpdateInBackgroundMock).not.toHaveBeenCalled();
  });

  test("runCli applies machine-mode output overrides recursively", async () => {
    function makeTrackedCommand() {
      return {
        configuredOutput: {} as {
          writeOut?: (value: string) => void;
          writeErr?: (value: string) => void;
          outputError?: (
            value: string,
            write: (value: string) => void,
          ) => void;
        },
        commands: [] as Array<any>,
        suggestionArgs: [] as boolean[],
        helpArgs: [] as Array<string | boolean>,
        configureOutput(output: {
          writeOut?: (value: string) => void;
          writeErr?: (value: string) => void;
          outputError?: (
            value: string,
            write: (value: string) => void,
          ) => void;
        }) {
          this.configuredOutput = output;
        },
        showSuggestionAfterError(value: boolean) {
          this.suggestionArgs.push(value);
        },
        showHelpAfterError(value: string | boolean) {
          this.helpArgs.push(value);
        },
        exitOverride: mock(() => undefined),
      };
    }

    const child = makeTrackedCommand();
    const program = makeProgram((configuredProgram) => async () => {
      configuredProgram.configuredOutput.writeOut?.("machine body");
      configuredProgram.configuredOutput.writeErr?.("suppressed warning");
    }) as ReturnType<typeof makeProgram> & {
      commands: Array<any>;
      suggestionArgs: boolean[];
      helpArgs: Array<string | boolean>;
      exitOverride: ReturnType<typeof mock>;
    };
    Object.assign(program, makeTrackedCommand());
    program.commands = [child];

    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?machine-recursion");
    const { stdout, stderr } = await captureAsyncOutput(() =>
      runCli({ version: "1.2.3" }, ["--json", "status"]),
    );

    expect(stdout).toContain("machine body");
    expect(stderr).toBe("");
    expect(program.suggestionArgs).toContain(false);
    expect(program.helpArgs).toContain(false);
    expect(program.exitOverride).toHaveBeenCalledTimes(1);
    expect(child.suggestionArgs).toContain(false);
    expect(child.helpArgs).toContain(false);
    expect(child.exitOverride).toHaveBeenCalledTimes(1);
  });

  test("runCli shows a cached post-command update notice after a successful interactive command", async () => {
    const program = makeProgram(() => async () => undefined);
    const checkForUpdateInBackgroundMock = mock(() => undefined);
    setTty(true);
    delete process.env.CI;
    delete process.env.CODESPACES;

    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));
    mock.module("../../src/utils/update-check.ts", () => ({
      checkForUpdateInBackground: checkForUpdateInBackgroundMock,
      getUpdateNotice: () => null,
      consumePostCommandUpdateNotice: () => "cached update available",
      shouldShowPostCommandUpdateNotice: () => true,
    }));

    const { runCli } = await import("../../src/cli-main.ts?post-command-update-notice");
    const { stdout, stderr } = await captureAsyncOutput(() =>
      runCli({ version: "1.2.3" }, ["status"]),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("cached update available");
    expect(checkForUpdateInBackgroundMock).not.toHaveBeenCalled();
  });

  test("runCli welcome output includes the current update notice for interactive users", async () => {
    const program = makeProgram(() => async () => {
      throw makeCommanderExit("commander.helpDisplayed");
    });
    const printBannerMock = mock(async () => ({ includedWelcomeText: false }));
    const checkForUpdateInBackgroundMock = mock(() => undefined);
    delete process.env.CI;
    delete process.env.CODESPACES;
    setTty(true);

    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));
    mock.module("../../src/utils/banner.ts", () => ({
      printBanner: printBannerMock,
    }));
    mock.module("../../src/utils/help.ts", () => ({
      ...realHelp,
      welcomeScreen: () => "welcome body",
    }));
    mock.module("../../src/utils/update-check.ts", () => ({
      checkForUpdateInBackground: checkForUpdateInBackgroundMock,
      getUpdateNotice: () => "new version available",
      consumePostCommandUpdateNotice: () => null,
      shouldShowPostCommandUpdateNotice: () => false,
    }));

    const { runCli } = await import("../../src/cli-main.ts?welcome-update-notice");
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      runCli({ version: "1.2.3", repository: "https://github.com/example/repo" }, []),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain("welcome body");
    expect(stderr).toContain("new version available");
    expect(printBannerMock).toHaveBeenCalledTimes(1);
    expect(checkForUpdateInBackgroundMock).toHaveBeenCalledTimes(1);
  });

  test("runCli supports bundled short flags for quiet welcome invocations", async () => {
    const { runCli } = await import("../../src/cli-main.ts?quiet-short-bundle");
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      runCli(
        { version: "1.2.3", repository: "https://github.com/example/repo" },
        ["-qy", "--timeout=5", "--chain=mainnet"],
      ),
    );

    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("runCli accepts both inline and split --output json for bare root help", async () => {
    const inlineCli = await import("../../src/cli-main.ts?format-inline-json-help");
    const inline = await captureAsyncJsonOutputAllowExit(() =>
      inlineCli.runCli({ version: "1.2.3" }, ["--output=json"]),
    );
    expect(inline.exitCode).toBe(0);
    expect(inline.json.success).toBe(true);
    expect(inline.json.mode).toBe("help");
    expect(inline.stderr).toBe("");

    const splitCli = await import("../../src/cli-main.ts?format-split-json-help");
    const split = await captureAsyncJsonOutputAllowExit(() =>
      splitCli.runCli({ version: "1.2.3" }, ["--output", "json"]),
    );
    expect(split.exitCode).toBe(0);
    expect(split.json.success).toBe(true);
    expect(split.json.mode).toBe("help");
    expect(split.stderr).toBe("");
  });

  test("runCli captures structured subcommand help for unsigned invocations", async () => {
    const program = makeProgram((configuredProgram) => async () => {
      configuredProgram.configuredOutput.writeOut?.("unsigned help");
      throw makeCommanderExit("commander.help");
    });
    mock.module("../../src/program.ts", () => ({
      createRootProgram: async () => program,
    }));

    const { runCli } = await import("../../src/cli-main.ts?unsigned-help-runtime");
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      runCli({ version: "1.2.3" }, ["--unsigned", "withdraw", "--help"]),
    );

    expect(exitCode).toBe(0);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toBe("unsigned help");
    expect(stderr).toBe("");
  });

  test("cliMain internals normalize repository and config-home fallbacks", async () => {
    const { cliMainTestInternals } = realCliMain;

    expect(
      cliMainTestInternals.normalizeRepositoryUrl(
        "git+https://github.com/0xbow-io/privacy-pools-cli.git",
      ),
    ).toBe("github.com/0xbow-io/privacy-pools-cli");
    expect(
      cliMainTestInternals.normalizeRepositoryUrl({
        url: "ssh://git@github.com/0xbow-io/privacy-pools-cli.git",
      }),
    ).toBe("github.com/0xbow-io/privacy-pools-cli");
    expect(cliMainTestInternals.normalizeRepositoryUrl({})).toBeNull();

    process.env.PRIVACY_POOLS_HOME = " /tmp/privacy-home ";
    expect(cliMainTestInternals.configHome()).toBe("/tmp/privacy-home");

    delete process.env.PRIVACY_POOLS_HOME;
    process.env.PRIVACY_POOLS_CONFIG_DIR = " /tmp/privacy-config ";
    expect(cliMainTestInternals.configHome()).toBe("/tmp/privacy-config");

    delete process.env.PRIVACY_POOLS_CONFIG_DIR;
    expect(cliMainTestInternals.configHome()).toContain(".privacy-pools");
  });

  test("cliMain internals map commander errors and gate update checks", async () => {
    const { cliMainTestInternals } = realCliMain;

    expect(cliMainTestInternals.mapCommanderError("oops")).toBeNull();
    expect(
      cliMainTestInternals.mapCommanderError({ code: "custom.error" }),
    ).toBeNull();
    expect(
      cliMainTestInternals.mapCommanderError({
        code: "commander.invalidOptionArgument",
        message: "error: invalid value for --timeout",
      })?.message,
    ).toBe("invalid value for --timeout");

    expect(
      cliMainTestInternals.shouldStartUpdateCheck(
        undefined,
        true,
        true,
        false,
        false,
        false,
      ),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(
        undefined,
        true,
        false,
        false,
        true,
        false,
      ),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(
        "guide",
        true,
        false,
        false,
        false,
        false,
      ),
    ).toBe(false);

    setTty(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(
        undefined,
        true,
        false,
        false,
        false,
        false,
      ),
    ).toBe(false);

    setTty(true);
    process.env.CI = "1";
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(
        undefined,
        true,
        false,
        false,
        false,
        false,
      ),
    ).toBe(false);

    delete process.env.CI;
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(
        undefined,
        true,
        false,
        false,
        false,
        false,
      ),
    ).toBe(true);
  });

  test("cliMain internals emit structured help and signal payloads", async () => {
    const { cliMainTestInternals } = realCliMain;
    const program = {
      helpInformation: () => "root help body",
    };

    const rootHelp = captureJsonOutput(() => {
      cliMainTestInternals.emitStructuredRootHelpIfNeeded(program as any, {
        isStructuredOutputMode: true,
        isHelpLike: false,
        isVersionLike: false,
        firstCommandToken: undefined,
      });
    });
    expect(rootHelp.json.success).toBe(true);
    expect(rootHelp.json.mode).toBe("help");
    expect(rootHelp.json.help).toBe("root help body");

    const machineVersion = captureJsonOutput(() => {
      cliMainTestInternals.emitCommanderSignalPayload(
        program as any,
        "commander.version",
        {
          captureMachineOutput: true,
          isStructuredOutputMode: true,
          machineOutput: { value: "9.9.9\n" },
          version: "1.2.3",
        },
      );
    });
    expect(machineVersion.json.success).toBe(true);
    expect(machineVersion.json.mode).toBe("version");
    expect(machineVersion.json.version).toBe("9.9.9");

    const structuredHelp = captureJsonOutput(() => {
      cliMainTestInternals.emitCommanderSignalPayload(program as any, undefined, {
        captureMachineOutput: false,
        isStructuredOutputMode: true,
        machineOutput: { value: "" },
        version: "1.2.3",
      });
    });
    expect(structuredHelp.json.success).toBe(true);
    expect(structuredHelp.json.mode).toBe("help");
    expect(structuredHelp.json.help).toBe("root help body");
  });

  test("cliMain internals configure and recurse machine-mode output", async () => {
    const { cliMainTestInternals } = realCliMain;

    const subcommand = {
      commands: [],
      showSuggestionAfterError: mock(() => undefined),
      showHelpAfterError: mock(() => undefined),
      configureOutput: mock(() => undefined),
      exitOverride: mock(() => undefined),
    };
    const program = {
      commands: [subcommand],
      showSuggestionAfterError: mock(() => undefined),
      showHelpAfterError: mock(() => undefined),
      configureOutput: mock(() => undefined),
      exitOverride: mock(() => undefined),
    };
    const machineOutput = { value: "" };

    cliMainTestInternals.applyMachineMode(program as any, {
      captureMachineOutput: true,
      styleCommanderHelp: null,
      machineOutput,
    });

    expect(program.showSuggestionAfterError).toHaveBeenCalledWith(false);
    expect(program.showHelpAfterError).toHaveBeenCalledWith(false);
    expect(program.exitOverride).toHaveBeenCalledTimes(1);
    expect(subcommand.exitOverride).toHaveBeenCalledTimes(1);

    const configuredOutput = program.configureOutput.mock.calls[0]?.[0] as {
      writeOut: (value: string) => void;
      writeErr: () => void;
      outputError: () => void;
    };
    configuredOutput.writeOut("machine help");
    expect(machineOutput.value).toBe("machine help");
  });

  test("cliMain internals style commander output for humans", async () => {
    const { cliMainTestInternals } = realCliMain;
    let configuredOutput:
      | {
          writeOut: (value: string) => void;
          writeErr: (value: string) => void;
          outputError: (value: string, write: (value: string) => void) => void;
        }
      | undefined;
    const program = {
      commands: [],
      configureOutput: (output: typeof configuredOutput) => {
        configuredOutput = output;
      },
    };

    cliMainTestInternals.configureCommanderOutput(program as any, {
      captureMachineOutput: false,
      isWelcome: false,
      isMachineMode: false,
      styleCommanderHelp: (value: string) => `styled:${value}`,
      dangerTone: (value: string) => `danger:${value}`,
      machineOutput: { value: "" },
    });

    const captured = captureOutput(() => {
      configuredOutput?.writeOut("help");
      configuredOutput?.writeErr("stderr");
      configuredOutput?.outputError("warn", (value) => process.stderr.write(value));
    });

    expect(captured.stdout).toBe("styled:help");
    expect(captured.stderr).toBe("");
  });

  test("cliMain internals write styled machine help when not capturing", async () => {
    const { cliMainTestInternals } = realCliMain;
    const program = {
      commands: [],
      showSuggestionAfterError: mock(() => undefined),
      showHelpAfterError: mock(() => undefined),
      configureOutput: mock(() => undefined),
      exitOverride: mock(() => undefined),
    };

    cliMainTestInternals.applyMachineMode(program as any, {
      captureMachineOutput: false,
      styleCommanderHelp: (value: string) => `styled:${value}`,
      machineOutput: { value: "" },
    });

    const configuredOutput = program.configureOutput.mock.calls[0]?.[0] as {
      writeOut: (value: string) => void;
    };
    const captured = captureOutput(() => {
      configuredOutput.writeOut("machine help");
    });

    expect(captured.stdout).toBe("styled:machine help");
  });

  test("staticDiscovery internals cover remaining parser option branches", async () => {
    const { staticDiscoveryTestInternals } = realStaticDiscovery;

    expect(
      staticDiscoveryTestInternals.isKnownCompletionShell("powershell"),
    ).toBe(true);

    const longOpts: Record<string, string | boolean | undefined> = {};
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--agent",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--quiet",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption("--yes", undefined, longOpts),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--verbose",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--no-banner",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--no-color",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--help",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: true,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--version",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: true,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--chain=mainnet",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(longOpts.chain).toBe("mainnet");
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--rpc-url=http://127.0.0.1:8545",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(longOpts.rpcUrl).toBe("http://127.0.0.1:8545");
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--timeout=9",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(longOpts.timeout).toBe("9");
    expect(
      staticDiscoveryTestInternals.parseLongOption("--chain", undefined, {}),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseLongOption("--rpc-url", undefined, {}),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseLongOption("--timeout", undefined, {}),
    ).toBeNull();

    const shortOpts: Record<string, string | boolean | undefined> = {};
    expect(
      staticDiscoveryTestInternals.parseShortOption("-c", "mainnet", shortOpts),
    ).toEqual({
      consumedNext: true,
      helpLike: false,
      versionLike: false,
    });
    expect(shortOpts.chain).toBe("mainnet");
    expect(
      staticDiscoveryTestInternals.parseShortOption(
        "-r",
        "http://127.0.0.1:8545",
        shortOpts,
      ),
    ).toEqual({
      consumedNext: true,
      helpLike: false,
      versionLike: false,
    });
    expect(shortOpts.rpcUrl).toBe("http://127.0.0.1:8545");
    expect(
      staticDiscoveryTestInternals.parseShortOption("-h", undefined, shortOpts),
    ).toEqual({
      consumedNext: false,
      helpLike: true,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseShortOption("-V", undefined, shortOpts),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: true,
    });
    expect(
      staticDiscoveryTestInternals.parseShortOption("-c", undefined, {}),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseShortOption("-r", undefined, {}),
    ).toBeNull();
  });

  test("index routes root help through the static discovery fast path", async () => {
    forceJsLauncherFallback();
    const runStaticRootHelpMock = mock(async () => undefined);
    const runStaticCompletionQueryMock = mock(async () => false);
    const runStaticDiscoveryCommandMock = mock(async () => false);
    const runCliMock = mock(async () => undefined);

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: runStaticRootHelpMock,
      runStaticCompletionQuery: runStaticCompletionQueryMock,
      runStaticDiscoveryCommand: runStaticDiscoveryCommandMock,
    }));
    mock.module("../../src/cli-main.ts", () => ({
      runCli: runCliMock,
    }));

    setIndexArgv(["--help"]);

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await runImportedIndex("root-help-fast-path");
    });

    expect(exitCode).toBe(0);
    expect(runStaticRootHelpMock).toHaveBeenCalledWith(false);
    expect(runCliMock).not.toHaveBeenCalled();
  });

  test("index serves structured root help through the static fast path", async () => {
    forceJsLauncherFallback();
    const runStaticRootHelpMock = mock(async () => undefined);
    const runCliMock = mock(async () => undefined);

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: runStaticRootHelpMock,
      runStaticCompletionQuery: async () => false,
      runStaticDiscoveryCommand: async () => false,
    }));
    mock.module("../../src/cli-main.ts", () => ({
      runCli: runCliMock,
    }));

    setIndexArgv(["--json", "--help"]);

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await runImportedIndex("root-help-structured");
    });

    expect(exitCode).toBe(0);
    expect(runStaticRootHelpMock).toHaveBeenCalledWith(true);
    expect(runCliMock).not.toHaveBeenCalled();
  });

  test("index routes completion queries through the static completion fast path", async () => {
    forceJsLauncherFallback();
    const runStaticRootHelpMock = mock(async () => undefined);
    const runStaticCompletionQueryMock = mock(async () => true);
    const runStaticDiscoveryCommandMock = mock(async () => false);
    const runCliMock = mock(async () => undefined);

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: runStaticRootHelpMock,
      runStaticCompletionQuery: runStaticCompletionQueryMock,
      runStaticDiscoveryCommand: runStaticDiscoveryCommandMock,
    }));
    mock.module("../../src/cli-main.ts", () => ({
      runCli: runCliMock,
    }));

    setIndexArgv(["completion", "--query", "--words", "privacy-pools st"]);

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await runImportedIndex("completion-fast-path");
    });

    expect(exitCode).toBe(0);
    expect(runStaticCompletionQueryMock).toHaveBeenCalledWith([
      "completion",
      "--query",
      "--words",
      "privacy-pools st",
    ]);
    expect(runCliMock).not.toHaveBeenCalled();
    expect(runStaticDiscoveryCommandMock).not.toHaveBeenCalled();
    expect(runStaticRootHelpMock).not.toHaveBeenCalled();
  });

  test("index falls back to the worker boundary when the completion fast path declines the argv", async () => {
    forceJsLauncherFallback();
    const runLauncherMock = mock(async () => undefined);

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: async () => undefined,
      runStaticCompletionQuery: async () => false,
      runStaticDiscoveryCommand: async () => false,
    }));
    for (const launcherModulePath of LAUNCHER_MODULE_PATHS) {
      mock.module(launcherModulePath, () => ({
        runLauncher: runLauncherMock,
      }));
    }

    setIndexArgv(["completion", "--query", "--words", "privacy-pools st"]);

    await captureAsyncOutput(async () => {
      await runImportedIndex("completion-fallthrough");
    });

    expect(runLauncherMock).toHaveBeenCalledTimes(1);
    expect(runLauncherMock).toHaveBeenCalledWith(
      expect.any(Function),
      ["completion", "--query", "--words", "privacy-pools st"],
    );
  });

  test("index routes guide through the static discovery command fast path", async () => {
    forceJsLauncherFallback();
    const runStaticCompletionQueryMock = mock(async () => false);
    const runStaticDiscoveryCommandMock = mock(async () => true);
    const runCliMock = mock(async () => undefined);

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: async () => undefined,
      runStaticCompletionQuery: runStaticCompletionQueryMock,
      runStaticDiscoveryCommand: runStaticDiscoveryCommandMock,
    }));
    mock.module("../../src/cli-main.ts", () => ({
      runCli: runCliMock,
    }));

    setIndexArgv(["guide", "--json"]);

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await runImportedIndex("discovery-fast-path");
    });

    expect(exitCode).toBe(0);
    expect(runStaticCompletionQueryMock).not.toHaveBeenCalled();
    expect(runStaticDiscoveryCommandMock).toHaveBeenCalledWith(
      ["guide", "--json"],
      expect.objectContaining({
        firstCommandToken: "guide",
        nonOptionTokens: ["guide"],
        isJson: true,
      }),
    );
    expect(runCliMock).not.toHaveBeenCalled();
  });

  test("index falls back to the worker boundary when the static discovery fast path declines", async () => {
    forceJsLauncherFallback();
    const runLauncherMock = mock(async () => undefined);

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: async () => undefined,
      runStaticCompletionQuery: async () => false,
      runStaticDiscoveryCommand: async () => false,
    }));
    for (const launcherModulePath of LAUNCHER_MODULE_PATHS) {
      mock.module(launcherModulePath, () => ({
        runLauncher: runLauncherMock,
      }));
    }

    setIndexArgv(["guide", "--json"]);

    await captureAsyncOutput(async () => {
      await runImportedIndex("discovery-fallthrough");
    });

    expect(runLauncherMock).toHaveBeenCalledTimes(1);
    expect(runLauncherMock).toHaveBeenCalledWith(
      expect.any(Function),
      ["guide", "--json"],
    );
  });

  test("index serves the root version fast path in human and structured modes", async () => {
    forceJsLauncherFallback();
    setIndexArgv(["-V"]);
    const human = await captureAsyncOutputAllowExit(async () => {
      await runImportedIndex("version-human-fast-path");
    });

    expect(human.exitCode).toBe(0);
    expect(human.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(human.stderr).toBe("");

    setIndexArgv(["--output=json", "--version"]);
    const structured = await captureAsyncJsonOutputAllowExit(async () => {
      await runImportedIndex("version-json-fast-path");
    });

    expect(structured.exitCode).toBe(0);
    expect(structured.json.success).toBe(true);
    expect(structured.json.mode).toBe("version");
    expect(structured.json.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(structured.stderr).toBe("");
  });

  test("index routes root help after skipping root option values", async () => {
    forceJsLauncherFallback();
    const runStaticRootHelpMock = mock(async () => undefined);
    const runCliMock = mock(async () => undefined);

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: runStaticRootHelpMock,
      runStaticCompletionQuery: async () => false,
      runStaticDiscoveryCommand: async () => false,
    }));
    mock.module("../../src/cli-main.ts", () => ({
      runCli: runCliMock,
    }));

    setIndexArgv(["--chain", "mainnet", "help"]);

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await runImportedIndex("root-help-after-root-option");
    });

    expect(exitCode).toBe(0);
    expect(runStaticRootHelpMock).toHaveBeenCalledWith(false);
    expect(runCliMock).not.toHaveBeenCalled();
  });

  test("index routes structured root help when --output json is split across tokens", async () => {
    forceJsLauncherFallback();
    const runStaticRootHelpMock = mock(async () => undefined);
    const runCliMock = mock(async () => undefined);

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: runStaticRootHelpMock,
      runStaticCompletionQuery: async () => false,
      runStaticDiscoveryCommand: async () => false,
    }));
    mock.module("../../src/cli-main.ts", () => ({
      runCli: runCliMock,
    }));

    setIndexArgv(["--output", "json", "help"]);

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await runImportedIndex("root-help-format-split");
    });

    expect(exitCode).toBe(0);
    expect(runStaticRootHelpMock).toHaveBeenCalledWith(true);
    expect(runCliMock).not.toHaveBeenCalled();
  });

  test("index serves the structured root version fast path for agent mode", async () => {
    forceJsLauncherFallback();
    setIndexArgv(["--agent", "--version"]);

    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(
      async () => {
        await runImportedIndex("version-agent-fast-path");
      },
    );

    expect(exitCode).toBe(0);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("version");
    expect(String(json.version)).toMatch(/^\d+\.\d+\.\d+/);
    expect(stderr).toBe("");
  });

  test("index passes --no-color through to the launcher", async () => {
    forceJsLauncherFallback();
    const runLauncherMock = mock(async () => undefined);

    for (const launcherModulePath of LAUNCHER_MODULE_PATHS) {
      mock.module(launcherModulePath, () => ({
        runLauncher: runLauncherMock,
      }));
    }

    setIndexArgv(["--no-color", "status"]);

    await captureAsyncOutput(async () => {
      await runImportedIndex("no-color-delegation");
    });

    expect(runLauncherMock).toHaveBeenCalledTimes(1);
    expect(runLauncherMock).toHaveBeenCalledWith(
      expect.any(Function),
      ["--no-color", "status"],
    );
  });

  test("index delegates non-fast invocations to the worker boundary", async () => {
    forceJsLauncherFallback();
    const runLauncherMock = mock(async () => undefined);

    for (const launcherModulePath of LAUNCHER_MODULE_PATHS) {
      mock.module(launcherModulePath, () => ({
        runLauncher: runLauncherMock,
      }));
    }

    setIndexArgv(["status", "--json"]);

    await captureAsyncOutput(async () => {
      await runImportedIndex("full-cli-path");
    });

    expect(runLauncherMock).toHaveBeenCalledTimes(1);
    expect(runLauncherMock).toHaveBeenCalledWith(
      expect.any(Function),
      ["status", "--json"],
    );
  });

  test("index stays inert when imported outside the direct CLI entry path", async () => {
    forceJsLauncherFallback();
    const runLauncherMock = mock(async () => undefined);

    mock.module("../../src/launcher.ts", () => ({
      runLauncher: runLauncherMock,
    }));

    process.argv = ["bun", "eval-script", "--json", "status"];

    const { stdout, stderr } = await captureAsyncOutput(async () => {
      await import(`../../src/index.ts?imported-module-only=${Date.now()}`);
    });

    expect(runLauncherMock).not.toHaveBeenCalled();
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("index rejects Bun as a direct runtime before launching commands", async () => {
    const runLauncherMock = mock(async () => undefined);

    mock.module("../../src/launcher.ts", () => ({
      runLauncher: runLauncherMock,
    }));

    setDirectIndexArgv(["--json", "status"], "bun");
    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: "1.3.11",
    });

    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(async () => {
      await import(`../../src/index.ts?bun-runtime-guard=${Date.now()}`);
    });

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNSUPPORTED_RUNTIME");
    expect(json.error.message).toContain("Node.js only");
    expect(stderr).toBe("");
    expect(exitCode).toBe(2);
    expect(runLauncherMock).not.toHaveBeenCalled();
  });

  test("runCliEntrypoint rejects Bun when imported and invoked manually", async () => {
    const runLauncherMock = mock(async () => undefined);

    mock.module("../../src/launcher.ts", () => ({
      runLauncher: runLauncherMock,
    }));

    setIndexArgv(["--json", "status"]);
    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: "1.3.11",
    });

    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(async () => {
      const module = await import(`../../src/index.ts?bun-import-call=${Date.now()}`);
      await module.runCliEntrypoint(["--json", "status"]);
    });

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNSUPPORTED_RUNTIME");
    expect(json.error.message).toContain("Node.js only");
    expect(stderr).toBe("");
    expect(exitCode).toBe(2);
    expect(runLauncherMock).not.toHaveBeenCalled();
  });

  test("runCliEntrypoint prints human Bun runtime guidance outside structured modes", async () => {
    const runLauncherMock = mock(async () => undefined);

    mock.module("../../src/launcher.ts", () => ({
      runLauncher: runLauncherMock,
    }));

    setIndexArgv(["status"]);
    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: "1.3.11",
    });

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(async () => {
      const module = await import(`../../src/index.ts?bun-human-import-call=${Date.now()}`);
      await module.runCliEntrypoint(["status"]);
    });

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools CLI supports Node.js only.");
    expect(stderr).toContain("npm run dev -- <command>");
    expect(exitCode).toBe(2);
    expect(runLauncherMock).not.toHaveBeenCalled();
  });

  test("runCliEntrypoint applies preview overrides before launching supported runtimes", async () => {
    const runLauncherMock = mock(async () => undefined);
    const applyPreviewRuntimeOverridesMock = mock(() => undefined);

    mock.module("../../src/launcher.ts", () => ({
      runLauncher: runLauncherMock,
    }));
    mock.module("../../src/preview/runtime.ts", () => ({
      applyPreviewRuntimeOverrides: applyPreviewRuntimeOverridesMock,
    }));

    setIndexArgv(["status"]);
    delete process.versions.bun;

    await captureAsyncOutput(async () => {
      const module = await import(`../../src/index.ts?supported-runtime-entrypoint=${Date.now()}`);
      await module.runCliEntrypoint(["status"]);
    });

    expect(applyPreviewRuntimeOverridesMock).toHaveBeenCalledTimes(1);
    expect(runLauncherMock).toHaveBeenCalledTimes(1);
    expect(runLauncherMock).toHaveBeenCalledWith(
      expect.any(Function),
      ["status"],
    );
  });
});
