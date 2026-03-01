import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CLIConfig } from "../types.js";
import { CLIError } from "../utils/errors.js";

function resolveConfigDir(): string {
  const envOverride =
    process.env.PRIVACY_POOLS_HOME?.trim() ||
    process.env.PRIVACY_POOLS_CONFIG_DIR?.trim();
  return envOverride && envOverride.length > 0
    ? envOverride
    : join(homedir(), ".privacy-pools");
}

function getConfigFilePath(): string {
  return join(resolveConfigDir(), "config.json");
}

function getMnemonicFilePath(): string {
  return join(resolveConfigDir(), ".mnemonic");
}

function getSignerFilePath(): string {
  return join(resolveConfigDir(), ".signer");
}

export function getConfigDir(): string {
  return resolveConfigDir();
}

export function getAccountsDir(): string {
  return join(resolveConfigDir(), "accounts");
}

export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  const accountsDir = getAccountsDir();
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(configDir, 0o700);
  } catch {
    // Best effort. Some filesystems may not support chmod.
  }
  if (!existsSync(accountsDir)) {
    mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(accountsDir, 0o700);
  } catch {
    // Best effort. Some filesystems may not support chmod.
  }
}

export function configExists(): boolean {
  return existsSync(getConfigFilePath());
}

export function mnemonicExists(): boolean {
  return existsSync(getMnemonicFilePath());
}

let _cachedConfig: CLIConfig | null = null;

export function loadConfig(): CLIConfig {
  if (_cachedConfig) return _cachedConfig;

  const configFile = getConfigFilePath();
  if (!existsSync(configFile)) {
    return { defaultChain: "ethereum", rpcOverrides: {} };
  }

  let parsed: unknown;
  try {
    const raw = readFileSync(configFile, "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    throw new CLIError(
      "Config file is not valid JSON.",
      "INPUT",
      `Fix or remove ${configFile}, then run 'privacy-pools init'.`
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new CLIError(
      "Config file has invalid structure.",
      "INPUT",
      `Fix or remove ${configFile}, then run 'privacy-pools init'.`
    );
  }

  const candidate = parsed as Record<string, unknown>;
  const defaultChain = candidate.defaultChain;
  const rpcOverridesRaw = candidate.rpcOverrides;
  const rpcOverrides: Record<number, string> = {};

  if (typeof defaultChain !== "string" || defaultChain.trim() === "") {
    throw new CLIError(
      "Config file is missing a valid defaultChain.",
      "INPUT",
      `Fix or remove ${configFile}, then run 'privacy-pools init'.`
    );
  }

  if (typeof rpcOverridesRaw === "object" && rpcOverridesRaw !== null) {
    for (const [key, value] of Object.entries(
      rpcOverridesRaw as Record<string, unknown>
    )) {
      if (typeof value !== "string" || value.trim() === "") {
        throw new CLIError(
          `Config rpcOverrides contains invalid value for chain key "${key}".`,
          "INPUT",
          `Fix or remove ${configFile}, then run 'privacy-pools init'.`
        );
      }

      const parsedKey = Number(key);
      if (!Number.isInteger(parsedKey)) {
        throw new CLIError(
          `Config rpcOverrides contains invalid chain key "${key}".`,
          "INPUT",
          `Fix or remove ${configFile}, then run 'privacy-pools init'.`
        );
      }

      rpcOverrides[parsedKey] = value;
    }
  } else if (rpcOverridesRaw !== undefined) {
    throw new CLIError(
      "Config rpcOverrides must be an object.",
      "INPUT",
      `Fix or remove ${configFile}, then run 'privacy-pools init'.`
    );
  }

  _cachedConfig = { defaultChain, rpcOverrides };
  return _cachedConfig;
}

export function saveConfig(config: CLIConfig): void {
  _cachedConfig = null; // Invalidate cache on write
  ensureConfigDir();
  const path = getConfigFilePath();
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
  renameSync(tmpPath, path);
}

function writePrivateFile(filePath: string, content: string): void {
  const tmpPath = filePath + ".tmp";
  writeFileSync(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
  renameSync(tmpPath, filePath);
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best effort. Some filesystems may not support chmod.
  }
}

export function loadMnemonicFromFile(): string | null {
  const mnemonicFile = getMnemonicFilePath();
  if (!existsSync(mnemonicFile)) return null;
  return readFileSync(mnemonicFile, "utf-8").trim();
}

export function saveMnemonicToFile(mnemonic: string): void {
  ensureConfigDir();
  writePrivateFile(getMnemonicFilePath(), mnemonic);
}

export function loadSignerKey(): string | null {
  // Env var takes precedence
  const envKey = process.env.PRIVACY_POOLS_PRIVATE_KEY;
  if (envKey) return envKey.trim();

  const signerFile = getSignerFilePath();
  if (!existsSync(signerFile)) return null;
  return readFileSync(signerFile, "utf-8").trim();
}

export function saveSignerKey(key: string): void {
  ensureConfigDir();
  writePrivateFile(getSignerFilePath(), key);
}

// Env var suffix for a given chain ID, matching the PP_*_<CHAIN> convention.
const CHAIN_ID_ENV_SUFFIX: Record<number, string> = {
  1: "ETHEREUM",
  42161: "ARBITRUM",
  10: "OPTIMISM",
  11155111: "SEPOLIA",
  11155420: "OP_SEPOLIA",
};

export function resolveRpcEnvVar(chainId: number): string | undefined {
  const suffix = CHAIN_ID_ENV_SUFFIX[chainId];
  if (suffix) {
    const chainScoped =
      process.env[`PRIVACY_POOLS_RPC_URL_${suffix}`]?.trim() ||
      process.env[`PP_RPC_URL_${suffix}`]?.trim();
    if (chainScoped) return chainScoped;
  }
  const global =
    process.env["PRIVACY_POOLS_RPC_URL"]?.trim() ||
    process.env["PP_RPC_URL"]?.trim();
  return global || undefined;
}

export function getRpcUrl(chainId: number, overrideFromFlag?: string): string {
  // Precedence: flag > env var > config file > built-in default
  if (overrideFromFlag) return overrideFromFlag;

  const envUrl = resolveRpcEnvVar(chainId);
  if (envUrl) return envUrl;

  const config = loadConfig();
  if (config.rpcOverrides[chainId]) return config.rpcOverrides[chainId];

  // Default public RPCs (one per supported chain).
  // Users can override per chain via init --rpc-url or config.json.
  const defaults: Record<number, string> = {
    1: "https://eth.llamarpc.com",
    42161: "https://arbitrum.drpc.org",
    10: "https://optimism.drpc.org",
    11155111: "https://sepolia.drpc.org",
    11155420: "https://optimism-sepolia.drpc.org",
  };

  const url = defaults[chainId];
  if (!url) throw new CLIError(
    `No RPC URL configured for chain ${chainId}.`,
    "RPC",
    "Pass --rpc-url <url> on the command, or set PP_RPC_URL in your environment."
  );
  return url;
}
