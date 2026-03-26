import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import * as realConsoleGuard from "../../src/utils/console-guard.ts";
import * as realHelp from "../../src/utils/help.ts";

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_NO_COLOR = process.env.NO_COLOR;
const ORIGINAL_PRIVACY_POOLS_HOME = process.env.PRIVACY_POOLS_HOME;

function makeCommanderExit(code: string) {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function makeProgram(
  parseAsyncFactory: (program: {
    configuredOutput: { writeOut?: (value: string) => void };
  }) => () => Promise<void>,
) {
  const program = {
    configuredOutput: {} as { writeOut?: (value: string) => void },
    commands: [],
    showSuggestionAfterError() {},
    showHelpAfterError() {},
    configureOutput(output: { writeOut?: (value: string) => void }) {
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
  mock.restore();
});

describe("bootstrap runtime coverage", () => {
  test("runStaticRootHelp emits the machine help envelope", async () => {
    const { runStaticRootHelp } = await import(
      "../../src/static-discovery.ts?static-root-help"
    );
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticRootHelp(true),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Usage: privacy-pools");
    expect(stderr).toBe("");
  });

  test("runStaticDiscoveryCommand serves capabilities in agent mode", async () => {
    const { runStaticDiscoveryCommand } = await import(
      "../../src/static-discovery.ts?static-capabilities"
    );
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand(["capabilities", "--agent"]),
    );

    expect(json.success).toBe(true);
    expect(json.commands).toEqual(expect.any(Array));
    expect(json.commands.some((entry: { name: string }) => entry.name === "flow")).toBe(true);
    expect(stderr).toBe("");
  });

  test("runStaticDiscoveryCommand renders the guide in human mode", async () => {
    const { runStaticDiscoveryCommand } = await import(
      "../../src/static-discovery.ts?static-guide-human"
    );
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["guide"]);
      expect(handled).toBe(true);
    });

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools: Quick Guide");
    expect(stderr).toContain("migrate status");
  });

  test("runStaticDiscoveryCommand renders describe output in human mode", async () => {
    const { runStaticDiscoveryCommand } = await import(
      "../../src/static-discovery.ts?static-describe-human"
    );
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["describe", "withdraw", "quote"]);
      expect(handled).toBe(true);
    });

    expect(stdout).toBe("");
    expect(stderr).toContain("Command: withdraw quote");
    expect(stderr).toContain("JSON fields:");
  });

  test("runStaticDiscoveryCommand returns structured errors for invalid describe paths", async () => {
    const { runStaticDiscoveryCommand } = await import(
      "../../src/static-discovery.ts?static-describe-error"
    );
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(async () => {
      const handled = await runStaticDiscoveryCommand([
        "--json",
        "describe",
        "not-a-command",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message).toContain("Unknown command path");
    expect(stderr).toBe("");
  });

  test("runStaticDiscoveryCommand rejects csv mode for static commands", async () => {
    const { runStaticDiscoveryCommand } = await import(
      "../../src/static-discovery.ts?static-guide-csv"
    );
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(async () => {
      const handled = await runStaticDiscoveryCommand([
        "--format",
        "csv",
        "guide",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--format csv is not supported for 'guide'");
  });

  test("runStaticDiscoveryCommand returns false for non-static commands", async () => {
    const { runStaticDiscoveryCommand } = await import(
      "../../src/static-discovery.ts?static-false"
    );
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["status"]);
      expect(handled).toBe(false);
    });

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("runStaticCompletionQuery returns completion candidates in JSON mode", async () => {
    const { runStaticCompletionQuery } = await import(
      "../../src/static-discovery.ts?static-completion"
    );
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "privacy-pools",
        "flo",
      ]),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-query");
    expect(json.candidates).toContain("flow");
    expect(stderr).toBe("");
  });

  test("runStaticCompletionQuery renders human completion candidates", async () => {
    const { runStaticCompletionQuery } = await import(
      "../../src/static-discovery.ts?static-completion-human"
    );
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticCompletionQuery([
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "privacy-pools",
        "flo",
      ]);
      expect(handled).toBe(true);
    });

    expect(stdout.trim().split("\n")).toContain("flow");
    expect(stderr).toBe("");
  });

  test("runStaticCompletionQuery reports invalid shells in JSON mode", async () => {
    const { runStaticCompletionQuery } = await import(
      "../../src/static-discovery.ts?static-completion-invalid-shell"
    );
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(async () => {
      const handled = await runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--shell",
        "elvish",
        "--",
        "privacy-pools",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message).toContain("Unsupported shell");
    expect(stderr).toBe("");
  });

  test("runStaticCompletionQuery reports invalid cword values in JSON mode", async () => {
    const { runStaticCompletionQuery } = await import(
      "../../src/static-discovery.ts?static-completion-invalid-cword"
    );
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(async () => {
      const handled = await runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "-1",
        "--",
        "privacy-pools",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message).toContain("Invalid --cword value");
    expect(stderr).toBe("");
  });

  test("runStaticCompletionQuery rejects csv output mode", async () => {
    const { runStaticCompletionQuery } = await import(
      "../../src/static-discovery.ts?static-completion-csv"
    );
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(async () => {
      const handled = await runStaticCompletionQuery([
        "--format",
        "csv",
        "completion",
        "--query",
        "--shell",
        "bash",
        "--",
        "privacy-pools",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--format csv is not supported for 'completion'");
  });

  test("runStaticCompletionQuery returns false when no query invocation is present", async () => {
    const { runStaticCompletionQuery } = await import(
      "../../src/static-discovery.ts?static-completion-false"
    );
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticCompletionQuery(["completion", "bash"]);
      expect(handled).toBe(false);
    });

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("runStaticRootHelp writes styled human help to stdout", async () => {
    const { runStaticRootHelp } = await import(
      "../../src/static-discovery.ts?static-root-help-human"
    );
    const { stdout, stderr } = await captureAsyncOutput(() =>
      runStaticRootHelp(false),
    );

    expect(stdout).toContain("Usage: privacy-pools");
    expect(stdout).toContain("Get started:");
    expect(stderr).toBe("");
  });

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

  test("index routes root help through the static discovery fast path", async () => {
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

  test("index delegates non-fast invocations to runCli", async () => {
    const runCliMock = mock(async () => undefined);
    const installConsoleGuardMock = mock(() => undefined);

    mock.module("../../src/cli-main.ts", () => ({
      runCli: runCliMock,
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
    expect(runCliMock).toHaveBeenCalledWith(
      expect.objectContaining({ version: expect.any(String) }),
      ["status", "--json"],
    );
  });
});
