import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const mode = process.argv.includes("--check") ? "check" : "write";

const distModulePath = join(
  repoRoot,
  "dist",
  "utils",
  "command-discovery-metadata.js",
);

const sourceMetadataModulePath = join(
  repoRoot,
  "src",
  "utils",
  "command-discovery-metadata.ts",
);
const distRootFlagsModulePath = join(
  repoRoot,
  "dist",
  "utils",
  "root-global-flags.js",
);
const distCompletionShellModulePath = join(
  repoRoot,
  "dist",
  "utils",
  "completion-shell.js",
);
const sourceRootFlagsModulePath = join(
  repoRoot,
  "src",
  "utils",
  "root-global-flags.ts",
);
const sourceCompletionShellModulePath = join(
  repoRoot,
  "src",
  "utils",
  "completion-shell.ts",
);
const distJsonUtilsModulePath = join(
  repoRoot,
  "dist",
  "utils",
  "json.js",
);
const sourceJsonUtilsModulePath = join(
  repoRoot,
  "src",
  "utils",
  "json.ts",
);

const distProgramModulePath = join(
  repoRoot,
  "dist",
  "program.js",
);
const sourceCliPath = join(repoRoot, "src", "index.ts");

const manifestModulePath = join(
  repoRoot,
  "src",
  "utils",
  "command-manifest.ts",
);
const routingModulePath = join(
  repoRoot,
  "src",
  "utils",
  "command-routing-static.ts",
);

const nativeShellManifestPath = join(
  repoRoot,
  "native",
  "shell",
  "generated",
  "manifest.json",
);
const nativeRuntimeContractPath = join(
  repoRoot,
  "native",
  "shell",
  "generated",
  "runtime-contract.json",
);
const nativeRootFlagsPath = join(
  repoRoot,
  "native",
  "shell",
  "generated",
  "root-flags.json",
);
const nativeCompletionShellPath = join(
  repoRoot,
  "native",
  "shell",
  "generated",
  "completion-shell.json",
);

const packageJsonPath = join(repoRoot, "package.json");

const metadataModulePath = existsSync(distModulePath)
  ? distModulePath
  : sourceMetadataModulePath;
const rootFlagsModulePath = existsSync(distRootFlagsModulePath)
  ? distRootFlagsModulePath
  : sourceRootFlagsModulePath;
const completionShellModulePath = existsSync(distCompletionShellModulePath)
  ? distCompletionShellModulePath
  : sourceCompletionShellModulePath;
const jsonUtilsModulePath = existsSync(distJsonUtilsModulePath)
  ? distJsonUtilsModulePath
  : sourceJsonUtilsModulePath;

const runtimeContractModulePath = join(
  repoRoot,
  "src",
  "runtime",
  "runtime-contract.js",
);

const {
  COMMAND_PATHS,
  listCommandPaths,
  buildCapabilitiesPayload,
  getCommandExecutionMetadata,
} = await import(
  pathToFileURL(metadataModulePath).href
);
const { ROOT_GLOBAL_FLAG_METADATA } = await import(
  pathToFileURL(rootFlagsModulePath).href
);
const { COMPLETION_SHELL_CONTRACT, SUPPORTED_COMPLETION_SHELLS } = await import(
  pathToFileURL(completionShellModulePath).href
);
const { JSON_SCHEMA_VERSION } = await import(
  pathToFileURL(jsonUtilsModulePath).href
);
const {
  CURRENT_MANIFEST_VERSION,
  CURRENT_RUNTIME_DESCRIPTOR,
  CURRENT_RUNTIME_VERSION,
} = await import(pathToFileURL(runtimeContractModulePath).href);

const capabilitiesPayload = buildCapabilitiesPayload();
const documentedCommandPaths = listCommandPaths();
const routingCommandPaths = COMMAND_PATHS.filter((path) => path !== "stats");
const packageJson = JSON.parse(
  readFileSync(packageJsonPath, "utf8"),
);
const cliVersion = packageJson.version;
const rootCommandPaths = documentedCommandPaths.filter((path) => !path.includes(" "));
const rootCommands = rootCommandPaths.map((path) => {
  const descriptor = capabilitiesPayload.commandDetails[path];
  return {
    name: path,
    aliases: descriptor?.aliases ?? [],
    description: descriptor?.description ?? path,
  };
});

