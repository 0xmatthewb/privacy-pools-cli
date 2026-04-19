import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import {
  clearMnemonicFile,
  clearSignerKeyFile,
  configExists,
  getConfigDir,
  getMnemonicFilePath,
  getSignerFilePath,
  invalidateConfigCache,
  loadConfig,
  loadMnemonicFromFile,
  loadSignerKey,
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../services/config.js";
import { CHAINS } from "../config/chains.js";
import { resolveChain, validateAddress } from "../utils/validation.js";
import { CLIError, printError } from "../utils/errors.js";
import type { CLIConfig, GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import {
  renderConfigList,
  renderConfigGet,
  renderConfigSet,
  renderConfigPath,
  renderConfigProfileList,
  renderConfigProfileCreate,
  renderConfigProfileActive,
  renderConfigProfileUse,
} from "../output/config.js";
import type {
  ConfigListResult,
  ConfigGetResult,
  ConfigSetResult,
} from "../output/config.js";
import {
  resolveBaseConfigHome,
  resolveConfigHome,
  getActiveProfile,
  persistActiveProfile,
} from "../runtime/config-paths.js";

export { createConfigCommand } from "../command-shells/config.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set(["recovery-phrase", "signer-key"]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}

function parseRpcOverrideKey(key: string): { chainName: string; chainId: number } | null {
  const match = key.match(/^rpc-override\.(.+)$/);
  if (!match) return null;
  const chainName = match[1];
  try {
    const chainConfig = resolveChain(chainName);
    return { chainName, chainId: chainConfig.id };
  } catch {
    return null;
  }
}

function isValidConfigKey(key: string): boolean {
  return (
    key === "default-chain" ||
    key === "recovery-phrase" ||
    key === "signer-key" ||
    parseRpcOverrideKey(key) !== null
  );
}

async function readSensitiveInput(
  opts: { file?: string; stdin?: boolean },
  isInteractive: boolean,
): Promise<string> {
  if (opts.file) {
    if (!existsSync(opts.file)) {
      throw new CLIError(
        `File not found: ${opts.file}`,
        "INPUT",
        "Provide a valid file path with --file.",
      );
    }
    return readFileSync(opts.file, "utf-8").trim();
  }

  if (opts.stdin) {
    return readFileSync(0, "utf-8").trim();
  }

  if (isInteractive) {
    const { password } = await import("@inquirer/prompts");
    const value = await password({ message: "Enter value:" });
    return value.trim();
  }

  throw new CLIError(
    "Sensitive keys require --file <path> or --stdin in non-interactive mode.",
    "INPUT",
    "Pipe the value through stdin or pass --file <path>.",
  );
}

// ── config list ──────────────────────────────────────────────────────────────

export async function handleConfigListCommand(
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);

  try {
    const hasConfig = configExists();
    const config = hasConfig ? loadConfig() : { defaultChain: null, rpcOverrides: {} } as unknown as CLIConfig;
    const hasMnemonic = existsSync(getMnemonicFilePath());
    const hasSignerKey = loadSignerKey() !== null;

    const result: ConfigListResult = {
      defaultChain: config.defaultChain ?? null,
      recoveryPhraseSet: hasMnemonic,
      signerKeySet: hasSignerKey,
      rpcOverrides: config.rpcOverrides ?? {},
      configDir: getConfigDir(),
    };

    renderConfigList(ctx, result);
  } catch (error) {
    printError(error, mode.isJson);
  }
}

// ── config get ───────────────────────────────────────────────────────────────

export async function handleConfigGetCommand(
  key: string,
  opts: { reveal?: boolean },
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);

  try {
    if (!isValidConfigKey(key)) {
      throw new CLIError(
        `Unknown config key: ${key}`,
        "INPUT",
        "Valid keys: default-chain, rpc-override.<chain>, recovery-phrase, signer-key",
      );
    }

    const sensitive = isSensitiveKey(key);
    const shouldRedact = sensitive && !opts.reveal;

    let value: string | null = null;

    if (key === "default-chain") {
      const config = configExists() ? loadConfig() : null;
      value = config?.defaultChain ?? null;
    } else if (key === "recovery-phrase") {
      value = loadMnemonicFromFile();
    } else if (key === "signer-key") {
      value = loadSignerKey();
    } else {
      const rpcKey = parseRpcOverrideKey(key);
      if (rpcKey) {
        const config = configExists() ? loadConfig() : null;
        value = config?.rpcOverrides[rpcKey.chainId] ?? null;
      }
    }

    const result: ConfigGetResult = {
      key,
      value,
      sensitive,
      redacted: shouldRedact,
    };

    renderConfigGet(ctx, result);
  } catch (error) {
    printError(error, mode.isJson);
  }
}

