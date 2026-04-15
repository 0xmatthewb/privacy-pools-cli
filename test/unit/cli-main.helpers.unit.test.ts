import { afterEach, describe, expect, mock, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";
import { cliMainTestInternals } from "../../src/cli-main.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncOutput,
} from "../helpers/output.ts";

const ORIGINAL_STDOUT_IS_TTY = process.stdout.isTTY;
const ORIGINAL_STDERR_IS_TTY = process.stderr.isTTY;
const ORIGINAL_CI = process.env.CI;
const ORIGINAL_CODESPACES = process.env.CODESPACES;

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

function createOutputConfigTarget() {
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
    helpInformation() {
      return "stub help";
    },
  };
}

afterEach(() => {
  setTty(Boolean(ORIGINAL_STDOUT_IS_TTY), Boolean(ORIGINAL_STDERR_IS_TTY));
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
});

describe("cli main internal helpers", () => {
  test("normalizeRepositoryUrl handles string, object, and absent repository values", () => {
    expect(
      cliMainTestInternals.normalizeRepositoryUrl("git+https://github.com/0xbow-io/privacy-pools-cli.git"),
    ).toBe("github.com/0xbow-io/privacy-pools-cli");
    expect(
      cliMainTestInternals.normalizeRepositoryUrl({
        url: "ssh://git@github.com/0xbow-io/privacy-pools-cli.git",
      }),
    ).toBe("github.com/0xbow-io/privacy-pools-cli");
    expect(
      cliMainTestInternals.normalizeRepositoryUrl("git@github.com:0xbow-io/privacy-pools-cli.git"),
    ).toBe("github.com/0xbow-io/privacy-pools-cli");
    expect(cliMainTestInternals.normalizeRepositoryUrl({})).toBeNull();
    expect(cliMainTestInternals.normalizeRepositoryUrl(null)).toBeNull();
  });

  test("hasShortFlag and welcome-bundle helpers distinguish exact, bundled, and long flags", () => {
    expect(cliMainTestInternals.hasShortFlag(["-q"], "q")).toBe(true);
    expect(cliMainTestInternals.hasShortFlag(["-qVy"], "V")).toBe(true);
    expect(cliMainTestInternals.hasShortFlag(["--quiet"], "q")).toBe(false);
    expect(cliMainTestInternals.isWelcomeShortFlagBundle("-qvy")).toBe(true);
    expect(cliMainTestInternals.isWelcomeShortFlagBundle("-qjh")).toBe(false);
    expect(cliMainTestInternals.isWelcomeShortFlagBundle("--quiet")).toBe(false);
  });

  test("readLongOptionValue and firstNonOptionToken respect root options that consume values", () => {
    expect(
      cliMainTestInternals.readLongOptionValue(
        ["--format", "json", "--timeout=5"],
        "--format",
      ),
    ).toBe("json");
    expect(
      cliMainTestInternals.readLongOptionValue(
        ["--format", "json", "--timeout=5"],
        "--timeout",
      ),
    ).toBe("5");
    expect(
      cliMainTestInternals.readLongOptionValue(["--format"], "--format"),
    ).toBeNull();

    expect(
      cliMainTestInternals.firstNonOptionToken([
        "--chain",
        "mainnet",
        "--rpc-url",
        "http://127.0.0.1:8545",
        "guide",
      ]),
    ).toBe("guide");
  });

  test("isWelcomeFlagOnlyInvocation accepts welcome-safe flags and rejects missing values or subcommands", () => {
    expect(cliMainTestInternals.isWelcomeFlagOnlyInvocation([])).toBe(true);
    expect(
      cliMainTestInternals.isWelcomeFlagOnlyInvocation([
        "-qvy",
        "--chain=mainnet",
        "--timeout",
        "5",
        "--no-banner",
      ]),
    ).toBe(true);
    expect(
      cliMainTestInternals.isWelcomeFlagOnlyInvocation(["--chain"]),
    ).toBe(false);
    expect(
      cliMainTestInternals.isWelcomeFlagOnlyInvocation(["status"]),
    ).toBe(false);
  });

  test("configHome prefers PRIVACY_POOLS_HOME, then config dir, then the default home path", () => {
    process.env.PRIVACY_POOLS_HOME = "/tmp/pp-home";
    process.env.PRIVACY_POOLS_CONFIG_DIR = "/tmp/pp-config";
    expect(cliMainTestInternals.configHome()).toBe("/tmp/pp-home");

    delete process.env.PRIVACY_POOLS_HOME;
    expect(cliMainTestInternals.configHome()).toBe("/tmp/pp-config");

    delete process.env.PRIVACY_POOLS_CONFIG_DIR;
    expect(cliMainTestInternals.configHome()).toContain(".privacy-pools");
  });

  test("maybeLoadConfigEnv skips help-like paths and loads dotenv for runtime commands only", async () => {
    const dotenvConfigMock = mock(() => undefined);
    mock.module("dotenv", () => ({
      config: dotenvConfigMock,
    }));

    process.env.PRIVACY_POOLS_HOME = "/tmp/pp-home";
    await cliMainTestInternals.maybeLoadConfigEnv(
      "guide",
      false,
      false,
      false,
    );
    await cliMainTestInternals.maybeLoadConfigEnv(
      "status",
      true,
      false,
      false,
    );
    await cliMainTestInternals.maybeLoadConfigEnv(
      "status",
      false,
      true,
      false,
    );
    await cliMainTestInternals.maybeLoadConfigEnv(
      "status",
      false,
      false,
      true,
    );

    expect(dotenvConfigMock).not.toHaveBeenCalled();

    await cliMainTestInternals.maybeLoadConfigEnv(
      "status",
      false,
      false,
      false,
    );

    expect(dotenvConfigMock).toHaveBeenCalledWith({
      path: "/tmp/pp-home/.env",
    });
  });

  test("configureCommanderOutput styles human output and captures machine help output", async () => {
    const humanProgram = createOutputConfigTarget();
    cliMainTestInternals.configureCommanderOutput(humanProgram as never, {
      captureMachineOutput: false,
      isWelcome: false,
      isMachineMode: false,
      styleCommanderHelp: (value: string) => `styled:${value}`,
      dangerTone: (value: string) => `danger:${value}`,
      machineOutput: { value: "" },
    });

    const human = await captureAsyncOutput(async () => {
      humanProgram.configuredOutput.writeOut?.("hello");
      humanProgram.configuredOutput.writeErr?.("warn");
      humanProgram.configuredOutput.outputError?.(
        "boom",
        (value: string) => humanProgram.configuredOutput.writeErr?.(value),
      );
    });
    expect(human.stdout).toBe("styled:hello");
    expect(human.stderr).toBe("warndanger:boom");

    const machineProgram = createOutputConfigTarget();
    const machineOutput = { value: "" };
    cliMainTestInternals.configureCommanderOutput(machineProgram as never, {
      captureMachineOutput: true,
      isWelcome: false,
      isMachineMode: true,
      styleCommanderHelp: null,
      dangerTone: null,
      machineOutput,
    });
    const machine = await captureAsyncOutput(async () => {
      machineProgram.configuredOutput.writeOut?.("json-help");
      machineProgram.configuredOutput.writeErr?.("ignored");
      machineProgram.configuredOutput.outputError?.("ignored", () => {});
    });
    expect(machine.stdout).toBe("");
    expect(machine.stderr).toBe("");
    expect(machineOutput.value).toBe("json-help");
  });

  test("applyMachineMode disables commander help styling recursively", async () => {
    const child = createOutputConfigTarget();
    const parent = createOutputConfigTarget();
    parent.commands = [child];

    cliMainTestInternals.applyMachineMode(parent as never, {
      captureMachineOutput: false,
      styleCommanderHelp: (value: string) => `machine:${value}`,
      machineOutput: { value: "" },
    });

    const captured = await captureAsyncOutput(async () => {
      parent.configuredOutput.writeOut?.("root");
      child.configuredOutput.writeOut?.("child");
      parent.configuredOutput.writeErr?.("ignored");
      child.configuredOutput.writeErr?.("ignored");
    });

    expect(captured.stdout).toBe("machine:rootmachine:child");
    expect(captured.stderr).toBe("");
    expect(parent.suggestionArgs).toContain(false);
    expect(parent.helpArgs).toContain(false);
    expect(child.suggestionArgs).toContain(false);
    expect(child.helpArgs).toContain(false);
    expect(parent.exitOverride).toHaveBeenCalledTimes(1);
    expect(child.exitOverride).toHaveBeenCalledTimes(1);
  });

  test("structured output helpers render root help and commander signal payloads", async () => {
    const helpProgram = createOutputConfigTarget();
    const rootHelp = await captureAsyncJsonOutput(async () => {
      cliMainTestInternals.emitStructuredRootHelpIfNeeded(helpProgram as never, {
        isStructuredOutputMode: true,
        isHelpLike: false,
        isVersionLike: false,
        firstCommandToken: undefined,
      });
    });
    expect(rootHelp.json.success).toBe(true);
    expect(rootHelp.json.mode).toBe("help");
    expect(rootHelp.json.help).toBe("stub help");

    const versionPayload = await captureAsyncJsonOutput(async () => {
      cliMainTestInternals.emitCommanderSignalPayload(
        helpProgram as never,
        "commander.version",
        {
          captureMachineOutput: true,
          isStructuredOutputMode: true,
          machineOutput: { value: "9.9.9\n" },
          version: "1.2.3",
        },
      );
    });
    expect(versionPayload.json.success).toBe(true);
    expect(versionPayload.json.mode).toBe("version");
    expect(versionPayload.json.version).toBe("9.9.9");

    const structuredHelp = await captureAsyncJsonOutput(async () => {
      cliMainTestInternals.emitCommanderSignalPayload(
        helpProgram as never,
        "commander.help",
        {
          captureMachineOutput: false,
          isStructuredOutputMode: true,
          machineOutput: { value: "" },
          version: "1.2.3",
        },
      );
    });
    expect(structuredHelp.json.success).toBe(true);
    expect(structuredHelp.json.mode).toBe("help");
    expect(structuredHelp.json.help).toBe("stub help");
  });

  test("mapCommanderError normalizes commander input failures and ignores unrelated errors", () => {
    const mapped = cliMainTestInternals.mapCommanderError({
      code: "commander.unknownOption",
      message: "error: unknown option '--oops'",
    });
    expect(mapped).toBeInstanceOf(CLIError);
    expect(mapped?.code).toBe("INPUT_UNKNOWN_OPTION");
    expect(mapped?.message).toBe("unknown option '--oops'");
    expect(mapped?.hint).toContain("--help");

    expect(cliMainTestInternals.mapCommanderError(new Error("boom"))).toBeNull();
    expect(cliMainTestInternals.mapCommanderError({ code: "other.error" })).toBeNull();
  });

  test("shouldStartUpdateCheck only enables interactive welcome screens", () => {
    setTty(true);
    delete process.env.CI;
    delete process.env.CODESPACES;

    expect(
      cliMainTestInternals.shouldStartUpdateCheck(undefined, true, false, false, false, false),
    ).toBe(true);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("status", false, false, false, false, false),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(undefined, true, true, false, false, false),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(undefined, true, false, true, false, false),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("guide", false, false, false, false, false),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(undefined, true, false, false, true, false),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(undefined, true, false, false, false, true),
    ).toBe(false);
    setTty(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(undefined, true, false, false, false, false),
    ).toBe(false);
    setTty(true);
    process.env.CI = "1";
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(undefined, true, false, false, false, false),
    ).toBe(false);
    delete process.env.CI;
    process.env.CODESPACES = "1";
    expect(
      cliMainTestInternals.shouldStartUpdateCheck(undefined, true, false, false, false, false),
    ).toBe(false);
  });
});
