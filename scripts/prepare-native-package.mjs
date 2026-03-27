import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const rootPackageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
const nativeDistributionModulePath = join(
  repoRoot,
  "src",
  "native-distribution.js",
);
const nativePackageMetadataModulePath = join(
  repoRoot,
  "src",
  "native-package-metadata.js",
);
const runtimeContractModulePath = join(
  repoRoot,
  "src",
  "runtime",
  "runtime-contract.js",
);
const {
  CURRENT_RUNTIME_DESCRIPTOR,
} = await import(pathToFileURL(runtimeContractModulePath).href);
const {
  SUPPORTED_NATIVE_DISTRIBUTIONS,
  getNativeDistributionByTriplet,
} = await import(
  pathToFileURL(nativeDistributionModulePath).href
);
const { sha256File } = await import(
  pathToFileURL(nativePackageMetadataModulePath).href
);
const protocolProfileModulePath = join(
  repoRoot,
  "src",
  "config",
  "protocol-profile.js",
);
const { CLI_PROTOCOL_PROFILE } = await import(
  pathToFileURL(protocolProfileModulePath).href
);

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.split("=", 2);
    const value = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined) i += 1;
    result[key.slice(2)] = value;
  }
  return result;
}

function usageAndExit() {
  process.stderr.write(
    "Usage: node scripts/prepare-native-package.mjs --triplet <triplet> --binary <path> [--out-dir <path>] [--version <version>]\n",
  );
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
const triplet = args.triplet?.trim();
const binary = args.binary?.trim();

if (!triplet || !binary) {
  usageAndExit();
}

const metadata = getNativeDistributionByTriplet(triplet);
if (!metadata) {
  process.stderr.write(
    `Unsupported triplet '${triplet}'. Supported triplets: ${SUPPORTED_NATIVE_DISTRIBUTIONS.map((distribution) => distribution.triplet).join(", ")}\n`,
  );
  process.exit(2);
}

const version = args.version?.trim() || rootPackageJson.version;
const outputDir = resolve(
  args["out-dir"]?.trim() || join(repoRoot, "native", "packages", triplet),
);
const sourceBinary = resolve(binary);
const binDir = join(outputDir, "bin");
const targetBinary = join(binDir, metadata.binaryFileName);

mkdirSync(binDir, { recursive: true });
copyFileSync(sourceBinary, targetBinary);
if (!targetBinary.endsWith(".exe")) {
  chmodSync(targetBinary, 0o755);
}

const sha256 = sha256File(targetBinary);
const packageJson = {
  name: metadata.packageName,
  version,
  description: `Privacy Pools CLI native shell (${metadata.displayName})`,
  license: rootPackageJson.license,
  repository: rootPackageJson.repository,
  os: metadata.os,
  cpu: metadata.cpu,
  ...(metadata.libc ? { libc: metadata.libc } : {}),
  files: ["bin", "README.md", "package.json"],
  privacyPoolsCliNative: {
    triplet,
    binaryPath: `bin/${metadata.binaryFileName}`,
    bridgeVersion: CURRENT_RUNTIME_DESCRIPTOR.nativeBridgeVersion,
    protocolProfile: CLI_PROTOCOL_PROFILE.profile,
    runtimeVersion: CURRENT_RUNTIME_DESCRIPTOR.runtimeVersion,
    sha256,
  },
};

writeFileSync(
  join(outputDir, "package.json"),
  `${JSON.stringify(packageJson, null, 2)}\n`,
  "utf8",
);

writeFileSync(
  join(outputDir, "README.md"),
  `# ${packageJson.name}\n\nNative shell package for Privacy Pools CLI ${version} on ${metadata.displayName}.\n\nImplementation target: \`${triplet}\`\n\nnpm platform selectors: \`os=${metadata.os.join(",")}\`, \`cpu=${metadata.cpu.join(",")}\`${metadata.libc ? `, \`libc=${metadata.libc.join(",")}\`` : ""}\n`,
  "utf8",
);

process.stdout.write(`${outputDir}\n`);