// ── config set ───────────────────────────────────────────────────────────────

export async function handleConfigSetCommand(
  key: string,
  positionalValue: string | undefined,
  opts: { file?: string; stdin?: boolean },
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);

  try {
    if (!isValidConfigKey(key)) {
      throw new CLIError(
        `Unknown config key: ${key}`,
        "INPUT",
        "Valid keys: default-chain, rpc-override.<chain>, recovery-phrase, signer-key",
      );
    }

    const sensitive = isSensitiveKey(key);
    const isInteractive = !mode.isJson && !mode.isQuiet && process.stdin.isTTY === true;

    let newValue: string;

    if (sensitive) {
      if (positionalValue) {
        throw new CLIError(
          "Sensitive keys cannot be set as a positional argument (shell history leakage risk).",
          "INPUT",
          "Use --file <path>, --stdin, or interactive masked input instead.",
        );
      }
      newValue = await readSensitiveInput(opts, isInteractive);
    } else {
      if (!positionalValue) {
        throw new CLIError(
          `Missing value for ${key}.`,
          "INPUT",
          `Usage: privacy-pools config set ${key} <value>`,
        );
      }
      newValue = positionalValue;
    }

    if (!newValue) {
      throw new CLIError("Value cannot be empty.", "INPUT");
    }

    let summary: string;

    if (key === "default-chain") {
      const chainConfig = resolveChain(newValue);
      const config = configExists() ? loadConfig() : { defaultChain: "mainnet", rpcOverrides: {} };
      config.defaultChain = chainConfig.name;
      saveConfig(config);
      invalidateConfigCache();
      summary = `set to ${chainConfig.name}`;
    } else if (key === "recovery-phrase") {
      const words = newValue.split(/\s+/).filter(Boolean);
      if (words.length !== 12 && words.length !== 24) {
        throw new CLIError(
          `Recovery phrase must be 12 or 24 words (got ${words.length}).`,
          "INPUT",
        );
      }
      saveMnemonicToFile(newValue);
      summary = "updated (sensitive value redacted)";
    } else if (key === "signer-key") {
      throw new CLIError(
        "Signer keys cannot be updated through config set.",
        "INPUT",
        "Use 'privacy-pools init --signer-only' to add or replace the signer key safely.",
      );
    } else {
      const rpcKey = parseRpcOverrideKey(key);
      if (!rpcKey) {
        throw new CLIError(`Unknown config key: ${key}`, "INPUT");
      }
      try {
        new URL(newValue);
      } catch {
        throw new CLIError(
          `Invalid URL for RPC override: ${newValue}`,
          "INPUT",
          "Provide a valid URL (e.g. https://my-rpc.example.com).",
        );
      }
      const config = configExists() ? loadConfig() : { defaultChain: "mainnet", rpcOverrides: {} };
      config.rpcOverrides[rpcKey.chainId] = newValue;
      saveConfig(config);
      invalidateConfigCache();
      summary = `set to ${newValue}`;
    }

    const result: ConfigSetResult = {
      key,
      newValueSummary: summary,
    };

    renderConfigSet(ctx, result);
  } catch (error) {
    printError(error, mode.isJson);
  }
}

// ── config unset ────────────────────────────────────────────────────────────

