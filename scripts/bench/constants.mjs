import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = dirname(fileURLToPath(import.meta.url));
const scriptsDir = dirname(benchDir);

export const repoRoot = dirname(scriptsDir);
export const repoNodeModules = join(repoRoot, "node_modules");
export const repoNodeModulesBin = join(repoNodeModules, ".bin");
export const fixtureServerScript = join(
  repoRoot,
  "test",
  "helpers",
  "fixture-server.ts",
);
export const syncGateRpcServerScript = join(
  repoRoot,
  "test",
  "helpers",
  "sync-gate-rpc-server.ts",
);
export const benchHomesRoot = join(
  repoRoot,
  "test",
  "fixtures",
  "bench-homes",
);

export const DEFAULT_BASE_REF = "origin/main";
export const DEFAULT_MATRIX = "default";
export const DEFAULT_RUNS = 10;
export const DEFAULT_WARMUP = 1;
export const DEFAULT_RUNTIME = "js";
export const LEGACY_LAUNCHER_NATIVE_RUNTIME = "launcher-native";
export const LAUNCHER_BINARY_OVERRIDE_RUNTIME = "launcher-binary-override";
export const SUPPORTED_RUNTIMES = [
  "js",
  "native",
  LAUNCHER_BINARY_OVERRIDE_RUNTIME,
  LEGACY_LAUNCHER_NATIVE_RUNTIME,
  "both",
  "all",
];
export const SUPPORTED_MATRICES = ["default", "readonly"];
export const STRIPPED_ENV_PREFIXES = ["PRIVACY_POOLS_", "PP_"];
