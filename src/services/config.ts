import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "path";
import type { CLIConfig } from "../types.js";
import { resolveConfigHome } from "../runtime/config-paths.js";
import { CLIError } from "../utils/errors.js";

function resolveConfigDir(): string {
  return resolveConfigHome();
}

export function getConfigFilePath(): string {
  return join(resolveConfigDir(), "config.json");
}

export function getMnemonicFilePath(): string {
  return join(resolveConfigDir(), ".mnemonic");
}

export function getSignerFilePath(): string {
  return join(resolveConfigDir(), ".signer");
}

export function getConfigDir(): string {
  return resolveConfigDir();
}

export function getAccountsDir(): string {
  return join(resolveConfigDir(), "accounts");
}

export function getWorkflowsDir(): string {
  return join(resolveConfigDir(), "workflows");
}

export function getWorkflowSecretsDir(): string {
  return join(resolveConfigDir(), "workflow-secrets");
}

export function getSubmissionsDir(): string {
  return join(resolveConfigDir(), "submissions");
}

export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  const accountsDir = getAccountsDir();
  const workflowsDir = getWorkflowsDir();
  const workflowSecretsDir = getWorkflowSecretsDir();
  const submissionsDir = getSubmissionsDir();
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
  if (!existsSync(workflowsDir)) {
    mkdirSync(workflowsDir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(workflowsDir, 0o700);
  } catch {
    // Best effort. Some filesystems may not support chmod.
  }
  if (!existsSync(workflowSecretsDir)) {
    mkdirSync(workflowSecretsDir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(workflowSecretsDir, 0o700);
  } catch {
    // Best effort. Some filesystems may not support chmod.
  }
  if (!existsSync(submissionsDir)) {
    mkdirSync(submissionsDir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(submissionsDir, 0o700);
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
let _cachedConfigPath: string | null = null;

export function invalidateConfigCache(): void {
  _cachedConfig = null;
  _cachedConfigPath = null;
}

export function loadConfig(): CLIConfig {
  const configFile = getConfigFilePath();
  if (_cachedConfig && _cachedConfigPath === configFile) {
    return _cachedConfig;
  }

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
  _cachedConfigPath = configFile;
  return _cachedConfig;
}

export function saveConfig(config: CLIConfig): void {
  invalidateConfigCache();
  ensureConfigDir();
  const path = getConfigFilePath();
  writePrivateFileAtomic(path, JSON.stringify(config, null, 2));
}

function createPrivateTempPath(filePath: string): string {
  return `${filePath}.${process.pid}.${randomUUID()}.tmp`;
}

export function writePrivateFileAtomic(filePath: string, content: string): void {
  if (existsSync(filePath)) {
    const stats = lstatSync(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symlink target: ${filePath}`);
    }
  }

  const tmpPath = createPrivateTempPath(filePath);
  try {
    const fd = openSync(tmpPath, "wx", 0o600);
    try {
      writeFileSync(fd, content, { encoding: "utf-8" });
      // Best-effort durability: flush the temp file before replacing the target.
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, filePath);
    try {
      const dirFd = openSync(dirname(filePath), "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {
      // Best effort. Some platforms/filesystems do not support directory fsync.
    }
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Best effort cleanup of a failed temporary private file write.
    }
    throw error;
  }

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
  writePrivateFileAtomic(getMnemonicFilePath(), mnemonic);
}

export function clearMnemonicFile(): boolean {
  const mnemonicFile = getMnemonicFilePath();
  if (!existsSync(mnemonicFile)) {
    return false;
  }
  unlinkSync(mnemonicFile);
  return true;
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
  writePrivateFileAtomic(getSignerFilePath(), key);
}

export function clearSignerKeyFile(): boolean {
  const signerFile = getSignerFilePath();
  if (!existsSync(signerFile)) {
    return false;
  }
  unlinkSync(signerFile);
  return true;
}

// Env var suffix for a given chain ID, matching the PP_*_<CHAIN> convention.
export const CHAIN_ID_ENV_SUFFIX: Record<number, string> = {
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
export const DEFAULT_RPC_URLS: Record<number, string[]> = {
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

export function hasCustomRpcOverride(
  chainId: number,
  overrideFromFlag?: string,
): boolean {
  if (overrideFromFlag?.trim()) {
    return true;
  }

  if (resolveRpcEnvVar(chainId)) {
    return true;
  }

  const config = loadConfig();
  return Boolean(config.rpcOverrides[chainId]);
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
