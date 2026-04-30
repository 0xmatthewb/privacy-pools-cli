import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type { CliPackageInfo } from "../package-info.js";
import { CLIError, sanitizeDiagnosticText } from "../utils/errors.js";
import {
  CLI_NPM_PACKAGE_NAME,
  fetchLatestVersion,
  isNewer,
} from "../utils/update-check.js";

export type UpgradeInstallContextKind =
  | "global_npm"
  | "bun_global"
  | "source_checkout"
  | "local_project"
  | "npx"
  | "ci"
  | "unknown";

export type UpgradeStatus =
  | "up_to_date"
  | "ready"
  | "manual"
  | "cancelled"
  | "upgraded";

export interface UpgradeInstallContext {
  kind: UpgradeInstallContextKind;
  supportedAutoRun: boolean;
  reason: string;
}

export interface UpgradeResult {
  mode: "upgrade";
  status: UpgradeStatus;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  performed: boolean;
  command: string | null;
  installContext: UpgradeInstallContext;
  installedVersion: string | null;
  releaseHighlights?: string[];
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface UpgradeServiceDependencies {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fetchLatestVersion?: typeof fetchLatestVersion;
  runCommand?: (
    command: string,
    args: string[],
    options?: {
      env?: NodeJS.ProcessEnv;
      cwd?: string;
    },
  ) => CommandResult;
}

function npmCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function exactUpgradeCommand(targetVersion: string): string {
  return `npm install -g ${CLI_NPM_PACKAGE_NAME}@${targetVersion}`;
}

function localProjectUpgradeCommand(targetVersion: string): string {
  return `npm install ${CLI_NPM_PACKAGE_NAME}@${targetVersion}`;
}

export function loadBundledReleaseHighlights(
  packageRoot: string,
  targetVersion: string,
  limit: number = 3,
): string[] {
  const changelogPath = join(packageRoot, "CHANGELOG.md");
  if (!existsSync(changelogPath)) {
    return [];
  }

  const changelog = readFileSync(changelogPath, "utf8");
  const versionHeader = new RegExp(
    `^## \\[${targetVersion.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\](?:\\s+-\\s+.*)?$`,
    "m",
  );
  const headerMatch = changelog.match(versionHeader);
  if (!headerMatch || headerMatch.index === undefined) {
    return [];
  }

  const afterHeader = changelog.slice(headerMatch.index + headerMatch[0].length);
  const nextSectionIndex = afterHeader.search(/^## \[/m);
  const sectionBody = (nextSectionIndex >= 0
    ? afterHeader.slice(0, nextSectionIndex)
    : afterHeader).trim();

  return sectionBody
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .slice(0, limit);
}

function manualUpgradeCommandForContext(
  installContext: UpgradeInstallContext,
  targetVersion: string,
): string | null {
  switch (installContext.kind) {
    case "global_npm":
    case "bun_global":
    case "source_checkout":
    case "ci":
    case "npx":
    case "unknown":
      return exactUpgradeCommand(targetVersion);
    case "local_project":
      return localProjectUpgradeCommand(targetVersion);
    default:
      return null;
  }
}

function defaultRunCommand(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
  } = {},
): CommandResult {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    // Node 20+ tightened .cmd/.bat spawning per CVE-2024-27980; on Windows
    // npm.cmd cannot be spawned without shell:true. Without this, the
    // upgrade flow's `npm root -g` call returns EINVAL, the install
    // context detector falls back to "local_project", and the spawned
    // upgrade verifier reports manual/declined despite a global install.
    shell: process.platform === "win32",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function realPathOrNull(targetPath: string): string | null {
  try {
    return realpathSync(targetPath);
  } catch {
    return null;
  }
}

function isCiEnvironment(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.CI || env.GITHUB_ACTIONS || env.BUILDKITE);
}

function isSourceCheckout(packageRoot: string): boolean {
  return existsSync(join(packageRoot, ".git"));
}

function looksLikeNpxInstall(packageRoot: string): boolean {
  return (
    packageRoot.includes(`${sep}_npx${sep}`) ||
    packageRoot.includes(`${sep}.npm${sep}_npx${sep}`)
  );
}

function looksLikeNodeModulesInstall(packageRoot: string): boolean {
  const parent = dirname(packageRoot);
  return parent.endsWith(`${sep}node_modules`) || parent.endsWith("/node_modules");
}

function looksLikeBunGlobalInstall(packageRoot: string): boolean {
  return packageRoot.split("\\").join("/").includes(
    "/.bun/install/global/node_modules/",
  );
}

function resolveGlobalNpmRoot(
  deps: UpgradeServiceDependencies,
): string | null {
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const env = deps.env ?? process.env;
  const result = runCommand(
    npmCommand(deps.platform),
    ["root", "-g"],
    { env },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  const stdout = result.stdout.trim();
  return stdout.length > 0 ? stdout : null;
}

export function detectUpgradeInstallContext(
  pkg: CliPackageInfo,
  deps: UpgradeServiceDependencies = {},
): UpgradeInstallContext {
  const env = deps.env ?? process.env;

  if (isCiEnvironment(env)) {
    return {
      kind: "ci",
      supportedAutoRun: false,
      reason: "Automatic upgrade is disabled in CI environments.",
    };
  }

  if (isSourceCheckout(pkg.packageRoot)) {
    return {
      kind: "source_checkout",
      supportedAutoRun: false,
      reason:
        "This CLI is running from a source checkout. Automatic upgrade is unsupported there, so install the published CLI separately with the npm command below.",
    };
  }

  const currentPackageRoot = realPathOrNull(pkg.packageRoot);
  const globalNpmRoot = resolveGlobalNpmRoot(deps);
  const globalPackageRoot = globalNpmRoot
    ? realPathOrNull(join(globalNpmRoot, CLI_NPM_PACKAGE_NAME))
    : null;

  if (
    currentPackageRoot &&
    globalPackageRoot &&
    currentPackageRoot === globalPackageRoot
  ) {
    return {
      kind: "global_npm",
      supportedAutoRun: true,
      reason: "This CLI was detected as a global npm install.",
    };
  }

  if (looksLikeNpxInstall(pkg.packageRoot)) {
    return {
      kind: "npx",
      supportedAutoRun: false,
      reason:
        "Ephemeral npx-style installs are not upgraded in place. Re-run your npm install command manually.",
    };
  }

  if (looksLikeBunGlobalInstall(pkg.packageRoot)) {
    return {
      kind: "bun_global",
      supportedAutoRun: false,
      reason:
        "This CLI appears to be installed from Bun's global package store. Automatic upgrade is unsupported there, so reinstall it with the npm command below.",
    };
  }

  if (looksLikeNodeModulesInstall(pkg.packageRoot)) {
    return {
      kind: "local_project",
      supportedAutoRun: false,
      reason:
        "This CLI appears to be installed inside a local project. Upgrade that project dependency with npm manually.",
    };
  }

  return {
    kind: "unknown",
    supportedAutoRun: false,
    reason:
      "This install was not detected as a supported global npm install, so automatic upgrade is disabled.",
  };
}

export async function inspectUpgrade(
  pkg: CliPackageInfo,
  deps: UpgradeServiceDependencies = {},
): Promise<UpgradeResult> {
  const latestLookup = deps.fetchLatestVersion ?? fetchLatestVersion;
  const latestVersion = await latestLookup();
  if (!latestVersion) {
    throw new CLIError(
      "Failed to check npm for the latest privacy-pools-cli release.",
      "UNKNOWN",
      "Retry later or check npm connectivity, then rerun `privacy-pools upgrade --check`.",
      "UPGRADE_CHECK_FAILED",
      true,
    );
  }

  const installContext = detectUpgradeInstallContext(pkg, deps);
  const updateAvailable = isNewer(latestVersion, pkg.version);
  const command = updateAvailable
    ? manualUpgradeCommandForContext(installContext, latestVersion)
    : null;

  if (!updateAvailable) {
    return {
      mode: "upgrade",
      status: "up_to_date",
      currentVersion: pkg.version,
      latestVersion,
      updateAvailable: false,
      performed: false,
      command,
      installContext,
      installedVersion: pkg.version,
    };
  }

  return {
    mode: "upgrade",
    status: installContext.supportedAutoRun ? "ready" : "manual",
    currentVersion: pkg.version,
    latestVersion,
    updateAvailable: true,
    performed: false,
    command,
    installContext,
    installedVersion: null,
  };
}

export async function performUpgrade(
  result: UpgradeResult,
  deps: UpgradeServiceDependencies = {},
): Promise<UpgradeResult> {
  if (!result.updateAvailable) {
    return result;
  }

  if (!result.installContext.supportedAutoRun) {
    throw new CLIError(
      "Automatic upgrade is not supported from this install context.",
      "INPUT",
      result.installContext.reason,
      "UPGRADE_UNSUPPORTED_CONTEXT",
      false,
    );
  }

  const runCommand = deps.runCommand ?? defaultRunCommand;
  const env = deps.env ?? process.env;
  const args = [
    "install",
    "-g",
    `${CLI_NPM_PACKAGE_NAME}@${result.latestVersion}`,
  ];
  const commandName = npmCommand(deps.platform);
  const installResult = runCommand(commandName, args, { env });

  if (installResult.error || installResult.status !== 0) {
    const detail = sanitizeDiagnosticText(
      installResult.error?.message ||
        installResult.stderr ||
        installResult.stdout ||
        "npm install failed.",
    );
    throw new CLIError(
      "npm could not upgrade privacy-pools-cli.",
      "UNKNOWN",
      `${detail} Retry the upgrade or run ${exactUpgradeCommand(result.latestVersion)} manually.`,
      "UPGRADE_INSTALL_FAILED",
      true,
    );
  }

  return {
    ...result,
    status: "upgraded",
    performed: true,
    installedVersion: result.latestVersion,
  };
}

export function markUpgradeCancelled(
  result: UpgradeResult,
): UpgradeResult {
  return result.updateAvailable
    ? {
        ...result,
        status: "cancelled",
        performed: false,
      }
    : result;
}
