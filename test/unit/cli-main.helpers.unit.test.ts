import { afterEach, describe, expect, test } from "bun:test";
import { CLIError } from "../../src/utils/errors.ts";
import { cliMainTestInternals } from "../../src/cli-main.ts";

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

  test("mapCommanderError normalizes commander input failures and ignores unrelated errors", () => {
    const mapped = cliMainTestInternals.mapCommanderError({
      code: "commander.unknownOption",
      message: "error: unknown option '--oops'",
    });
    expect(mapped).toBeInstanceOf(CLIError);
    expect(mapped?.code).toBe("INPUT_ERROR");
    expect(mapped?.message).toBe("unknown option '--oops'");
    expect(mapped?.hint).toContain("--help");

    expect(cliMainTestInternals.mapCommanderError(new Error("boom"))).toBeNull();
    expect(cliMainTestInternals.mapCommanderError({ code: "other.error" })).toBeNull();
  });

  test("shouldStartUpdateCheck only enables interactive non-static human commands", () => {
    setTty(true);
    delete process.env.CI;
    delete process.env.CODESPACES;

    expect(
      cliMainTestInternals.shouldStartUpdateCheck("status", false, false, false, false),
    ).toBe(true);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("status", true, false, false, false),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("status", false, true, false, false),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("guide", false, false, false, false),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("status", false, false, true, false),
    ).toBe(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("status", false, false, false, true),
    ).toBe(false);
    setTty(false);
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("status", false, false, false, false),
    ).toBe(false);
    setTty(true);
    process.env.CI = "1";
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("status", false, false, false, false),
    ).toBe(false);
    delete process.env.CI;
    process.env.CODESPACES = "1";
    expect(
      cliMainTestInternals.shouldStartUpdateCheck("status", false, false, false, false),
    ).toBe(false);
  });
});
