import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CLI_ROOT } from "./paths.ts";
import { buildChildProcessEnv } from "./child-env.ts";

const BIN_NAME =
  process.platform === "win32"
    ? "privacy-pools-cli-native-shell.exe"
    : "privacy-pools-cli-native-shell";

const MANIFEST_PATH = join(CLI_ROOT, "native", "shell", "Cargo.toml");
const BINARY_PATH = join(
  CLI_ROOT,
  "native",
  "shell",
  "target",
  "debug",
  BIN_NAME,
);
const NATIVE_BUILD_INPUTS = [
  MANIFEST_PATH,
  join(CLI_ROOT, "native", "shell", "src", "main.rs"),
  join(CLI_ROOT, "native", "shell", "generated", "manifest.json"),
  join(CLI_ROOT, "native", "shell", "generated", "runtime-contract.json"),
];

export const CARGO_AVAILABLE =
  spawnSync("cargo", ["--version"], {
    cwd: CLI_ROOT,
    encoding: "utf8",
    env: buildChildProcessEnv(),
    timeout: 10_000,
  }).status === 0;

let cachedNativeBinaryPath: string | null = null;

function binaryIsCurrent(binaryPath: string): boolean {
  if (!existsSync(binaryPath)) return false;

  const binaryMtimeMs = statSync(binaryPath).mtimeMs;
  return NATIVE_BUILD_INPUTS.every(
    (path) => !existsSync(path) || statSync(path).mtimeMs <= binaryMtimeMs,
  );
}

export function ensureNativeShellBinary(): string {
  if (!CARGO_AVAILABLE) {
    throw new Error("cargo is not available");
  }

  if (
    cachedNativeBinaryPath &&
    existsSync(cachedNativeBinaryPath) &&
    binaryIsCurrent(cachedNativeBinaryPath)
  ) {
    return cachedNativeBinaryPath;
  }

  const result = spawnSync(
    "cargo",
    ["build", "--manifest-path", MANIFEST_PATH],
    {
      cwd: CLI_ROOT,
      encoding: "utf8",
      env: buildChildProcessEnv(),
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  if (result.status !== 0 || !existsSync(BINARY_PATH)) {
    throw new Error(
      `Failed to build native shell.\nstdout:\n${result.stdout ?? ""}\nstderr:\n${result.stderr ?? ""}`,
    );
  }

  cachedNativeBinaryPath = BINARY_PATH;
  return cachedNativeBinaryPath;
}