export async function handleConfigUnsetCommand(
  key: string,
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);

  try {
    if (!isValidConfigKey(key)) {
      throw new CLIError(
        `Unknown config key: ${key}`,
        "INPUT",
        "Valid keys: default-chain, rpc-override.<chain>, recovery-phrase, signer-key",
      );
    }

    let summary = "already unset";
    let changed = false;

    if (key === "default-chain") {
      if (configExists()) {
        const config = loadConfig();
        if (config.defaultChain !== "mainnet") {
          config.defaultChain = "mainnet";
          saveConfig(config);
          invalidateConfigCache();
          changed = true;
        }
      }
      summary = changed
        ? "reset to implicit mainnet default"
        : "already using the implicit mainnet default";
    } else if (key === "recovery-phrase") {
      changed = clearMnemonicFile();
      summary = changed ? "removed" : "already unset";
    } else if (key === "signer-key") {
      if (process.env.PRIVACY_POOLS_PRIVATE_KEY?.trim()) {
        throw new CLIError(
          "Signer key is currently provided by PRIVACY_POOLS_PRIVATE_KEY.",
          "INPUT",
          "Unset PRIVACY_POOLS_PRIVATE_KEY in your shell or agent environment first, then rerun config unset signer-key if you also want to remove the local fallback file.",
        );
      }
      changed = clearSignerKeyFile();
      summary = changed ? "removed" : "already unset";
    } else {
      const rpcKey = parseRpcOverrideKey(key);
      if (!rpcKey) {
        throw new CLIError(`Unknown config key: ${key}`, "INPUT");
      }
      if (configExists()) {
        const config = loadConfig();
        if (config.rpcOverrides[rpcKey.chainId]) {
          delete config.rpcOverrides[rpcKey.chainId];
          saveConfig(config);
          invalidateConfigCache();
          changed = true;
        }
      }
      summary = changed ? "removed" : "already unset";
    }

    const result: ConfigSetResult = {
      key,
      newValueSummary: summary,
      action: "unset",
      changed,
    };

    renderConfigSet(ctx, result);
  } catch (error) {
    printError(error, mode.isJson);
  }
}

// ── config path ──────────────────────────────────────────────────────────────

export async function handleConfigPathCommand(
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);

  try {
    renderConfigPath(ctx, getConfigDir());
  } catch (error) {
    printError(error, mode.isJson);
  }
}

// ── config profile ──────────────────────────────────────────────────────────

const PROFILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function getProfilesBaseDir(): string {
  // Profiles always live under the base config home (ignoring active profile).
  return join(resolveBaseConfigHome(), "profiles");
}

function listProfileNames(): string[] {
  const profilesDir = getProfilesBaseDir();
  if (!existsSync(profilesDir)) return [];
  try {
    return readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export async function handleConfigProfileListCommand(
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);

  try {
    const profiles = listProfileNames();
    const active = getActiveProfile() ?? "default";
    renderConfigProfileList(ctx, profiles, active);
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export async function handleConfigProfileCreateCommand(
  name: string,
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);

  try {
    if (!PROFILE_NAME_RE.test(name)) {
      throw new CLIError(
        `Invalid profile name: ${name}`,
        "INPUT",
        "Profile names must start with a letter or digit and contain only letters, digits, hyphens, and underscores.",
      );
    }

    if (name === "default") {
      throw new CLIError(
        "Cannot create a profile named 'default'.",
        "INPUT",
        "The 'default' profile maps to the existing ~/.privacy-pools/ root directory.",
      );
    }

    const profilesDir = getProfilesBaseDir();
    const profileDir = join(profilesDir, name);

    if (existsSync(profileDir)) {
      throw new CLIError(
        `Profile '${name}' already exists.`,
        "INPUT",
        `Directory: ${profileDir}`,
      );
    }

    // Create the profile directory structure.
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    for (const subdir of ["accounts", "workflows", "workflow-secrets"]) {
      mkdirSync(join(profileDir, subdir), { recursive: true, mode: 0o700 });
    }

    renderConfigProfileCreate(ctx, name, profileDir);
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export async function handleConfigProfileActiveCommand(
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);

  try {
    const active = getActiveProfile() ?? "default";
    const configDir = getConfigDir();
    renderConfigProfileActive(ctx, active, configDir);
  } catch (error) {
    printError(error, mode.isJson);
  }
}

export async function handleConfigProfileUseCommand(
  name: string,
  _opts: Record<string, unknown>,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.parent?.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const ctx = createOutputContext(mode);

  try {
    if (name !== "default" && !PROFILE_NAME_RE.test(name)) {
      throw new CLIError(
        `Invalid profile name: ${name}`,
        "INPUT",
        "Profile names must start with a letter or digit and contain only letters, digits, hyphens, and underscores.",
      );
    }

    if (name !== "default") {
      const knownProfiles = listProfileNames();
      if (!knownProfiles.includes(name)) {
        throw new CLIError(
          `Unknown profile: ${name}`,
          "INPUT",
          "Run 'privacy-pools config profile list' to see available profiles, or create one first.",
        );
      }
    }

    persistActiveProfile(name);
    renderConfigProfileUse(ctx, name, resolveConfigHome());
  } catch (error) {
    printError(error, mode.isJson);
  }
}