const aliasEntries = documentedCommandPaths.flatMap((path) =>
  (capabilitiesPayload.commandDetails[path]?.aliases ?? []).map((alias) => [
    alias,
    path,
  ]),
);

const aliasMap = {};
for (const [alias, path] of aliasEntries) {
  if (!(alias in aliasMap)) {
    aliasMap[alias] = path;
  }
}
const staticLocalCommands = ["guide", "capabilities", "describe", "completion"];
const commandRoutes = Object.fromEntries(
  routingCommandPaths.map((path) => [path, getCommandExecutionMetadata(path)]),
);
const tokenizedCommandRoutes = routingCommandPaths.map((path) => ({
  route: path,
  tokens: path.split(" "),
})).sort((left, right) => right.tokens.length - left.tokens.length);
const directNativeCommands = new Set(
  routingCommandPaths.filter((path) => {
    const route = commandRoutes[path];
    return route.owner === "native-shell" && route.nativeModes.includes("default");
  }),
);

function sanitizeEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PRIVACY_POOLS_") || key.startsWith("PP_")) {
      delete env[key];
    }
  }
  delete env.NO_COLOR;
  env.FORCE_COLOR = "1";
  env.LANG = "en_US.UTF-8";
  env.TERM = "xterm-256color";
  env.COLUMNS = "120";
  env.PP_NO_UPDATE_CHECK = "1";
  env.PRIVACY_POOLS_CLI_DISABLE_NATIVE = "1";
  return env;
}

