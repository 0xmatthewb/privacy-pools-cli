import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { CLIError } from "../utils/errors.js";
function resolveConfigDir() {
    const envOverride = process.env.PRIVACY_POOLS_HOME?.trim() ||
        process.env.PRIVACY_POOLS_CONFIG_DIR?.trim();
    return envOverride && envOverride.length > 0
        ? envOverride
        : join(homedir(), ".privacy-pools");
}
function getConfigFilePath() {
    return join(resolveConfigDir(), "config.json");
}
function getMnemonicFilePath() {
    return join(resolveConfigDir(), ".mnemonic");
}
function getSignerFilePath() {
    return join(resolveConfigDir(), ".signer");
}
export function getConfigDir() {
    return resolveConfigDir();
}
export function getAccountsDir() {
    return join(resolveConfigDir(), "accounts");
}
export function ensureConfigDir() {
    const configDir = getConfigDir();
    const accountsDir = getAccountsDir();
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }
    try {
        chmodSync(configDir, 0o700);
    }
    catch {
        // Best effort. Some filesystems may not support chmod.
    }
    if (!existsSync(accountsDir)) {
        mkdirSync(accountsDir, { recursive: true, mode: 0o700 });
    }
    try {
        chmodSync(accountsDir, 0o700);
    }
    catch {
        // Best effort. Some filesystems may not support chmod.
    }
}
export function configExists() {
    return existsSync(getConfigFilePath());
}
export function mnemonicExists() {
    return existsSync(getMnemonicFilePath());
}
export function loadConfig() {
    const configFile = getConfigFilePath();
    if (!existsSync(configFile)) {
        return { defaultChain: "ethereum", rpcOverrides: {} };
    }
    let parsed;
    try {
        const raw = readFileSync(configFile, "utf-8");
        parsed = JSON.parse(raw);
    }
    catch {
        throw new CLIError("Config file is not valid JSON.", "INPUT", `Fix or remove ${configFile}, then run 'privacy-pools init'.`);
    }
    if (typeof parsed !== "object" || parsed === null) {
        throw new CLIError("Config file has invalid structure.", "INPUT", `Fix or remove ${configFile}, then run 'privacy-pools init'.`);
    }
    const candidate = parsed;
    const defaultChain = candidate.defaultChain;
    const rpcOverridesRaw = candidate.rpcOverrides;
    const rpcOverrides = {};
    if (typeof defaultChain !== "string" || defaultChain.trim() === "") {
        throw new CLIError("Config file is missing a valid defaultChain.", "INPUT", `Fix or remove ${configFile}, then run 'privacy-pools init'.`);
    }
    if (typeof rpcOverridesRaw === "object" && rpcOverridesRaw !== null) {
        for (const [key, value] of Object.entries(rpcOverridesRaw)) {
            if (typeof value !== "string" || value.trim() === "") {
                throw new CLIError(`Config rpcOverrides contains invalid value for chain key "${key}".`, "INPUT", `Fix or remove ${configFile}, then run 'privacy-pools init'.`);
            }
            const parsedKey = Number(key);
            if (!Number.isInteger(parsedKey)) {
                throw new CLIError(`Config rpcOverrides contains invalid chain key "${key}".`, "INPUT", `Fix or remove ${configFile}, then run 'privacy-pools init'.`);
            }
            rpcOverrides[parsedKey] = value;
        }
    }
    else if (rpcOverridesRaw !== undefined) {
        throw new CLIError("Config rpcOverrides must be an object.", "INPUT", `Fix or remove ${configFile}, then run 'privacy-pools init'.`);
    }
    return {
        defaultChain,
        rpcOverrides,
    };
}
export function saveConfig(config) {
    ensureConfigDir();
    writeFileSync(getConfigFilePath(), JSON.stringify(config, null, 2), "utf-8");
}
function writePrivateFile(path, content) {
    writeFileSync(path, content, { encoding: "utf-8", mode: 0o600 });
    try {
        chmodSync(path, 0o600);
    }
    catch {
        // Best effort. Some filesystems may not support chmod.
    }
}
export function loadMnemonicFromFile() {
    const mnemonicFile = getMnemonicFilePath();
    if (!existsSync(mnemonicFile))
        return null;
    return readFileSync(mnemonicFile, "utf-8").trim();
}
export function saveMnemonicToFile(mnemonic) {
    ensureConfigDir();
    writePrivateFile(getMnemonicFilePath(), mnemonic);
}
export function loadSignerKey() {
    // Env var takes precedence
    const envKey = process.env.PRIVACY_POOLS_PRIVATE_KEY;
    if (envKey)
        return envKey.trim();
    const signerFile = getSignerFilePath();
    if (!existsSync(signerFile))
        return null;
    return readFileSync(signerFile, "utf-8").trim();
}
export function saveSignerKey(key) {
    ensureConfigDir();
    writePrivateFile(getSignerFilePath(), key);
}
export function getRpcUrl(chainId, overrideFromFlag) {
    if (overrideFromFlag)
        return overrideFromFlag;
    const config = loadConfig();
    if (config.rpcOverrides[chainId])
        return config.rpcOverrides[chainId];
    // Default public RPCs
    const defaults = {
        1: "https://eth.llamarpc.com",
        42161: "https://arb1.arbitrum.io/rpc",
        10: "https://mainnet.optimism.io",
        11155111: "https://rpc.sepolia.org",
        11155420: "https://sepolia.optimism.io",
    };
    const url = defaults[chainId];
    if (!url)
        throw new CLIError(`No RPC URL configured for chain ${chainId}.`, "RPC", "Set one with: privacy-pools init --rpc-url <url>, or pass --rpc-url on the command.");
    return url;
}
