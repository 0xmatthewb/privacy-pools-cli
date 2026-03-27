import { existsSync } from "node:fs";
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

export const CARGO_AVAILABLE =
  spawnSync("cargo", ["--version"], {
    cwd: CLI_ROOT,
    encoding: "utf8",
    env: buildChildProcessEnv(),
    timeout: 10_000,
  }).status === 0;

let cachedNativeBinaryPath: string | null = null;

export function ensureNativeShellBinary(): string {
  if (!CARGO_AVAILABLE) {
    throw new Error("cargo is not available");
  }

  if (cachedNativeBinaryPath && existsSync(cachedNativeBinaryPath)) {
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
