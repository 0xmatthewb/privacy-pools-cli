import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import {
  cpSync,
  existsSync,
  mkdirSync,
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
  assertInstalledPackageVersion,
  assertInstalledNativeStatsError,
  assertInstalledNativeStatsSuccess,
  assertInstalledStatusSuccess,
  currentNativePackageName,
  fail,
  isSupportedInstallNodeVersion,
  launchAspFixtureServer,
  packTarball,
  packageInstallPath,
  resolveInstalledDependencyPackagePath,
  parseArgs,
  rootPackageJson,
  npmCommand,
  npmProcessEnv,
  parseJson,
  runNpmInstallWithRetry,
  unsupportedInstallNodeMessage,
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

const cleanupDirs = new Set();
const inspectedTarballCache = new Map();

function rememberTempDir(dirPath) {
  cleanupDirs.add(dirPath);
  return dirPath;
}

function createTempArtifactDir(prefix) {
  return rememberTempDir(mkdtempSync(join(tmpdir(), prefix)));
}

function installTarballForInspection(packageName, tarballPath) {
  const inspectRoot = createTempArtifactDir("pp-release-inspect-");
  writeFileSync(
    join(inspectRoot, "package.json"),
    JSON.stringify({
      name: "pp-release-tarball-inspect",
      private: true,
      dependencies: {
        [packageName]: `file:${tarballPath}`,
      },
    }),
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
      "--omit=optional",
    ],
    {
      cwd: inspectRoot,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      env: npmProcessEnv(inspectRoot),
    },
  );

  if (installResult.error) {
    fail(
      `Failed to inspect package tarball ${tarballPath}:\n${installResult.error.message}`,
    );
  }

  if (installResult.status !== 0) {
    fail(
      `Failed to inspect package tarball ${tarballPath}:\n${installResult.stderr}\n${installResult.stdout}`,
    );
  }

  return packageInstallPath(inspectRoot, packageName);
}

function inspectTarballPackage(packageName, tarballPath) {
  const cached = inspectedTarballCache.get(tarballPath);
  if (cached) {
    return cached;
  }

  const installedPackagePath = installTarballForInspection(
    packageName,
    tarballPath,
  );
  const manifest = JSON.parse(
    readFileSync(join(installedPackagePath, "package.json"), "utf8"),
  );
  const inspected = {
    installedPackagePath,
    manifest,
  };
  inspectedTarballCache.set(tarballPath, inspected);
  return inspected;
}

function prepareRegistryPackage(
  packageName,
  tarballPath,
  options = {},
) {
  const { installedPackagePath, manifest } = inspectTarballPackage(
    packageName,
    tarballPath,
  );

  if (!options.mutateManifest) {
    return {
      name: manifest.name,
      version: manifest.version,
      tarballPath,
      manifest,
    };
  }

  const stageRoot = createTempArtifactDir("pp-release-stage-");
  const stagePackageRoot = join(stageRoot, "package");
  cpSync(installedPackagePath, stagePackageRoot, { recursive: true });

  const stagedManifestPath = join(stagePackageRoot, "package.json");
  const stagedManifest = JSON.parse(
    readFileSync(stagedManifestPath, "utf8"),
  );
  options.mutateManifest(stagedManifest);
  delete stagedManifest.scripts;
  writeFileSync(
    stagedManifestPath,
    JSON.stringify(stagedManifest, null, 2),
    "utf8",
  );

  const tarballOutputRoot = createTempArtifactDir("pp-release-pack-");
  const stagedTarballPath = packTarball(stagePackageRoot, tarballOutputRoot, {
    npmStateRoot: stageRoot,
  });

  return {
    name: stagedManifest.name,
    version: stagedManifest.version,
    tarballPath: stagedTarballPath,
    manifest: stagedManifest,
  };
}

