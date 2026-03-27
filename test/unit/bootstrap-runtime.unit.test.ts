import { afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";
import {
  CURRENT_RUNTIME_DESCRIPTOR,
} from "../../src/runtime/runtime-contract.js";
import {
  CURRENT_RUNTIME_REQUEST_ENV,
  decodeCurrentWorkerRequest,
} from "../../src/runtime/current.ts";

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
const realChildProcess = captureModuleExports(await import("node:child_process"));
const realConsoleGuard = captureModuleExports(
  await import("../../src/utils/console-guard.ts"),
);
const realUpdateCheck = captureModuleExports(
  await import("../../src/utils/update-check.ts"),
);

const BOOTSTRAP_RUNTIME_MODULE_RESTORES = [
  ["../../src/program.ts", realProgram],
  ["../../src/utils/banner.ts", realBanner],
  ["../../src/utils/help.ts", realHelp],
  ["../../src/utils/root-help.ts", realRootHelp],
  ["../../src/utils/theme.ts", realTheme],
  ["dotenv", realDotenv],
  ["../../src/static-discovery.ts", realStaticDiscovery],
  ["../../src/cli-main.ts", realCliMain],
  ["node:child_process", realChildProcess],
  ["../../src/utils/console-guard.ts", realConsoleGuard],
  ["../../src/utils/update-check.ts", realUpdateCheck],
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

function makeSpawnChild(exitCode: number = 0) {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    kill: ReturnType<typeof mock>;
  };

  child.exitCode = null;
  child.signalCode = null;
  child.kill = mock(() => undefined);

  queueMicrotask(() => {
    child.exitCode = exitCode;
    child.emit("exit", exitCode, null);
  });

  return child;
}

function forceJsLauncherFallback(): void {
  process.env.PRIVACY_POOLS_CLI_DISABLE_NATIVE = "1";
}

function expectWorkerRequestArgv(
  spawnMock: ReturnType<typeof mock>,
  expectedArgv: string[],
): void {
  const [, args, options] = spawnMock.mock.calls[0] as [
    string,
    string[],
    { env?: NodeJS.ProcessEnv }
  ];

  expect(Array.isArray(args)).toBe(true);
  expect(options?.env?.[CURRENT_RUNTIME_REQUEST_ENV]).toBeTruthy();

  const request = decodeCurrentWorkerRequest(
    String(options?.env?.[CURRENT_RUNTIME_REQUEST_ENV]),
  );

  expect(request).toEqual({
    protocolVersion: CURRENT_RUNTIME_DESCRIPTOR.workerProtocolVersion,
    argv: expectedArgv,
  });
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
  setTty(Boolean(ORIGINAL_STDOUT_IS_TTY), Boolean(ORIGINAL_STDERR_IS_TTY));
  restoreModuleImplementations(BOOTSTRAP_RUNTIME_MODULE_RESTORES);
});

