import { afterEach, expect, mock, test } from "bun:test";
import type { CliPackageInfo } from "../../src/cli-main.ts";
import * as realHelp from "../../src/utils/help.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";

type ProgramOutput = { writeOut?: (value: string) => void };

const ORIGINAL_PRIVACY_POOLS_HOME = process.env.PRIVACY_POOLS_HOME;

let helpText = "stub help";
let parseAsyncImpl = async (_output: ProgramOutput) => {};
const bannerCalls: Array<Record<string, unknown>> = [];
const dotenvCalls: Array<Record<string, unknown>> = [];
let updateNotice: string | null = null;
let backgroundUpdateChecks = 0;

const program = {
  configuredOutput: {} as ProgramOutput,
  commands: [],
  showSuggestionAfterError() {},
  showHelpAfterError() {},
  configureOutput(output: ProgramOutput) {
    this.configuredOutput = output;
  },
  exitOverride() {},
  helpInformation() {
    return helpText;
  },
  async parseAsync() {
    await parseAsyncImpl(this.configuredOutput);
  },
};

mock.module("../../src/program.ts", () => ({
  createRootProgram: async () => program,
}));

mock.module("../../src/utils/banner.ts", () => ({
  printBanner: async (meta: Record<string, unknown>) => {
    bannerCalls.push(meta);
  },
}));

mock.module("../../src/utils/help.ts", () => ({
  ...realHelp,
  welcomeScreen: () => "welcome body",
}));

mock.module("dotenv", () => ({
  config: (options: Record<string, unknown>) => {
    dotenvCalls.push(options);
  },
}));

mock.module("../../src/utils/update-check.ts", () => ({
  checkForUpdateInBackground: () => {
    backgroundUpdateChecks += 1;
  },
  getUpdateNotice: () => updateNotice,
}));

const { runCli } = await import("../../src/cli-main.ts");

function makeCommanderExit(code: string, message = code) {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

afterEach(() => {
  helpText = "stub help";
  parseAsyncImpl = async () => {};
  bannerCalls.length = 0;
  dotenvCalls.length = 0;
  updateNotice = null;
  backgroundUpdateChecks = 0;
  if (ORIGINAL_PRIVACY_POOLS_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_PRIVACY_POOLS_HOME;
  }
});

test("cli main coverage emits machine-readable help for bare structured invocations", async () => {
  helpText = "root help body";

  const { json, stderr } = await captureAsyncJsonOutput(() =>
    runCli({ version: "1.2.3" }, ["--json"]),
  );

  expect(json.success).toBe(true);
  expect(json.mode).toBe("help");
  expect(json.help).toBe("root help body");
  expect(stderr).toBe("");
});

test("cli main coverage emits machine-readable help for structured help invocations", async () => {
  parseAsyncImpl = async (output) => {
    output.writeOut?.("machine help body");
    throw makeCommanderExit("commander.help");
  };

  const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
    runCli({ version: "1.2.3" }, ["--json", "--help"]),
  );

  expect(exitCode).toBe(0);
  expect(json.success).toBe(true);
  expect(json.mode).toBe("help");
  expect(json.help).toBe("machine help body");
  expect(stderr).toBe("");
});

test("cli main coverage emits machine-readable version payloads", async () => {
  parseAsyncImpl = async (output) => {
    output.writeOut?.("9.9.9");
    throw makeCommanderExit("commander.version");
  };

  const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
    runCli({ version: "1.2.3" }, ["--json", "--version"]),
  );

  expect(exitCode).toBe(0);
  expect(json.success).toBe(true);
  expect(json.mode).toBe("version");
  expect(json.version).toBe("9.9.9");
  expect(stderr).toBe("");
});

test("cli main coverage prints the welcome screen and normalized banner metadata", async () => {
  parseAsyncImpl = async () => {
    throw makeCommanderExit("commander.helpDisplayed");
  };

  const pkg: CliPackageInfo = {
    version: "1.2.3",
    repository: { url: "git+https://github.com/example/repo.git" },
  };
  const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
    runCli(pkg, []),
  );

  expect(exitCode).toBe(0);
  expect(stdout).toContain("welcome body");
  expect(stderr).toBe("");
  expect(bannerCalls).toEqual([
    {
      version: "1.2.3",
      repository: "github.com/example/repo",
    },
  ]);
});

test("cli main coverage skips banner and welcome output in quiet welcome mode", async () => {
  parseAsyncImpl = async () => {
    throw makeCommanderExit("commander.helpDisplayed");
  };

  const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
    runCli({ version: "1.2.3" }, ["--quiet"]),
  );

  expect(exitCode).toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toBe("");
  expect(bannerCalls).toHaveLength(0);
});

test("cli main coverage maps commander input errors into machine-readable errors", async () => {
  parseAsyncImpl = async () => {
    throw makeCommanderExit(
      "commander.unknownOption",
      "error: unknown option '--oops'",
    );
  };

  const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
    runCli({ version: "1.2.3" }, ["--json", "--oops"]),
  );

  expect(exitCode).toBe(2);
  expect(json.success).toBe(false);
  expect(json.errorCode).toBe("INPUT_ERROR");
  expect(json.error.message).toContain("unknown option '--oops'");
  expect(stderr).toBe("");
});

test("cli main coverage exits with INPUT status for human commander errors", async () => {
  parseAsyncImpl = async () => {
    throw makeCommanderExit(
      "commander.invalidArgument",
      "error: invalid value for '--timeout'",
    );
  };

  const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
    runCli({ version: "1.2.3" }, ["--timeout", "NaN"]),
  );

  expect(exitCode).toBe(2);
  expect(stdout).toBe("");
  expect(stderr).toBe("");
});

test("cli main coverage loads config-home dotenv for runtime and skips static local commands", async () => {
  process.env.PRIVACY_POOLS_HOME = "/tmp/privacy-pools-home";

  await captureAsyncJsonOutput(() =>
    runCli({ version: "1.2.3" }, ["--json"]),
  );
  expect(dotenvCalls).toEqual([
    {
      path: "/tmp/privacy-pools-home/.env",
    },
  ]);

  await captureAsyncOutputAllowExit(() =>
    runCli({ version: "1.2.3" }, ["guide"]),
  );
  expect(dotenvCalls).toEqual([
    {
      path: "/tmp/privacy-pools-home/.env",
    },
  ]);
});