function captureBuiltCli(args) {
  const tempHome = mkdtempSync(join(tmpdir(), "pp-native-manifest-"));

  try {
    const result = spawnSync(
      "node",
      ["--import", "tsx", sourceCliPath, ...args],
      {
        cwd: repoRoot,
        env: {
          ...sanitizeEnv(),
          PRIVACY_POOLS_HOME: join(tempHome, ".privacy-pools"),
        },
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(
        `CLI capture failed for '${args.join(" ")}' with status ${result.status}.\n` +
        `stdout:\n${result.stdout ?? ""}\n` +
        `stderr:\n${result.stderr ?? ""}`,
      );
    }

    return {
      stdout: (result.stdout ?? "").trimEnd(),
      stderr: (result.stderr ?? "").trimEnd(),
    };
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
}

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

async function buildNativeShellManifest() {
  if (!existsSync(distModulePath) || !existsSync(distProgramModulePath)) {
    return null;
  }

  const {
    STATIC_COMPLETION_SPEC,
  } = await import(
    pathToFileURL(join(repoRoot, "dist", "utils", "completion-query.js")).href
  );
  const {
    CHAINS,
    CHAIN_NAMES,
    MAINNET_CHAIN_NAMES,
    KNOWN_POOLS,
    NATIVE_ASSET_ADDRESS,
    EXPLORER_URLS,
    POA_PORTAL_URL,
  } = await import(
    pathToFileURL(join(repoRoot, "dist", "config", "chains.js")).href
  );
  const {
    CHAIN_ID_ENV_SUFFIX,
    DEFAULT_RPC_URLS,
  } = await import(
    pathToFileURL(join(repoRoot, "dist", "services", "config.js")).href
  );

  const rootHelp = captureBuiltCli(["--help"]).stdout;
  const structuredRootHelp = JSON.parse(
    captureBuiltCli(["--json", "--help"]).stdout,
  ).help;
  const guideStructuredEnvelope = JSON.parse(
    captureBuiltCli(["--agent", "guide"]).stdout,
  );
  const {
    schemaVersion: _guideSchemaVersion,
    success: _guideSuccess,
    ...guideStructuredPayload
  } = guideStructuredEnvelope;
  if (typeof guideStructuredPayload.help === "string") {
    guideStructuredPayload.help = stripAnsi(guideStructuredPayload.help);
  }
  const guideStructuredText = stripAnsi(guideStructuredPayload.help);
  const guideHumanText = captureBuiltCli(["guide"]).stderr;
  const capabilitiesHumanText = captureBuiltCli(["capabilities"]).stderr;

  const helpTextByPath = Object.fromEntries(
    documentedCommandPaths.map((path) => [
      path,
      captureBuiltCli([...path.split(" "), "--help"]).stdout,
    ]),
  );

  const describeHumanTextByPath = Object.fromEntries(
    documentedCommandPaths.map((path) => [
      path,
      captureBuiltCli(["describe", ...path.split(" ")]).stderr,
    ]),
  );

  const completionScripts = Object.fromEntries(
    SUPPORTED_COMPLETION_SHELLS.map((shell) => [
      shell,
      captureBuiltCli(["completion", shell]).stdout,
    ]),
  );

  return {
    manifestVersion: CURRENT_MANIFEST_VERSION,
    runtimeVersion: CURRENT_RUNTIME_VERSION,
    cliVersion,
    jsonSchemaVersion: JSON_SCHEMA_VERSION,
    commandPaths: documentedCommandPaths,
    aliasMap,
    rootHelp,
    structuredRootHelp,
    helpTextByPath,
    guideStructuredPayload,
    guideStructuredText,
    guideHumanText,
    capabilitiesHumanText,
    describeHumanTextByPath,
    completionSpec: STATIC_COMPLETION_SPEC,
    completionScripts,
    runtimeConfig: {
      chainEnvSuffixes: CHAIN_ID_ENV_SUFFIX,
      defaultRpcUrls: DEFAULT_RPC_URLS,
      chainNames: CHAIN_NAMES,
      mainnetChainNames: MAINNET_CHAIN_NAMES,
      nativeAssetAddress: NATIVE_ASSET_ADDRESS,
      knownPools: KNOWN_POOLS,
      explorerUrls: EXPLORER_URLS,
      poaPortalUrl: POA_PORTAL_URL,
      chains: Object.fromEntries(
        Object.entries(CHAINS).map(([name, chain]) => [
          name,
          {
            id: chain.id,
            name: chain.name,
            entrypoint: chain.entrypoint,
            startBlock: chain.startBlock.toString(),
            aspHost: chain.aspHost,
            relayerHost: chain.relayerHost,
            isTestnet: chain.isTestnet,
            avgBlockTimeSec: chain.avgBlockTimeSec,
          },
        ]),
      ),
    },
    routes: {
      staticLocalCommands,
      directNativeCommands: [...directNativeCommands],
      helpCommandPaths: documentedCommandPaths,
      commandRoutes,
    },
    capabilitiesPayload,
  };
}

const routingFileContents = `/* AUTO-GENERATED by scripts/generate-command-discovery-static.mjs - DO NOT EDIT */

export type GeneratedCommandOwner = "js-runtime" | "native-shell" | "hybrid";

export interface GeneratedCommandRoute {
  owner: GeneratedCommandOwner;
  nativeModes: readonly string[];
}

export const GENERATED_COMMAND_PATHS = ${JSON.stringify(documentedCommandPaths, null, 2)} as const;

export type GeneratedCommandPath = (typeof GENERATED_COMMAND_PATHS)[number];

export const GENERATED_ROUTE_COMMAND_PATHS = ${JSON.stringify(routingCommandPaths, null, 2)} as const;

export type GeneratedRouteCommandPath = (typeof GENERATED_ROUTE_COMMAND_PATHS)[number];

export interface GeneratedTokenizedCommandRoute {
  route: GeneratedRouteCommandPath;
  tokens: readonly string[];
}

export const GENERATED_STATIC_LOCAL_COMMANDS = ${JSON.stringify(staticLocalCommands, null, 2)} as const;

export const GENERATED_COMMAND_ALIAS_MAP: Record<string, GeneratedCommandPath> = ${JSON.stringify(aliasMap, null, 2)};

export const GENERATED_COMMAND_ROUTES: Record<GeneratedRouteCommandPath, GeneratedCommandRoute> = ${JSON.stringify(commandRoutes, null, 2)};

export const GENERATED_TOKENIZED_COMMAND_ROUTES: readonly GeneratedTokenizedCommandRoute[] = ${JSON.stringify(tokenizedCommandRoutes, null, 2)} as const;
`;

const fileContents = `/* AUTO-GENERATED by scripts/generate-command-discovery-static.mjs - DO NOT EDIT */

import type { CapabilitiesPayload } from "../types.js";

export type GeneratedCommandOwner = "js-runtime" | "native-shell" | "hybrid";

export interface GeneratedCommandRoute {
  owner: GeneratedCommandOwner;
  nativeModes: readonly string[];
}

export const GENERATED_COMMAND_PATHS = ${JSON.stringify(documentedCommandPaths, null, 2)} as const;

export type GeneratedCommandPath = (typeof GENERATED_COMMAND_PATHS)[number];

export const GENERATED_ROUTE_COMMAND_PATHS = ${JSON.stringify(routingCommandPaths, null, 2)} as const;

export type GeneratedRouteCommandPath = (typeof GENERATED_ROUTE_COMMAND_PATHS)[number];

export const GENERATED_ROOT_COMMANDS = ${JSON.stringify(rootCommands, null, 2)} as const;

export const GENERATED_STATIC_LOCAL_COMMANDS = ${JSON.stringify(staticLocalCommands, null, 2)} as const;

export const GENERATED_COMMAND_ALIAS_MAP: Record<string, GeneratedCommandPath> = ${JSON.stringify(aliasMap, null, 2)};

export const GENERATED_COMMAND_ROUTES: Record<GeneratedRouteCommandPath, GeneratedCommandRoute> = ${JSON.stringify(commandRoutes, null, 2)};

export const GENERATED_CAPABILITIES_PAYLOAD: CapabilitiesPayload = ${JSON.stringify(capabilitiesPayload, null, 2)};

export const GENERATED_COMMAND_MANIFEST = {
  manifestVersion: ${JSON.stringify(CURRENT_MANIFEST_VERSION)},
  runtimeVersion: ${JSON.stringify(CURRENT_RUNTIME_VERSION)},
  commandPaths: GENERATED_COMMAND_PATHS,
  rootCommands: GENERATED_ROOT_COMMANDS,
  staticLocalCommands: GENERATED_STATIC_LOCAL_COMMANDS,
  aliasMap: GENERATED_COMMAND_ALIAS_MAP,
  commandRoutes: GENERATED_COMMAND_ROUTES,
  capabilitiesPayload: GENERATED_CAPABILITIES_PAYLOAD,
} as const;
`;

const mismatches = [];

function writeOrCheck(path, content) {
  if (mode === "write") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    return;
  }

  let existing = "";
  try {
    existing = readFileSync(path, "utf8");
  } catch {
    mismatches.push(path);
    return;
  }
  if (existing !== content) {
    mismatches.push(path);
  }
}

writeOrCheck(routingModulePath, routingFileContents);
writeOrCheck(manifestModulePath, fileContents);
writeOrCheck(
  nativeRuntimeContractPath,
  `${JSON.stringify(CURRENT_RUNTIME_DESCRIPTOR, null, 2)}\n`,
);
writeOrCheck(
  nativeRootFlagsPath,
  `${JSON.stringify(ROOT_GLOBAL_FLAG_METADATA, null, 2)}\n`,
);
writeOrCheck(
  nativeCompletionShellPath,
  `${JSON.stringify(COMPLETION_SHELL_CONTRACT, null, 2)}\n`,
);

const nativeShellManifest = await buildNativeShellManifest();
if (nativeShellManifest) {
  writeOrCheck(
    nativeShellManifestPath,
    `${JSON.stringify(nativeShellManifest, null, 2)}\n`,
  );
} else if (mode === "check") {
  mismatches.push(nativeShellManifestPath);
}

if (mode === "check") {
  if (mismatches.length > 0) {
    console.error(
      `Command discovery artifacts are out of date:\n${mismatches.join("\n")}`,
    );
    process.exit(1);
  }
  console.log("Command discovery artifacts are up to date.");
}
