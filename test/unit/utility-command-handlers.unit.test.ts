import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { handleCapabilitiesCommand } from "../../src/commands/capabilities.ts";
import { handleCompletionCommand } from "../../src/commands/completion.ts";
import { handleDescribeCommand } from "../../src/commands/describe.ts";
import { handleGuideCommand } from "../../src/commands/guide.ts";
import {
  COMPLETION_MANAGED_BLOCK_START,
  buildCompletionInstallPlan,
  performCompletionInstall,
} from "../../src/utils/completion-install.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
} from "../helpers/output.ts";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";

const realInquirerPrompts = await import("@inquirer/prompts");
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_PRIVACY_POOLS_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_STDIN_IS_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_IS_TTY = process.stdout.isTTY;
const ORIGINAL_STDERR_IS_TTY = process.stderr.isTTY;

function fakeRoot(globalOpts: Record<string, unknown> = {}): Command {
  return {
    opts: () => globalOpts,
  } as unknown as Command;
}

function fakeCommand(
  globalOpts: Record<string, unknown> = {},
  args: string[] = [],
): Command {
  return {
    parent: fakeRoot(globalOpts),
    args,
  } as unknown as Command;
}

afterEach(() => {
  mock.restore();
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = ORIGINAL_HOME;
  }
  if (ORIGINAL_PRIVACY_POOLS_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_PRIVACY_POOLS_HOME;
  }
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: ORIGINAL_STDIN_IS_TTY,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: ORIGINAL_STDOUT_IS_TTY,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: ORIGINAL_STDERR_IS_TTY,
  });
  cleanupTrackedTempDirs();
});

