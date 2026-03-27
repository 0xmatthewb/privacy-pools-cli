import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const rootPackageJson = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
const runtimeContractModulePath = join(
  repoRoot,
  "src",
  "runtime",
  "runtime-contract.js",
);
const {
  CURRENT_NATIVE_BRIDGE_VERSION,
  CURRENT_RUNTIME_VERSION,
} = await import(pathToFileURL(runtimeContractModulePath).href);

const TRIPLET_METADATA = {
  "darwin-arm64": {
    os: ["darwin"],
    cpu: ["arm64"],
    libc: undefined,
    binName: "privacy-pools",
  },
  "darwin-x64": {
    os: ["darwin"],
    cpu: ["x64"],
    libc: undefined,
    binName: "privacy-pools",
  },
  "linux-x64-gnu": {
    os: ["linux"],
    cpu: ["x64"],
    libc: ["glibc"],
    binName: "privacy-pools",
  },
  "win32-x64-msvc": {
    os: ["win32"],
    cpu: ["x64"],
    libc: undefined,
    binName: "privacy-pools.exe",
  },
  "win32-arm64-msvc": {
    os: ["win32"],
    cpu: ["arm64"],
    libc: undefined,
    binName: "privacy-pools.exe",
  },
};

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

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
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

const metadata = TRIPLET_METADATA[triplet];
if (!metadata) {
  process.stderr.write(
    `Unsupported triplet '${triplet}'. Supported triplets: ${Object.keys(TRIPLET_METADATA).join(", ")}\n`,
  );
  process.exit(2);
}

const version = args.version?.trim() || rootPackageJson.version;
const outputDir = resolve(
  args["out-dir"]?.trim() || join(repoRoot, "native", "packages", triplet),
);
const sourceBinary = resolve(binary);
const binDir = join(outputDir, "bin");
const targetBinary = join(binDir, metadata.binName);

mkdirSync(binDir, { recursive: true });
copyFileSync(sourceBinary, targetBinary);
if (!targetBinary.endsWith(".exe")) {
  chmodSync(targetBinary, 0o755);
}

const sha256 = sha256File(targetBinary);
const packageJson = {
  name: `@0xbow/privacy-pools-cli-native-${triplet}`,
  version,
  description: `Privacy Pools CLI native shell (${triplet})`,
  license: rootPackageJson.license,
  repository: rootPackageJson.repository,
  os: metadata.os,
  cpu: metadata.cpu,
  ...(metadata.libc ? { libc: metadata.libc } : {}),
  bin: {
    "privacy-pools": `bin/${metadata.binName}`,
  },
  files: ["bin", "README.md", "package.json"],
  privacyPoolsCliNative: {
    triplet,
    bridgeVersion: CURRENT_NATIVE_BRIDGE_VERSION,
    protocolVersion: CURRENT_NATIVE_BRIDGE_VERSION,
    runtimeVersion: CURRENT_RUNTIME_VERSION,
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
  `# ${packageJson.name}\n\nNative shell package for Privacy Pools CLI ${version} (${triplet}).\n`,
  "utf8",
);

process.stdout.write(`${outputDir}\n`);
