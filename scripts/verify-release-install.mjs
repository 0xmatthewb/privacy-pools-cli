import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  assertInstalledFlowAwaitingFunding,
  assertInstalledInitViaStdin,
  assertInstalledLauncherBasics,
  assertInstalledNativeStatsError,
  assertInstalledNativeStatsSuccess,
  assertInstalledStatusSuccess,
  currentNativePackageName,
  fail,
  packageInstallPath,
  parseArgs,
  rootPackageJson,
  npmCommand,
  npmProcessEnv,
  parseJson,
} from "./lib/install-verification.mjs";
const TEST_MNEMONIC =
  "test test test test test test test test test test test junk";
const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const TEST_RECIPIENT = "0x4444444444444444444444444444444444444444";

function usageAndExit() {
  process.stderr.write(
    "Usage: node scripts/verify-release-install.mjs --cli-tarball <path> --native-tarball <path> [--version <version>]\n",
  );
  process.exit(2);
}

function resolveGlobalPath(prefix, kind) {
  const result = spawnSync(
    npmCommand,
    [kind, "-g", "--prefix", prefix],
    {
      cwd: prefix,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: npmProcessEnv(prefix),
    },
  );

  if (result.error) {
    fail(`Failed to execute npm ${kind} -g --prefix ${prefix}:\n${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(
      `Failed to resolve npm ${kind} -g --prefix ${prefix}:\n${result.stderr}\n${result.stdout}`,
    );
  }

  return result.stdout.trim();
}

function globalPackageInstallPath(prefix, packageName) {
  return join(resolveGlobalPath(prefix, "root"), ...packageName.split("/"));
}

function globalBinPath(prefix) {
  return process.platform === "win32"
    ? join(prefix, "privacy-pools.cmd")
    : join(prefix, "bin", "privacy-pools");
}

async function launchLocalRegistry(packages) {
  const registryScript = `
    const { createHash } = require("node:crypto");
    const { createServer } = require("node:http");
    const { readFileSync } = require("node:fs");
    const { basename } = require("node:path");

    const packages = JSON.parse(process.env.PP_LOCAL_REGISTRY_PACKAGES || "[]");
    const packageMap = new Map(packages.map((pkg) => [pkg.name, pkg]));

    function fileShasum(filePath) {
      return createHash("sha1").update(readFileSync(filePath)).digest("hex");
    }

    function fileIntegrity(filePath) {
      return \`sha512-\${createHash("sha512").update(readFileSync(filePath)).digest("base64")}\`;
    }

    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = url.pathname.replace(/\\/+$/, "");
      const decodedPackagePath = decodeURIComponent(pathname.slice(1));

      if (pathname.startsWith("/tarballs/")) {
        const [, , encodedName, requestedFile] = pathname.split("/");
        const packageName = decodeURIComponent(encodedName || "");
        const pkg = packageMap.get(packageName);
        if (!pkg || basename(pkg.tarballPath) !== requestedFile) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }

        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(readFileSync(pkg.tarballPath));
        return;
      }

      const latestMatch = decodedPackagePath.match(/^(.*)\\/latest$/);
      if (latestMatch) {
        const pkg = packageMap.get(latestMatch[1]);
        if (!pkg) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ name: pkg.name, version: pkg.version }));
        return;
      }

      const pkg = packageMap.get(decodedPackagePath);
      if (!pkg) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const baseUrl = \`http://127.0.0.1:\${port}\`;
      const tarballUrl = \`\${baseUrl}/tarballs/\${encodeURIComponent(pkg.name)}/\${basename(pkg.tarballPath)}\`;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        name: pkg.name,
        "dist-tags": {
          latest: pkg.version,
        },
        versions: {
          [pkg.version]: {
            ...(pkg.manifest || {}),
            name: pkg.name,
            version: pkg.version,
            dist: {
              tarball: tarballUrl,
              shasum: fileShasum(pkg.tarballPath),
              integrity: fileIntegrity(pkg.tarballPath),
            },
          },
        },
      }));
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        process.stderr.write("failed to bind local registry\\n");
        process.exit(1);
        return;
      }
      process.stdout.write(String(address.port));
    });
  `;

  const child = spawn(process.execPath, ["-e", registryScript], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PP_LOCAL_REGISTRY_PACKAGES: JSON.stringify(packages),
    },
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const port = await new Promise((resolvePromise, rejectPromise) => {
    let stderr = "";
    const readyTimeout = setTimeout(() => {
      rejectPromise(
        new Error(`Timed out waiting for local npm registry:\n${stderr}`),
      );
    }, 10_000);

    const settle = (callback) => {
      clearTimeout(readyTimeout);
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      callback();
    };

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.stdout.on("data", (chunk) => {
      const value = Number(chunk.trim());
      if (!Number.isInteger(value) || value <= 0) {
        return;
      }
      settle(() => resolvePromise(value));
    });

    child.once("error", (error) => {
      settle(() => rejectPromise(error));
    });

    child.once("exit", (code, signal) => {
      settle(() =>
        rejectPromise(
          new Error(
            `Local npm registry exited before startup (code=${code}, signal=${signal}).\n${stderr}`,
          ),
        ),
      );
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      await new Promise((resolvePromise) => {
        child.once("exit", () => resolvePromise());
        child.kill("SIGTERM");
      });
    },
  };
}

function runGlobalCli(prefix, homeDir, args, env = {}) {
  const result = spawnSync(globalBinPath(prefix), args, {
    cwd: prefix,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === "win32",
    env: npmProcessEnv(prefix, {
      PP_NO_UPDATE_CHECK: "1",
      NO_COLOR: "1",
      PRIVACY_POOLS_HOME: homeDir,
      npm_config_prefix: prefix,
      ...env,
    }),
  });

  if (result.error) {
    fail(`Failed to execute global privacy-pools CLI:\n${result.error.message}`);
  }

  return result;
}

function writeInstallProjectManifest(
  installRoot,
  cliTarballPath,
  nativePackageName,
  nativeTarballPath,
) {
  writeFileSync(
    join(installRoot, "package.json"),
    JSON.stringify({
      name: "pp-release-install-check",
      private: true,
      dependencies: {
        "privacy-pools-cli": `file:${cliTarballPath}`,
      },
      overrides: {
        [nativePackageName]: `file:${nativeTarballPath}`,
      },
    }),
    "utf8",
  );
}

const args = parseArgs(process.argv.slice(2));
const cliTarball = args["cli-tarball"]?.trim();
const nativeTarball = args["native-tarball"]?.trim();

if (!cliTarball || !nativeTarball) {
  usageAndExit();
}

const expectedVersion = args.version?.trim() || rootPackageJson.version;
const cliTarballPath = resolve(cliTarball);
const nativeTarballPath = resolve(nativeTarball);
const installRoot = mkdtempSync(join(tmpdir(), "pp-release-install-"));
const homeDir = join(installRoot, ".privacy-pools");
const stdinHomeDir = join(installRoot, ".privacy-pools-stdin");
const missingWorkerPath = join(installRoot, "missing-worker.js");
const nativePackageName = currentNativePackageName();

if (!nativePackageName) {
  fail(
    `Installed release verification requires a supported native host, got ${process.platform}/${process.arch}.`,
  );
}

async function main() {
  writeInstallProjectManifest(
    installRoot,
    cliTarballPath,
    nativePackageName,
    nativeTarballPath,
  );

  const installResult = spawnSync(
    npmCommand,
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
      `Failed to execute npm install for release tarballs:\n${installResult.error.message}`,
    );
  }

  if (installResult.status !== 0) {
    fail(
      `Failed to install release tarballs:\n${installResult.stderr}\n${installResult.stdout}`,
    );
  }

  const installedNativePackagePath = packageInstallPath(
    installRoot,
    nativePackageName,
  );
  if (!existsSync(installedNativePackagePath)) {
    fail(
      `Installed release CLI did not resolve ${nativePackageName} through npm optional dependencies.`,
    );
  }

  // Resolve the root package's installed bin target from its own package.json.
  // The installed public privacy-pools shim must remain owned by the root JS
  // launcher even when the optional native package is present.
  assertInstalledLauncherBasics({
    installRoot,
    homeDir,
    expectedVersion,
    missingWorkerPath,
    label: "Installed release CLI",
  });

  assertInstalledInitViaStdin({
    installRoot,
    homeDir: stdinHomeDir,
    label: "Installed release CLI",
    mnemonic: TEST_MNEMONIC,
    privateKey: TEST_PRIVATE_KEY,
  });

  await assertInstalledNativeStatsSuccess({
    installRoot,
    homeDir,
    label: "Installed release CLI",
    missingWorkerPath,
  });

  assertInstalledStatusSuccess({
    installRoot,
    homeDir: stdinHomeDir,
    label: "Installed release CLI",
  });

  assertInstalledStatusSuccess({
    installRoot,
    homeDir: stdinHomeDir,
    label: "Installed release CLI with native disabled",
    env: {
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    },
  });

  const exportPath = join(installRoot, "installed-flow-wallet.txt");
  await assertInstalledFlowAwaitingFunding({
    installRoot,
    homeDir: stdinHomeDir,
    label: "Installed release CLI",
    exportPath,
    recipient: TEST_RECIPIENT,
  });

  assertInstalledNativeStatsError({
    installRoot,
    homeDir,
    label: "Installed release CLI",
  });

  const registry = await launchLocalRegistry([
    {
      name: rootPackageJson.name,
      version: expectedVersion,
      tarballPath: cliTarballPath,
      manifest: {
        bin: rootPackageJson.bin,
        optionalDependencies: rootPackageJson.optionalDependencies,
        engines: rootPackageJson.engines,
      },
    },
  ]);

  try {
    const globalPrefix = join(installRoot, "global-prefix");
    const globalHomeDir = join(globalPrefix, ".privacy-pools");
    const globalInstallResult = spawnSync(
      npmCommand,
      [
        "install",
        "-g",
        "--prefix",
        globalPrefix,
        `file:${cliTarballPath}`,
      ],
      {
        cwd: installRoot,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
        env: npmProcessEnv(globalPrefix),
      },
    );

    if (globalInstallResult.error) {
      fail(
        `Failed to execute npm global install for upgrade verification:\n${globalInstallResult.error.message}`,
      );
    }

    if (globalInstallResult.status !== 0) {
      fail(
        `Failed to install global release tarballs for upgrade verification:\n${globalInstallResult.stderr}\n${globalInstallResult.stdout}`,
      );
    }

    const globalNativeInstallResult = spawnSync(
      npmCommand,
      [
        "install",
        "-g",
        "--prefix",
        globalPrefix,
        `file:${nativeTarballPath}`,
      ],
      {
        cwd: installRoot,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 10 * 1024 * 1024,
        env: npmProcessEnv(globalPrefix),
      },
    );

    if (globalNativeInstallResult.error) {
      fail(
        `Failed to execute npm global native install for upgrade verification:\n${globalNativeInstallResult.error.message}`,
      );
    }

    if (globalNativeInstallResult.status !== 0) {
      fail(
        `Failed to install global native tarball for upgrade verification:\n${globalNativeInstallResult.stderr}\n${globalNativeInstallResult.stdout}`,
      );
    }

    const globalCliPath = globalPackageInstallPath(globalPrefix, rootPackageJson.name);
    const globalNativePath = globalPackageInstallPath(globalPrefix, nativePackageName);
    if (!existsSync(globalCliPath) || !existsSync(globalNativePath)) {
      fail(
        [
          "Global release install did not resolve the expected global package paths before upgrade verification.",
          `${rootPackageJson.name}: ${globalCliPath} (${existsSync(globalCliPath) ? "present" : "missing"})`,
          `${nativePackageName}: ${globalNativePath} (${existsSync(globalNativePath) ? "present" : "missing"})`,
        ].join("\n"),
      );
    }

    const globalPackageJsonPath = join(globalCliPath, "package.json");
    const downgradedGlobalPackage = JSON.parse(
      readFileSync(globalPackageJsonPath, "utf8"),
    );
    downgradedGlobalPackage.version = "0.0.0";
    writeFileSync(
      globalPackageJsonPath,
      JSON.stringify(downgradedGlobalPackage, null, 2),
      "utf8",
    );

    const upgradeResult = runGlobalCli(
      globalPrefix,
      globalHomeDir,
      ["upgrade", "--yes", "--json"],
      {
        PRIVACY_POOLS_NPM_REGISTRY_URL: `${registry.baseUrl}/${rootPackageJson.name}/latest`,
        npm_config_registry: `${registry.baseUrl}/`,
      },
    );

    if (upgradeResult.status !== 0) {
      fail(
        `Global installed CLI upgrade failed:\n${upgradeResult.stderr}\n${upgradeResult.stdout}`,
      );
    }

    const upgradeJson = parseJson(
      upgradeResult.stdout,
      "Global installed CLI upgrade verification",
    );
    if (
      upgradeJson.status !== "upgraded" ||
      upgradeJson.installedVersion !== expectedVersion
    ) {
      fail(
        `Global installed CLI upgrade did not report a completed upgrade:\n${upgradeResult.stdout}`,
      );
    }

    const upgradedGlobalPackage = JSON.parse(
      readFileSync(globalPackageJsonPath, "utf8"),
    );
    if (upgradedGlobalPackage.version !== expectedVersion) {
      fail(
        `Global installed CLI package.json version stayed at ${upgradedGlobalPackage.version} after upgrade instead of ${expectedVersion}.`,
      );
    }

    if (!existsSync(globalNativePath)) {
      fail(
        `Global installed CLI lost ${nativePackageName} after running privacy-pools upgrade.`,
      );
    }

    const nativePackageJson = JSON.parse(
      readFileSync(join(globalNativePath, "package.json"), "utf8"),
    );
    if (nativePackageJson.version !== expectedVersion) {
      fail(
        `Global installed native package version ${nativePackageJson.version} did not match ${expectedVersion} after upgrade.`,
      );
    }
  } finally {
    await registry.close();
  }

  process.stdout.write(
    `verified installed release artifacts for privacy-pools-cli@${expectedVersion}\n`,
  );
}

try {
  await main();
} finally {
  rmSync(installRoot, { recursive: true, force: true });
}