describe("utility command handlers", () => {
  test("capabilities returns the static discovery payload in JSON mode", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleCapabilitiesCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.commands).toEqual(expect.any(Array));
    expect(json.commands.some((entry: { name: string }) => entry.name === "flow")).toBe(true);
    expect(json.documentation.reference).toContain("docs/reference.md");
    expect(stderr).toBe("");
  });

  test("guide returns machine-readable help in JSON mode", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleGuideCommand(undefined, {}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("flow ragequit");
    expect(json.help).toContain("--new-wallet");
    expect(stderr).toBe("");
  });

  test("describe returns command metadata for a valid command path", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleDescribeCommand(
        ["stats", "global"],
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.command).toBe("stats global");
    expect(json.safeReadOnly).toBe(true);
    expect(json.examples).toEqual(expect.any(Array));
    expect(stderr).toBe("");
  });

  test("describe returns a structured INPUT error for an unknown command path", async () => {
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleDescribeCommand(["definitely", "missing"], fakeCommand({ json: true })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Unknown command path");
    expect(stderr).toBe("");
    expect(exitCode).toBe(2);
  });

  test("describe returns a structured INPUT error when no command path is provided", async () => {
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleDescribeCommand([], fakeCommand({ json: true })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Missing command path for describe",
    );
    expect(json.error.hint).toContain("Valid command paths:");
    expect(stderr).toBe("");
    expect(exitCode).toBe(2);
  });

  test("completion query returns candidates in JSON mode", async () => {
    const cmd = fakeCommand(
      { json: true },
      ["privacy-pools", "flo"],
    );
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleCompletionCommand(undefined, { query: true, shell: "bash", cword: "1" }, cmd),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-query");
    expect(json.shell).toBe("bash");
    expect(json.candidates).toContain("flow");
    expect(stderr).toBe("");
  });

  test("completion emits a shell script to stdout in human mode", async () => {
    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleCompletionCommand("bash", {}, fakeCommand()),
    );

    expect(stdout).toContain("privacy-pools");
    expect(stdout).toContain("complete");
    expect(stderr).toBe("");
  });

  test("completion --install writes managed files and returns a JSON payload", async () => {
    const home = createTrackedTempDir("pp-completion-install-");
    process.env.HOME = home;
    process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools-base");

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleCompletionCommand(
        "bash",
        { install: true },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-install");
    expect(json.shell).toBe("bash");
    expect(json.scriptPath).toContain(".privacy-pools-base");
    expect(json.profilePath).toBe(join(home, ".bashrc"));
    expect(json.bootstrapProfilePath).toBe(join(home, ".bash_profile"));
    expect(existsSync(json.scriptPath)).toBe(true);
    expect(existsSync(json.profilePath)).toBe(true);
    expect(existsSync(json.bootstrapProfilePath)).toBe(true);
    expect(readFileSync(json.scriptPath, "utf8")).toContain("_privacy_pools_completion");
    expect(readFileSync(json.profilePath, "utf8")).toContain(
      COMPLETION_MANAGED_BLOCK_START,
    );
    expect(readFileSync(json.bootstrapProfilePath, "utf8")).toContain(
      "privacy-pools bash bootstrap",
    );
    expect(stderr).toBe("");
  });

  test("completion install plan uses the provided env for both script and profile paths", async () => {
    const processHome = createTrackedTempDir("pp-completion-install-process-");
    const envHome = createTrackedTempDir("pp-completion-install-env-");
    process.env.HOME = processHome;

    const env = {
      ...process.env,
      HOME: envHome,
      PRIVACY_POOLS_HOME: join(envHome, ".privacy-pools-base"),
    };

    for (const shell of ["bash", "zsh"] as const) {
      const plan = await buildCompletionInstallPlan(shell, env);

      expect(plan.scriptPath).toBe(
        join(envHome, ".privacy-pools-base", "shell", `completion.${shell}`),
      );
      if (shell === "bash") {
        expect(plan.profilePath).toBe(join(envHome, ".bashrc"));
        expect(plan.bootstrapProfilePath).toBe(join(envHome, ".bash_profile"));
      } else {
        expect(plan.profilePath).toBe(join(envHome, ".zshrc"));
        expect(plan.bootstrapProfilePath).toBeUndefined();
      }
    }
  });

  test("bash completion install targets existing shell startup files deterministically", async () => {
    const profileHome = createTrackedTempDir("pp-completion-bash-profile-");
    process.env.HOME = profileHome;
    process.env.PRIVACY_POOLS_HOME = join(profileHome, ".privacy-pools-base");

    const bashProfile = join(profileHome, ".bash_profile");
    writeFileSync(bashProfile, "# existing bash profile\n", "utf8");
    let plan = await buildCompletionInstallPlan("bash");
    expect(plan.profilePath).toBe(bashProfile);
    expect(plan.bootstrapProfilePath).toBeUndefined();

    const bashrcHome = createTrackedTempDir("pp-completion-bashrc-");
    process.env.HOME = bashrcHome;
    process.env.PRIVACY_POOLS_HOME = join(bashrcHome, ".privacy-pools-base");
    const bashrc = join(bashrcHome, ".bashrc");
    writeFileSync(bashrc, "# existing bashrc\n", "utf8");
    plan = await buildCompletionInstallPlan("bash");
    expect(plan.profilePath).toBe(bashrc);
    expect(plan.bootstrapProfilePath).toBeUndefined();
  });

  test("fresh bash completion install creates an idempotent login-shell shim", async () => {
    const home = createTrackedTempDir("pp-completion-bash-bootstrap-");
    process.env.HOME = home;
    process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools-base");

    const firstPlan = await buildCompletionInstallPlan("bash");
    expect(firstPlan.profilePath).toBe(join(home, ".bashrc"));
    expect(firstPlan.bootstrapProfilePath).toBe(join(home, ".bash_profile"));
    expect(firstPlan.bootstrapProfileWillCreate).toBe(true);

    const firstResult = await performCompletionInstall(firstPlan);
    expect(firstResult.bootstrapProfilePath).toBe(join(home, ".bash_profile"));
    expect(firstResult.bootstrapProfileCreated).toBe(true);
    expect(firstResult.bootstrapProfileUpdated).toBe(false);

    const secondPlan = await buildCompletionInstallPlan("bash");
    expect(secondPlan.profilePath).toBe(join(home, ".bashrc"));
    expect(secondPlan.bootstrapProfilePath).toBe(join(home, ".bash_profile"));
    expect(secondPlan.profileWillUpdate).toBe(false);
    expect(secondPlan.bootstrapProfileWillUpdate).toBe(false);

    const secondResult = await performCompletionInstall(secondPlan);
    expect("bootstrapProfilePath" in secondResult).toBe(false);
    expect(readFileSync(join(home, ".bash_profile"), "utf8")).toContain(
      `[ -f "${join(home, ".bashrc")}" ] && . "${join(home, ".bashrc")}"`,
    );
  });

  test("completion --install shows a review surface before writing in human mode", async () => {
    const home = createTrackedTempDir("pp-completion-install-review-");
    process.env.HOME = home;
    process.env.PRIVACY_POOLS_HOME = join(home, ".privacy-pools-base");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });
    const confirmMock = mock(async () => true);
    mock.module("@inquirer/prompts", () => ({
      ...realInquirerPrompts,
      confirm: confirmMock,
    }));

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleCompletionCommand(
        "bash",
        { install: true },
        fakeCommand({}),
      ),
    );

    expect(stdout).toBe("");
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(stderr).toContain("Completion install review");
    expect(stderr).toContain("Bash login shim");
    expect(stderr).toContain("Completion installed");
  });

  test("completion rejects combining --install with --query", async () => {
    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleCompletionCommand(
        "bash",
        { install: true, query: true },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "--install and --query cannot be used together",
    );
    expect(exitCode).toBe(2);
  });

  test("completion returns a structured INPUT error for an invalid shell", async () => {
    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleCompletionCommand(undefined, { shell: "csh" }, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Unsupported shell");
    expect(exitCode).toBe(2);
  });
});
