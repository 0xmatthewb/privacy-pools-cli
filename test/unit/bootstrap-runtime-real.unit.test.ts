import { afterEach, describe, expect, test } from "bun:test";
import { createRootProgram } from "../../src/program.ts";
import { runCli } from "../../src/cli-main.ts";
import { runCliEntrypoint } from "../../src/index.ts";
import {
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import { restoreProcessExitCode } from "../helpers/process.ts";

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_BUN_VERSION = process.versions.bun;
const ORIGINAL_DISABLE_UPDATE_CHECK = process.env.PP_NO_UPDATE_CHECK;

afterEach(() => {
  process.argv = [...ORIGINAL_ARGV];
  restoreProcessExitCode(undefined);
  if (ORIGINAL_DISABLE_UPDATE_CHECK === undefined) {
    delete process.env.PP_NO_UPDATE_CHECK;
  } else {
    process.env.PP_NO_UPDATE_CHECK = ORIGINAL_DISABLE_UPDATE_CHECK;
  }
  if (ORIGINAL_BUN_VERSION === undefined) {
    delete process.versions.bun;
  } else {
    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: ORIGINAL_BUN_VERSION,
    });
  }
});

describe("bootstrap runtime direct coverage", () => {
  test("runCli renders the real welcome flow without forcing a network update check", async () => {
    process.env.PP_NO_UPDATE_CHECK = "1";

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      runCli({ version: "1.2.3", repository: "https://github.com/example/repo" }, []),
    );

    expect(exitCode).toBe(0);
    const output = `${stdout}${stderr}`;
    expect(output).toContain("PRIVACY POOLS");
    expect(output).toContain("v1.2.3");
    expect(output).toMatch(/privacy-pools (init|flow start|--help)/);
  });

  test("runCli emits structured root help through the real program", async () => {
    process.env.PP_NO_UPDATE_CHECK = "1";

    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      runCli({ version: "1.2.3" }, ["--json", "--help"]),
    );

    expect(exitCode).toBe(0);
    expect(json.success).toBe(true);
    expect(json.mode).toBe("describe");
    expect(json.action).toBe("help");
    expect(json.operation).toBe("describe.help");
    expect(typeof json.help).toBe("string");
    expect(stderr).toBe("");
  });

  test("createRootProgram loads the full command surface for unknown help targets", async () => {
    const program = await createRootProgram("1.2.3", {
      argv: ["help", "definitely-not-a-command"],
      loadAllCommands: false,
      styledHelp: false,
    });

    const commandNames = program.commands.map((command) => command.name());
    expect(commandNames).toContain("status");
    expect(commandNames).toContain("ragequit");
    expect(commandNames.length).toBeGreaterThan(5);
  });

  test("runCliEntrypoint returns the structured unsupported-runtime payload under Bun", async () => {
    Object.defineProperty(process.versions, "bun", {
      configurable: true,
      value: "1.3.11",
    });

    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      runCliEntrypoint(["--json"]),
    );

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("UNSUPPORTED_RUNTIME");
    expect(stderr).toBe("");
  });
});
