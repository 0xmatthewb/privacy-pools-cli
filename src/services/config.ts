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
    return { defaultChain: "mainnet", rpcOverrides: {} };
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

// Default public RPCs per chain (primary + fallbacks).
// Users can override per chain via init --rpc-url or config.json.
const DEFAULT_RPC_URLS: Record<number, string[]> = {
  1: [
    "https://mainnet.gateway.tenderly.co",
    "https://gateway.tenderly.co/public/mainnet",
    "https://rpc.sentio.xyz/mainnet",
    "https://0xrpc.io/eth",
  ],
  42161: [
    "https://arbitrum.gateway.tenderly.co",
    "https://rpc.sentio.xyz/arbitrum-one",
  ],
  10: [
    "https://optimism.gateway.tenderly.co",
    "https://gateway.tenderly.co/public/optimism",
  ],
  11155111: [
    "https://sepolia.gateway.tenderly.co",
    "https://gateway.tenderly.co/public/sepolia",
    "https://rpc.sepolia.ethpandaops.io",
    "https://eth-sepolia.api.onfinality.io/public",
  ],
  11155420: [
    "https://optimism-sepolia.gateway.tenderly.co",
  ],
};

export function getRpcUrl(chainId: number, overrideFromFlag?: string): string {
  return getRpcUrls(chainId, overrideFromFlag)[0];
}

/**
 * Returns an ordered list of RPC URLs for the given chain.
 * First entry is the primary; remaining are fallbacks.
 *
 * Precedence: flag > env var > config file > built-in defaults.
 * When a user-specified URL is used (flag/env/config), only that
 * single URL is returned (no automatic fallbacks).
 */
export function getRpcUrls(chainId: number, overrideFromFlag?: string): string[] {
  if (overrideFromFlag?.trim()) return [overrideFromFlag.trim()];

  const envUrl = resolveRpcEnvVar(chainId);
  if (envUrl) return [envUrl];

  const config = loadConfig();
  if (config.rpcOverrides[chainId]) return [config.rpcOverrides[chainId]];

  const urls = DEFAULT_RPC_URLS[chainId];
  if (!urls || urls.length === 0) throw new CLIError(
    `No RPC URL configured for chain ${chainId}.`,
    "RPC",
    "Pass --rpc-url <url> on the command, or set PP_RPC_URL in your environment."
  );
  return urls;
}