describe("bootstrap runtime coverage", () => {
  test("runCli prints the welcome screen and banner for bare invocation", async () => {
    const program = makeProgram(() => async () => {
      throw makeCommanderExit("commander.helpDisplayed");
    });
    const printBannerMock = mock(async () => undefined);
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
    expect(stdout).toContain("Explore (no wallet needed)");
    expect(stderr).toBe("");
    expect(printBannerMock).toHaveBeenCalledWith({
      version: "1.2.3",
      repository: "github.com/example/repo",
    });
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
    expect(json.errorCode).toBe("INPUT_ERROR");
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
    expect(stderr).toBe("");
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
    const printBannerMock = mock(async () => undefined);
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
    expect(stderr).toContain("stderr note");
    expect(stderr).toContain("danger:danger body");
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

  test("runCli starts the background update check for interactive runtime commands", async () => {
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
    }));

    const { runCli } = await import("../../src/cli-main.ts?update-check-runtime");
    await captureAsyncOutput(() => runCli({ version: "1.2.3" }, ["status"]));

    expect(checkForUpdateInBackgroundMock).toHaveBeenCalledTimes(1);
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

  test("runCli welcome output includes the current update notice for interactive users", async () => {
    const program = makeProgram(() => async () => {
      throw makeCommanderExit("commander.helpDisplayed");
    });
    const printBannerMock = mock(async () => undefined);
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

  test("runCli accepts both inline and split --format json for bare root help", async () => {
    const inlineCli = await import("../../src/cli-main.ts?format-inline-json-help");
    const inline = await captureAsyncJsonOutputAllowExit(() =>
      inlineCli.runCli({ version: "1.2.3" }, ["--format=json"]),
    );
    expect(inline.exitCode).toBe(0);
    expect(inline.json.success).toBe(true);
    expect(inline.json.mode).toBe("help");
    expect(inline.stderr).toBe("");

    const splitCli = await import("../../src/cli-main.ts?format-split-json-help");
    const split = await captureAsyncJsonOutputAllowExit(() =>
      splitCli.runCli({ version: "1.2.3" }, ["--format", "json"]),
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

  test("index routes root help through the static discovery fast path", async () => {
    forceJsLauncherFallback();
    const runStaticRootHelpMock = mock(async () => undefined);
    const runStaticCompletionQueryMock = mock(async () => false);
    const runStaticDiscoveryCommandMock = mock(async () => false);
    const runCliMock = mock(async () => undefined);
    const installConsoleGuardMock = mock(() => undefined);

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: runStaticRootHelpMock,
      runStaticCompletionQuery: runStaticCompletionQueryMock,
      runStaticDiscoveryCommand: runStaticDiscoveryCommandMock,
    }));
    mock.module("../../src/cli-main.ts", () => ({
      runCli: runCliMock,
    }));
    mock.module("../../src/utils/console-guard.ts", () => ({
      ...realConsoleGuard,
      installConsoleGuard: installConsoleGuardMock,
    }));

    process.argv = ["node", "privacy-pools", "--help"];

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await import(`../../src/index.ts?root-help-fast-path=${Date.now()}`);
    });

    expect(exitCode).toBe(0);
    expect(installConsoleGuardMock).toHaveBeenCalledTimes(1);
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

    process.argv = ["node", "privacy-pools", "--json", "--help"];

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await import(`../../src/index.ts?root-help-structured=${Date.now()}`);
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

    process.argv = ["node", "privacy-pools", "completion", "--query", "--words", "privacy-pools st"];

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await import(`../../src/index.ts?completion-fast-path=${Date.now()}`);
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
    const spawnMock = mock(() => makeSpawnChild());

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: async () => undefined,
      runStaticCompletionQuery: async () => false,
      runStaticDiscoveryCommand: async () => false,
    }));
    mock.module("node:child_process", () => ({
      ...realChildProcess,
      spawn: spawnMock,
    }));

    process.argv = [
      "node",
      "privacy-pools",
      "completion",
      "--query",
      "--words",
      "privacy-pools st",
    ];

    await captureAsyncOutput(async () => {
      await import(`../../src/index.ts?completion-fallthrough=${Date.now()}`);
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expectWorkerRequestArgv(spawnMock, [
      "completion",
      "--query",
      "--words",
      "privacy-pools st",
    ]);
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

    process.argv = ["node", "privacy-pools", "guide", "--json"];

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await import(`../../src/index.ts?discovery-fast-path=${Date.now()}`);
    });

    expect(exitCode).toBe(0);
    expect(runStaticCompletionQueryMock).not.toHaveBeenCalled();
    expect(runStaticDiscoveryCommandMock).toHaveBeenCalledWith(["guide", "--json"]);
    expect(runCliMock).not.toHaveBeenCalled();
  });

  test("index falls back to the worker boundary when the static discovery fast path declines", async () => {
    forceJsLauncherFallback();
    const spawnMock = mock(() => makeSpawnChild());

    mock.module("../../src/static-discovery.ts", () => ({
      runStaticRootHelp: async () => undefined,
      runStaticCompletionQuery: async () => false,
      runStaticDiscoveryCommand: async () => false,
    }));
    mock.module("node:child_process", () => ({
      ...realChildProcess,
      spawn: spawnMock,
    }));

    process.argv = ["node", "privacy-pools", "guide", "--json"];

    await captureAsyncOutput(async () => {
      await import(`../../src/index.ts?discovery-fallthrough=${Date.now()}`);
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expectWorkerRequestArgv(spawnMock, ["guide", "--json"]);
  });

  test("index serves the root version fast path in human and structured modes", async () => {
    forceJsLauncherFallback();
    process.argv = ["node", "privacy-pools", "-V"];
    const human = await captureAsyncOutputAllowExit(async () => {
      await import(`../../src/index.ts?version-human-fast-path=${Date.now()}`);
    });

    expect(human.exitCode).toBe(0);
    expect(human.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(human.stderr).toBe("");

    process.argv = ["node", "privacy-pools", "--format=json", "--version"];
    const structured = await captureAsyncJsonOutputAllowExit(async () => {
      await import(`../../src/index.ts?version-json-fast-path=${Date.now()}`);
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

    process.argv = ["node", "privacy-pools", "--chain", "mainnet", "help"];

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await import(`../../src/index.ts?root-help-after-root-option=${Date.now()}`);
    });

    expect(exitCode).toBe(0);
    expect(runStaticRootHelpMock).toHaveBeenCalledWith(false);
    expect(runCliMock).not.toHaveBeenCalled();
  });

  test("index routes structured root help when --format json is split across tokens", async () => {
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

    process.argv = ["node", "privacy-pools", "--format", "json", "help"];

    const { exitCode } = await captureAsyncOutputAllowExit(async () => {
      await import(`../../src/index.ts?root-help-format-split=${Date.now()}`);
    });

    expect(exitCode).toBe(0);
    expect(runStaticRootHelpMock).toHaveBeenCalledWith(true);
    expect(runCliMock).not.toHaveBeenCalled();
  });

  test("index serves the structured root version fast path for agent mode", async () => {
    forceJsLauncherFallback();
    process.argv = ["node", "privacy-pools", "--agent", "--version"];

    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(
      async () => {
        await import(`../../src/index.ts?version-agent-fast-path=${Date.now()}`);
      },
    );

    expect(exitCode).toBe(0);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("version");
    expect(String(json.version)).toMatch(/^\d+\.\d+\.\d+/);
    expect(stderr).toBe("");
  });

  test("index sets NO_COLOR before delegating to the full cli path", async () => {
    forceJsLauncherFallback();
    const spawnMock = mock((_command: string, _args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
      expect(process.env.NO_COLOR).toBe("1");
      expect(options?.env?.NO_COLOR).toBe("1");
      return makeSpawnChild();
    });

    mock.module("node:child_process", () => ({
      ...realChildProcess,
      spawn: spawnMock,
    }));

    process.argv = ["node", "privacy-pools", "--no-color", "status"];

    await captureAsyncOutput(async () => {
      await import(`../../src/index.ts?no-color-delegation=${Date.now()}`);
    });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expectWorkerRequestArgv(spawnMock, ["--no-color", "status"]);
  });

  test("index delegates non-fast invocations to the worker boundary", async () => {
    forceJsLauncherFallback();
    const spawnMock = mock(() => makeSpawnChild());
    const installConsoleGuardMock = mock(() => undefined);

    mock.module("node:child_process", () => ({
      ...realChildProcess,
      spawn: spawnMock,
    }));
    mock.module("../../src/utils/console-guard.ts", () => ({
      ...realConsoleGuard,
      installConsoleGuard: installConsoleGuardMock,
    }));

    process.argv = ["node", "privacy-pools", "status", "--json"];

    await captureAsyncOutput(async () => {
      await import(`../../src/index.ts?full-cli-path=${Date.now()}`);
    });

    expect(installConsoleGuardMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expectWorkerRequestArgv(spawnMock, ["status", "--json"]);
  });
});
