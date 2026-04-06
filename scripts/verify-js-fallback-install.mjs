import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertInstalledInitViaStdin,
  assertInstalledLauncherBasics,
  assertInstalledStatusSuccess,
  currentNativePackageName,
  fail,
  npmProcessEnv,
  packageInstallPath,
  parseArgs,
  resolveInstalledDependencyPackagePath,
  rootPackageJson,
  runNpmInstallWithRetry,
} from "./lib/install-verification.mjs";

function usageAndExit() {
  process.stderr.write(
    "Usage: node scripts/verify-js-fallback-install.mjs [--cli-tarball <path>] [--package <name> --version <version>]\n",
  );
  process.exit(2);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    usageAndExit();
  }

  const cliTarball = args["cli-tarball"]?.trim() || null;
  const packageName = args.package?.trim() || rootPackageJson.name;
  const expectedVersion = args.version?.trim() || rootPackageJson.version;

  if (!cliTarball && !args.version) {
    usageAndExit();
  }
  if (cliTarball && args.version) {
    fail("Pass either --cli-tarball or --package/--version, not both.");
  }
  if (currentNativePackageName() !== null) {
    fail(
      `JS fallback install verification expects an unsupported native host, but ${process.platform}/${process.arch} resolved ${currentNativePackageName()}.`,
    );
  }

  const installRoot = mkdtempSync(join(tmpdir(), "pp-js-fallback-install-"));
  const homeDir = join(installRoot, ".privacy-pools");
  const initializedHomeDir = join(installRoot, ".privacy-pools-seeded");
  const dependencySpec = cliTarball
    ? `file:${resolve(cliTarball)}`
    : `${packageName}@${expectedVersion}`;
  const label = cliTarball
    ? "Installed JS fallback CLI"
    : "Registry JS fallback CLI";

  try {
    writeFileSync(
      join(installRoot, "package.json"),
      JSON.stringify(
        {
          name: "pp-js-fallback-install-check",
          private: true,
          dependencies: {
            [packageName]: dependencySpec,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const installResult = runNpmInstallWithRetry(
      [
        "install",
        "--silent",
        "--no-package-lock",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: installRoot,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
        env: npmProcessEnv(installRoot),
      },
    );

    if (installResult.error) {
      fail(
        `Failed to execute npm install for ${dependencySpec}:\n${installResult.error.message}`,
      );
    }
    if (installResult.status !== 0) {
      fail(
        `Failed to install ${dependencySpec}:\n${installResult.stderr ?? ""}\n${installResult.stdout ?? ""}`.trim(),
      );
    }

    const installedRootPath = packageInstallPath(installRoot, packageName);
    for (const optionalDependencyName of Object.keys(
      rootPackageJson.optionalDependencies ?? {},
    )) {
      const resolvedOptionalDependency = resolveInstalledDependencyPackagePath(
        installedRootPath,
        optionalDependencyName,
      );
      if (resolvedOptionalDependency && existsSync(resolvedOptionalDependency)) {
        fail(
          `${label} unexpectedly resolved optional native package ${optionalDependencyName} on an unsupported host.`,
        );
      }
    }

    assertInstalledLauncherBasics({
      installRoot,
      homeDir,
      expectedVersion,
      label,
    });

    assertInstalledInitViaStdin({
      installRoot,
      homeDir: initializedHomeDir,
      label,
    });

    const statusPayload = assertInstalledStatusSuccess({
      installRoot,
      homeDir: initializedHomeDir,
      label,
    });
    const nativeWarningPresent = Array.isArray(statusPayload.warnings)
      && statusPayload.warnings.some(
        (warning) => warning?.code === "native_acceleration_unavailable",
      );
    if (nativeWarningPresent) {
      fail(
        `${label} should treat this host as unsupported rather than degraded native availability.`,
      );
    }

    process.stdout.write(
      `Verified JS fallback install for ${packageName}@${expectedVersion} on unsupported native host\n`,
    );
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
}

await main();
