import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliPackageInfo } from "../../src/package-info.ts";
import {
  detectUpgradeInstallContext,
  inspectUpgrade,
  markUpgradeCancelled,
  performUpgrade,
  type UpgradeResult,
} from "../../src/services/upgrade.ts";
import { CLI_NPM_PACKAGE_NAME } from "../../src/utils/update-check.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";

function makePkg(
  packageRoot: string,
  version: string = "1.0.0",
): CliPackageInfo {
  const packageJsonPath = join(packageRoot, "package.json");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    packageJsonPath,
    JSON.stringify({ name: CLI_NPM_PACKAGE_NAME, version }),
    "utf8",
  );
  return {
    version,
    packageRoot,
    packageJsonPath,
  };
}

function manualResult(overrides: Partial<UpgradeResult> = {}): UpgradeResult {
  return {
    mode: "upgrade",
    status: "manual",
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    updateAvailable: true,
    performed: false,
    command: `npm install -g ${CLI_NPM_PACKAGE_NAME}@1.1.0`,
    installContext: {
      kind: "unknown",
      supportedAutoRun: false,
      reason: "manual only",
    },
    installedVersion: null,
    ...overrides,
  };
}

describe("upgrade service", () => {
  test("detects source checkouts before attempting npm global resolution", () => {
    const packageRoot = createTrackedTempDir("pp-upgrade-source-");
    mkdirSync(join(packageRoot, ".git"), { recursive: true });
    const pkg = makePkg(packageRoot);
    let npmRootCalls = 0;

    const context = detectUpgradeInstallContext(pkg, {
      runCommand: () => {
        npmRootCalls += 1;
        return { status: 0, stdout: "", stderr: "" };
      },
    });

    expect(context.kind).toBe("source_checkout");
    expect(context.supportedAutoRun).toBe(false);
    expect(npmRootCalls).toBe(0);
  });

  test("detects CI environments before other install heuristics", () => {
    const packageRoot = createTrackedTempDir("pp-upgrade-ci-");
    const pkg = makePkg(packageRoot);

    const context = detectUpgradeInstallContext(pkg, {
      env: { CI: "true" },
      runCommand: () => {
        throw new Error("npm root should not run in CI detection");
      },
    });

    expect(context.kind).toBe("ci");
    expect(context.supportedAutoRun).toBe(false);
    expect(context.reason).toContain("disabled in CI");
  });

  test("detects supported global npm installs", () => {
    const tempRoot = createTrackedTempDir("pp-upgrade-global-");
    const globalRoot = join(tempRoot, "global", "node_modules");
    const packageRoot = join(globalRoot, CLI_NPM_PACKAGE_NAME);
    const pkg = makePkg(packageRoot);

    const context = detectUpgradeInstallContext(pkg, {
      runCommand: (command, args) => {
        expect(command).toBe(process.platform === "win32" ? "npm.cmd" : "npm");
        expect(args).toEqual(["root", "-g"]);
        return { status: 0, stdout: `${globalRoot}\n`, stderr: "" };
      },
    });

    expect(context.kind).toBe("global_npm");
    expect(context.supportedAutoRun).toBe(true);
  });

  test("detects local project installs inside node_modules", () => {
    const tempRoot = createTrackedTempDir("pp-upgrade-local-");
    const packageRoot = join(
      tempRoot,
      "app",
      "node_modules",
      CLI_NPM_PACKAGE_NAME,
    );
    const pkg = makePkg(packageRoot);
    const globalRoot = join(tempRoot, "global", "node_modules");
    mkdirSync(globalRoot, { recursive: true });

    const context = detectUpgradeInstallContext(pkg, {
      runCommand: () => ({
        status: 0,
        stdout: `${globalRoot}\n`,
        stderr: "",
      }),
    });

    expect(context.kind).toBe("local_project");
    expect(context.supportedAutoRun).toBe(false);
  });

  test("treats Bun global installs as unsupported ambiguous contexts", () => {
    const tempRoot = createTrackedTempDir("pp-upgrade-bun-global-");
    const packageRoot = join(
      tempRoot,
      ".bun",
      "install",
      "global",
      "node_modules",
      CLI_NPM_PACKAGE_NAME,
    );
    const pkg = makePkg(packageRoot);
    const globalRoot = join(tempRoot, "global", "node_modules");
    mkdirSync(globalRoot, { recursive: true });

    const context = detectUpgradeInstallContext(pkg, {
      runCommand: () => ({
        status: 0,
        stdout: `${globalRoot}\n`,
        stderr: "",
      }),
    });

    expect(context.kind).toBe("unknown");
    expect(context.supportedAutoRun).toBe(false);
    expect(context.reason).toContain("Bun");
  });

  test("detects ephemeral npx installs", () => {
    const tempRoot = createTrackedTempDir("pp-upgrade-npx-");
    const packageRoot = join(
      tempRoot,
      ".npm",
      "_npx",
      "12345",
      "node_modules",
      CLI_NPM_PACKAGE_NAME,
    );
    const pkg = makePkg(packageRoot);

    const context = detectUpgradeInstallContext(pkg, {
      runCommand: () => ({
        status: 1,
        stdout: "",
        stderr: "not needed",
      }),
    });

    expect(context.kind).toBe("npx");
    expect(context.supportedAutoRun).toBe(false);
  });

  test("returns up_to_date when npm matches the installed version", async () => {
    const packageRoot = createTrackedTempDir("pp-upgrade-check-");
    const pkg = makePkg(packageRoot, "1.2.0");

    const result = await inspectUpgrade(pkg, {
      fetchLatestVersion: async () => "1.2.0",
      runCommand: () => ({
        status: 1,
        stdout: "",
        stderr: "",
      }),
    });

    expect(result.status).toBe("up_to_date");
    expect(result.updateAvailable).toBe(false);
    expect(result.command).toBeNull();
    expect(result.installedVersion).toBe("1.2.0");
  });

  test("fails closed when the latest npm version cannot be determined", async () => {
    const packageRoot = createTrackedTempDir("pp-upgrade-check-fail-");
    const pkg = makePkg(packageRoot, "1.2.0");

    await expect(
      inspectUpgrade(pkg, {
        fetchLatestVersion: async () => null,
      }),
    ).rejects.toMatchObject({
      code: "UPGRADE_CHECK_FAILED",
      retryable: true,
    });
  });

  test("returns ready for newer versions on supported global npm installs", async () => {
    const tempRoot = createTrackedTempDir("pp-upgrade-ready-");
    const globalRoot = join(tempRoot, "global", "node_modules");
    const packageRoot = join(globalRoot, CLI_NPM_PACKAGE_NAME);
    const pkg = makePkg(packageRoot, "1.0.0");

    const result = await inspectUpgrade(pkg, {
      fetchLatestVersion: async () => "1.3.0",
      runCommand: () => ({
        status: 0,
        stdout: `${globalRoot}\n`,
        stderr: "",
      }),
    });

    expect(result.status).toBe("ready");
    expect(result.updateAvailable).toBe(true);
    expect(result.command).toBe(
      `npm install -g ${CLI_NPM_PACKAGE_NAME}@1.3.0`,
    );
    expect(result.installContext.kind).toBe("global_npm");
  });

  test("returns manual for source checkouts even when a newer version exists", async () => {
    const packageRoot = createTrackedTempDir("pp-upgrade-manual-");
    mkdirSync(join(packageRoot, ".git"), { recursive: true });
    const pkg = makePkg(packageRoot, "1.0.0");

    const result = await inspectUpgrade(pkg, {
      fetchLatestVersion: async () => "1.4.0",
    });

    expect(result.status).toBe("manual");
    expect(result.updateAvailable).toBe(true);
    expect(result.installContext.kind).toBe("source_checkout");
    expect(result.command).toBe(
      `npm install -g ${CLI_NPM_PACKAGE_NAME}@1.4.0`,
    );
  });

  test("returns a local project install command for local project installs", async () => {
    const tempRoot = createTrackedTempDir("pp-upgrade-local-manual-");
    const packageRoot = join(
      tempRoot,
      "app",
      "node_modules",
      CLI_NPM_PACKAGE_NAME,
    );
    const pkg = makePkg(packageRoot, "1.0.0");
    const globalRoot = join(tempRoot, "global", "node_modules");
    mkdirSync(globalRoot, { recursive: true });

    const result = await inspectUpgrade(pkg, {
      fetchLatestVersion: async () => "1.4.0",
      runCommand: () => ({
        status: 0,
        stdout: `${globalRoot}\n`,
        stderr: "",
      }),
    });

    expect(result.status).toBe("manual");
    expect(result.installContext.kind).toBe("local_project");
    expect(result.command).toBe(
      `npm install ${CLI_NPM_PACKAGE_NAME}@1.4.0`,
    );
  });

  test("returns an npm install command for ephemeral npx installs", async () => {
    const tempRoot = createTrackedTempDir("pp-upgrade-npx-manual-");
    const packageRoot = join(
      tempRoot,
      ".npm",
      "_npx",
      "12345",
      "node_modules",
      CLI_NPM_PACKAGE_NAME,
    );
    const pkg = makePkg(packageRoot, "1.0.0");

    const result = await inspectUpgrade(pkg, {
      fetchLatestVersion: async () => "1.4.0",
      runCommand: () => ({
        status: 1,
        stdout: "",
        stderr: "not needed",
      }),
    });

    expect(result.status).toBe("manual");
    expect(result.installContext.kind).toBe("npx");
    expect(result.command).toBe(
      `npm install -g ${CLI_NPM_PACKAGE_NAME}@1.4.0`,
    );
  });

  test("returns a global npm follow-up command for Bun global installs", async () => {
    const tempRoot = createTrackedTempDir("pp-upgrade-bun-global-manual-");
    const packageRoot = join(
      tempRoot,
      ".bun",
      "install",
      "global",
      "node_modules",
      CLI_NPM_PACKAGE_NAME,
    );
    const pkg = makePkg(packageRoot, "1.0.0");
    const globalRoot = join(tempRoot, "global", "node_modules");
    mkdirSync(globalRoot, { recursive: true });

    const result = await inspectUpgrade(pkg, {
      fetchLatestVersion: async () => "1.4.0",
      runCommand: () => ({
        status: 0,
        stdout: `${globalRoot}\n`,
        stderr: "",
      }),
    });

    expect(result.status).toBe("manual");
    expect(result.installContext.kind).toBe("unknown");
    expect(result.installContext.reason).toContain("Bun");
    expect(result.command).toBe(
      `npm install -g ${CLI_NPM_PACKAGE_NAME}@1.4.0`,
    );
  });

  test("returns a global npm follow-up command for ambiguous installs", async () => {
    const packageRoot = createTrackedTempDir("pp-upgrade-unknown-manual-");
    const pkg = makePkg(packageRoot, "1.0.0");

    const result = await inspectUpgrade(pkg, {
      fetchLatestVersion: async () => "1.4.0",
      runCommand: () => ({
        status: 1,
        stdout: "",
        stderr: "unknown root",
      }),
    });

    expect(result.status).toBe("manual");
    expect(result.installContext.kind).toBe("unknown");
    expect(result.command).toBe(
      `npm install -g ${CLI_NPM_PACKAGE_NAME}@1.4.0`,
    );
  });

  test("performUpgrade runs npm install -g for supported contexts", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];

    const result = await performUpgrade(
      manualResult({
        status: "ready",
        installContext: {
          kind: "global_npm",
          supportedAutoRun: true,
          reason: "supported",
        },
      }),
      {
        runCommand: (command, args) => {
          calls.push({ command, args });
          return { status: 0, stdout: "ok", stderr: "" };
        },
      },
    );

    expect(calls).toEqual([
      {
        command: process.platform === "win32" ? "npm.cmd" : "npm",
        args: ["install", "-g", `${CLI_NPM_PACKAGE_NAME}@1.1.0`],
      },
    ]);
    expect(result.status).toBe("upgraded");
    expect(result.performed).toBe(true);
    expect(result.installedVersion).toBe("1.1.0");
  });

  test("performUpgrade is a no-op when the current version is already up to date", async () => {
    const result = await performUpgrade(
      manualResult({
        status: "up_to_date",
        updateAvailable: false,
        currentVersion: "1.1.0",
        latestVersion: "1.1.0",
        installedVersion: "1.1.0",
        command: null,
      }),
      {
        runCommand: () => {
          throw new Error("npm install should not run for up-to-date results");
        },
      },
    );

    expect(result.status).toBe("up_to_date");
    expect(result.performed).toBe(false);
    expect(result.installedVersion).toBe("1.1.0");
  });

  test("performUpgrade rejects unsupported install contexts", async () => {
    await expect(
      performUpgrade(
        manualResult({
          installContext: {
            kind: "local_project",
            supportedAutoRun: false,
            reason: "local dependency",
          },
          command: `npm install ${CLI_NPM_PACKAGE_NAME}@1.1.0`,
        }),
      ),
    ).rejects.toMatchObject({
      code: "UPGRADE_UNSUPPORTED_CONTEXT",
      category: "INPUT",
      hint: "local dependency",
    });
  });

  test("performUpgrade fails closed when npm install fails", async () => {
    await expect(
      performUpgrade(
        manualResult({
          status: "ready",
          installContext: {
            kind: "global_npm",
            supportedAutoRun: true,
            reason: "supported",
          },
        }),
        {
          runCommand: () => ({
            status: 1,
            stdout: "",
            stderr: "permission denied",
          }),
        },
      ),
    ).rejects.toMatchObject({
      code: "UPGRADE_INSTALL_FAILED",
      hint: expect.stringContaining("permission denied"),
    });
  });

  test("markUpgradeCancelled keeps the upgrade pending but non-mutating", () => {
    const result = markUpgradeCancelled(
      manualResult({
        status: "ready",
      }),
    );

    expect(result.status).toBe("cancelled");
    expect(result.performed).toBe(false);
    expect(result.command).toBe(
      `npm install -g ${CLI_NPM_PACKAGE_NAME}@1.1.0`,
    );
  });

  test("markUpgradeCancelled leaves up-to-date results untouched", () => {
    const result = manualResult({
      status: "up_to_date",
      updateAvailable: false,
      latestVersion: "1.0.0",
      command: null,
      installedVersion: "1.0.0",
    });

    expect(markUpgradeCancelled(result)).toBe(result);
  });
});
