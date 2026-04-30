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
import { stripAnsi } from "../helpers/contract-assertions.ts";
import { createTrackedTempDir, cleanupTrackedTempDirs } from "../helpers/temp.ts";

const realInquirerPrompts = await import("@inquirer/prompts");
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_PAGER = process.env.PAGER;
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
  if (ORIGINAL_PAGER === undefined) {
    delete process.env.PAGER;
  } else {
    process.env.PAGER = ORIGINAL_PAGER;
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
    expect(json.mode).toBe("guide");
    expect(json.operation).toBe("guide");
    expect(json.help).toContain("flow ragequit");
    expect(json.help).toContain("--new-wallet");
    expect(stderr).toBe("");
  });

  test("guide falls back to rendered output when the pager exits unsuccessfully", async () => {
    process.env.PAGER = "false";
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleGuideCommand(undefined, { pager: true }, fakeCommand()),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools: Quick Guide");
    expect(stderr).toContain("privacy-pools flow start");
  });

  test("describe returns command metadata for a valid command path", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleDescribeCommand(
        ["stats", "global"],
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.command).toBe("protocol-stats");
    expect(json.safeReadOnly).toBe(true);
    expect(json.examples).toEqual(expect.any(Array));
    expect(stderr).toBe("");
  });

  test("describe history documents stale-cache metadata for --no-sync", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleDescribeCommand(
        ["history"],
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.command).toBe("history");
    expect(json.jsonFields).toContain("lastSyncTime");
    expect(json.jsonFields).toContain("syncSkipped");
    expect(json.jsonVariants).toContain(
      "--no-sync: same fields, plus lastSyncTime? when cached local history was used and syncSkipped = true.",
    );
    expect(stderr).toBe("");
  });

  test("describe returns JSON contract fragments for envelope paths", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleDescribeCommand(
        ["envelope.shared.nextAction"],
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.path).toBe("envelope.shared.nextAction");
    expect(json.schema.cliCommand).toContain("omitted when runnable = false");
    expect(json.schema.parameters).toContain("required");
    expect(stderr).toBe("");
  });

  test("describe resolves bare schema paths to envelope paths", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleDescribeCommand(
        ["shared.nextAction"],
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.path).toBe("envelope.shared.nextAction");
    expect(json.schema.cliCommand).toContain("omitted when runnable = false");
    expect(stderr).toBe("");
  });

  test("describe bare nextActions matches the explicit envelope path", async () => {
    const bare = await captureAsyncJsonOutput(() =>
      handleDescribeCommand(
        ["nextActions"],
        fakeCommand({ json: true }),
      ),
    );
    const explicit = await captureAsyncJsonOutput(() =>
      handleDescribeCommand(
        ["envelope.nextActions"],
        fakeCommand({ json: true }),
      ),
    );

    expect(bare.json).toEqual(explicit.json);
    expect(bare.json.path).toBe("envelope.nextActions");
    expect(bare.stderr).toBe("");
    expect(explicit.stderr).toBe("");
  });

  test("describe returns a structured INPUT error for an unknown command path", async () => {
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleDescribeCommand(["definitely", "missing"], fakeCommand({ json: true })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain("Unknown command path");
    expect(json.error.hint).toContain("Envelope schema roots");
    expect(stderr).toBe("");
    expect(exitCode).toBe(2);
  });

  test("describe returns a command index when no command path is provided", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleDescribeCommand([], fakeCommand({ json: true })),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("describe");
    expect(json.action).toBe("index");
    expect(json.operation).toBe("describe.index");
    expect(json.commands).toEqual(expect.any(Array));
    expect(json.envelopeRoots).toEqual(expect.arrayContaining(["commands", "nextActions"]));
    expect(
      json.commands.some((entry: { command: string }) => entry.command === "withdraw"),
    ).toBe(true);
    expect(stderr).toBe("");
  });

  test("describe human output adds when-to-use guidance and related envelope paths", async () => {
    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleDescribeCommand(
        ["deposit"],
        fakeCommand(),
      ),
    );
    const plain = stripAnsi(stderr);

    expect(stdout).toBe("");
    expect(plain).toContain(`When to use:
  With --no-wait, poll tx-status <submissionId> until the deposit transaction confirms, then use flow status <workflowId> or accounts --chain <chain> to follow ASP review.`);
    expect(plain).toContain(`Prerequisites:
  Before you run this command, make sure these prerequisites are satisfied:
  - init`);
    expect(plain).toContain(`Structured examples:
Basic:
  privacy-pools deposit 0.1 ETH
  privacy-pools deposit 100 USDC`);
    expect(plain).toContain(`Related envelope paths:
  envelope.commands.deposit.successFields
  envelope.commands.deposit.variants`);
  });

  test("describe human index renders envelope roots beneath spaced command rows", async () => {
    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleDescribeCommand([], fakeCommand()),
    );
    const plain = stripAnsi(stderr);

    expect(stdout).toBe("");
    expect(plain).toMatch(
      /config profile create\s+Create a new named profile \(Advanced\)/,
    );
    expect(plain).toContain(`Envelope schema roots:
  envelope
  envelope.commands`);
    expect(plain).not.toContain("config profile createCreate");
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
    expect(json.mode).toBe("completion");
    expect(json.action).toBe("query");
    expect(json.operation).toBe("completion.query");
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
    if (stderr.length > 0) {
      expect(stderr).toContain("Use the managed installer instead");
    }
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
    expect(json.mode).toBe("completion");
    expect(json.action).toBe("install");
    expect(json.operation).toBe("completion.install");
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

  test("completion rejects invalid query cursor values before returning candidates", async () => {
    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleCompletionCommand(
        undefined,
        { query: true, shell: "bash", cword: "-1" },
        fakeCommand({ json: true }, ["privacy-pools"]),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Invalid --cword value",
    );
    expect(exitCode).toBe(2);
  });

  test("completion rejects ambiguous shell arguments before rendering scripts", async () => {
    const tooMany = await captureAsyncJsonOutputAllowExit(() =>
      handleCompletionCommand(
        undefined,
        {},
        fakeCommand({ json: true }, ["bash", "zsh"]),
      ),
    );
    expect(tooMany.json.success).toBe(false);
    expect(tooMany.json.errorMessage).toContain("Too many arguments");
    expect(tooMany.exitCode).toBe(2);

    const conflictingShell = await captureAsyncJsonOutputAllowExit(() =>
      handleCompletionCommand(
        "bash",
        { shell: "zsh" },
        fakeCommand({ json: true }, ["bash"]),
      ),
    );
    expect(conflictingShell.json.success).toBe(false);
    expect(conflictingShell.json.errorMessage).toContain(
      "Conflicting shell values",
    );
    expect(conflictingShell.exitCode).toBe(2);
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