async function launchLocalRegistry(packages) {
  const registryScript = `
    const { createHash } = require("node:crypto");
    const { createServer } = require("node:http");
    const { readFileSync } = require("node:fs");
    const { basename } = require("node:path");

    const packages = JSON.parse(process.env.PP_LOCAL_REGISTRY_PACKAGES || "[]");
    const packageMap = new Map(packages.map((pkg) => {
      const tarballBuffer = readFileSync(pkg.tarballPath);
      return [
        pkg.name,
        {
          ...pkg,
          tarballBuffer,
          shasum: createHash("sha1").update(tarballBuffer).digest("hex"),
          integrity: \`sha512-\${createHash("sha512").update(tarballBuffer).digest("base64")}\`,
        },
      ];
    }));
    const fallbackBase = process.env.PP_LOCAL_REGISTRY_FALLBACK || "https://registry.npmjs.org";

    async function proxyToFallback(req, res, url) {
      const fallbackUrl = new URL(\`\${url.pathname}\${url.search}\`, fallbackBase);
      const upstream = await fetch(fallbackUrl, {
        headers: req.headers.accept ? { accept: req.headers.accept } : undefined,
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      const headers = Object.fromEntries(upstream.headers.entries());
      delete headers["content-encoding"];
      delete headers["transfer-encoding"];
      headers["content-length"] = String(body.byteLength);
      res.writeHead(upstream.status, headers);
      res.end(body);
    }

    const server = createServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const pathname = url.pathname.replace(/\\/+$/, "");
      const decodedPackagePath = decodeURIComponent(pathname.slice(1));

      try {
        if (pathname.startsWith("/tarballs/")) {
          const [, , encodedName, requestedFile] = pathname.split("/");
          const packageName = decodeURIComponent(encodedName || "");
          const pkg = packageMap.get(packageName);
          if (!pkg || basename(pkg.tarballPath) !== requestedFile) {
            await proxyToFallback(req, res, url);
            return;
          }

          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          res.end(pkg.tarballBuffer);
          return;
        }

        const latestMatch = decodedPackagePath.match(/^(.*)\\/latest$/);
        if (latestMatch) {
          const pkg = packageMap.get(latestMatch[1]);
          if (!pkg) {
            await proxyToFallback(req, res, url);
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ name: pkg.name, version: pkg.version }));
          return;
        }

        const pkg = packageMap.get(decodedPackagePath);
        if (!pkg) {
          await proxyToFallback(req, res, url);
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
                shasum: pkg.shasum,
                integrity: pkg.integrity,
              },
            },
          },
        }));
      } catch (error) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end(error instanceof Error ? error.message : String(error));
      }
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

async function assertGlobalNativeStatsSuccess({
  prefix,
  homeDir,
  label,
  missingWorkerPath,
}) {
  const aspFixture = await launchAspFixtureServer(label);
  try {
    const statsResult = runGlobalCli(
      prefix,
      homeDir,
      ["--agent", "stats"],
      {
        PRIVACY_POOLS_ASP_HOST: aspFixture.url,
        PRIVACY_POOLS_CLI_JS_WORKER: missingWorkerPath,
      },
    );
    const statsPayload = parseJson(
      statsResult.stdout,
      "global installed stats --agent",
    );
    if (
      statsResult.status !== 0 ||
      statsPayload.success !== true ||
      statsPayload.mode !== "global-stats"
    ) {
      fail(
        `${label} failed global native read-only success parity:\n${statsResult.stderr}\n${statsResult.stdout}`,
      );
    }
  } finally {
    await aspFixture.close();
  }
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
const installRoot = rememberTempDir(
  mkdtempSync(join(tmpdir(), "pp-release-install-")),
);
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
  if (!isSupportedInstallNodeVersion()) {
    process.stdout.write(
      `${unsupportedInstallNodeMessage("Installed release CLI verification")}\n`,
    );
    return;
  }

  writeInstallProjectManifest(
    installRoot,
    cliTarballPath,
    nativePackageName,
    nativeTarballPath,
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
      `Failed to execute npm install for release tarballs:\n${installResult.error.message}`,
    );
  }

  if (installResult.status !== 0) {
    fail(
      `Failed to install release tarballs:\n${installResult.stderr}\n${installResult.stdout}`,
    );
  }

  const installedRootPath = packageInstallPath(
    installRoot,
    rootPackageJson.name,
  );
  const installedNativePackagePath = resolveInstalledDependencyPackagePath(
    installedRootPath,
    nativePackageName,
  );
  if (!installedNativePackagePath || !existsSync(installedNativePackagePath)) {
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

  const downgradedVersion = "0.0.0";
  const publishedRootPackage = prepareRegistryPackage(
    rootPackageJson.name,
    cliTarballPath,
  );
  const publishedNativePackage = prepareRegistryPackage(
    nativePackageName,
    nativeTarballPath,
  );
  const downgradedRootPackage = prepareRegistryPackage(
    rootPackageJson.name,
    cliTarballPath,
    {
      mutateManifest(manifest) {
        manifest.version = downgradedVersion;
        if (manifest.optionalDependencies) {
          for (const dependencyName of Object.keys(manifest.optionalDependencies)) {
            manifest.optionalDependencies[dependencyName] = downgradedVersion;
          }
        }
      },
    },
  );
  const downgradedNativePackage = prepareRegistryPackage(
    nativePackageName,
    nativeTarballPath,
    {
      mutateManifest(manifest) {
        manifest.version = downgradedVersion;
      },
    },
  );

  const globalPrefix = join(installRoot, "global-prefix");
  mkdirSync(globalPrefix, { recursive: true });
  const globalHomeDir = join(globalPrefix, ".privacy-pools");
  const globalCliPath = globalPackageInstallPath(globalPrefix, rootPackageJson.name);
  const downgradedRegistry = await launchLocalRegistry([
    downgradedRootPackage,
    downgradedNativePackage,
  ]);

  try {
    const globalInstallResult = runNpmInstallWithRetry(
      [
        "install",
        "-g",
        "--prefix",
        globalPrefix,
        `${rootPackageJson.name}@${downgradedVersion}`,
      ],
      {
        cwd: installRoot,
        env: npmProcessEnv(globalPrefix, {
          npm_config_registry: `${downgradedRegistry.baseUrl}/`,
        }),
      },
    );

    if (globalInstallResult.error) {
      fail(
        `Failed to execute npm global install for upgrade verification:\n${globalInstallResult.error.message}`,
      );
    }

    if (globalInstallResult.status !== 0) {
      fail(
        `Failed to install downgraded global release tarballs for upgrade verification:\n${globalInstallResult.stderr}\n${globalInstallResult.stdout}`,
      );
    }
  } finally {
    await downgradedRegistry.close();
  }

  const initialGlobalNativePath = resolveInstalledDependencyPackagePath(
    globalCliPath,
    nativePackageName,
  );

  if (!existsSync(globalCliPath) || !initialGlobalNativePath) {
    fail(
      [
        "Global release install did not resolve the expected global package paths before upgrade verification.",
        `${rootPackageJson.name}: ${globalCliPath} (${existsSync(globalCliPath) ? "present" : "missing"})`,
        `${nativePackageName}: ${initialGlobalNativePath ?? "<not resolved by module resolution>"}`,
      ].join("\n"),
    );
  }

  assertInstalledPackageVersion(
    globalCliPath,
    downgradedVersion,
    "Global installed CLI",
  );
  assertInstalledPackageVersion(
    initialGlobalNativePath,
    downgradedVersion,
    `Global installed native package ${nativePackageName}`,
  );

  const publishedRegistry = await launchLocalRegistry([
    publishedRootPackage,
    publishedNativePackage,
  ]);

  try {
    const upgradeResult = runGlobalCli(
      globalPrefix,
      globalHomeDir,
      ["upgrade", "--yes", "--json"],
      {
        PRIVACY_POOLS_NPM_REGISTRY_URL: `${publishedRegistry.baseUrl}/${rootPackageJson.name}/latest`,
        npm_config_registry: `${publishedRegistry.baseUrl}/`,
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
  } finally {
    await publishedRegistry.close();
  }

  assertInstalledPackageVersion(
    globalCliPath,
    expectedVersion,
    "Global installed CLI",
  );

  const upgradedGlobalNativePath = resolveInstalledDependencyPackagePath(
    globalCliPath,
    nativePackageName,
  );
  if (!upgradedGlobalNativePath || !existsSync(upgradedGlobalNativePath)) {
    fail(
      `Global installed CLI lost ${nativePackageName} after running privacy-pools upgrade.`,
    );
  }

  assertInstalledPackageVersion(
    upgradedGlobalNativePath,
    expectedVersion,
    `Global installed native package ${nativePackageName}`,
  );

  await assertGlobalNativeStatsSuccess({
    prefix: globalPrefix,
    homeDir: globalHomeDir,
    label: "Global installed release CLI",
    missingWorkerPath,
  });

  process.stdout.write(
    `verified installed release artifacts for privacy-pools-cli@${expectedVersion}\n`,
  );
}

try {
  await main();
} finally {
  for (const dirPath of cleanupDirs) {
    rmSync(dirPath, { recursive: true, force: true });
  }
}
