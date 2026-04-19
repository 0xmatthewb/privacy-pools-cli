import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import {
  handleConfigGetCommand,
  handleConfigListCommand,
  handleConfigPathCommand,
  handleConfigProfileActiveCommand,
  handleConfigProfileCreateCommand,
  handleConfigProfileListCommand,
  handleConfigProfileUseCommand,
  handleConfigSetCommand,
  handleConfigUnsetCommand,
} from "../../src/commands/config.ts";
import {
  getConfigDir,
  invalidateConfigCache,
  loadConfig,
  loadMnemonicFromFile,
  loadSignerKey,
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../../src/services/config.ts";
import { getActiveProfile, resolveConfigHome, setActiveProfile } from "../../src/runtime/config-paths.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
} from "../helpers/output.ts";
import { cleanupTrackedTempDirs, createTrackedTempDir } from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_CONFIG_DIR = process.env.PRIVACY_POOLS_CONFIG_DIR;

function restoreEnvironment(): void {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }

  if (ORIGINAL_CONFIG_DIR === undefined) {
    delete process.env.PRIVACY_POOLS_CONFIG_DIR;
  } else {
    process.env.PRIVACY_POOLS_CONFIG_DIR = ORIGINAL_CONFIG_DIR;
  }

  setActiveProfile(undefined);
  invalidateConfigCache();
  cleanupTrackedTempDirs();
}

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-config-command-");
  process.env.PRIVACY_POOLS_HOME = home;
  delete process.env.PRIVACY_POOLS_CONFIG_DIR;
  setActiveProfile(undefined);
  invalidateConfigCache();
  return home;
}

function fakeCommand(
  globalOpts: Record<string, unknown> = {},
  depth: number = 2,
): Command {
  let current: Record<string, unknown> = {
    opts: () => globalOpts,
  };

  for (let index = 0; index < depth; index += 1) {
    current = { parent: current };
  }

  return current as unknown as Command;
}

describe("config command handlers", () => {
  afterEach(restoreEnvironment);

  test("lists persisted config in human and json modes", async () => {
    const home = useIsolatedHome();
    saveConfig({
      defaultChain: "sepolia",
      rpcOverrides: { 1: "https://rpc.example.test" },
    });
    saveMnemonicToFile("test test test test test test test test test test test junk");
    saveSignerKey(`0x${"11".repeat(32)}`);

    const human = await captureAsyncOutput(() =>
      handleConfigListCommand({}, fakeCommand({}, 2)),
    );
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("Configuration");
    expect(human.stderr).toContain(home);
    expect(human.stderr).toContain("sepolia");
    expect(human.stderr).toContain("rpc-override (chain 1)");

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleConfigListCommand({}, fakeCommand({ json: true }, 2)),
    );
    expect(stderr).toBe("");
    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.recoveryPhraseSet).toBe(true);
    expect(json.signerKeySet).toBe(true);
    expect(json.rpcOverrides).toEqual({ 1: "https://rpc.example.test" });
    expect(json.configDir).toBe(home);
    expect(json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "status", when: "after_config_list" }),
      ]),
    );
  });

  test("gets sensitive config values with redaction by default", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    saveSignerKey(`0x${"22".repeat(32)}`);

    const human = await captureAsyncOutput(() =>
      handleConfigGetCommand("recovery-phrase", {}, fakeCommand({}, 2)),
    );
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("[set]");
    expect(human.stderr).not.toContain("abandon");

    const revealed = await captureAsyncJsonOutput(() =>
      handleConfigGetCommand("signer-key", { reveal: true }, fakeCommand({ json: true }, 2)),
    );
    expect(revealed.json.success).toBe(true);
    expect(revealed.json.key).toBe("signer-key");
    expect(revealed.json.value).toBe(`0x${"22".repeat(32)}`);
    expect(revealed.json.set).toBe(true);

    const invalid = await captureAsyncJsonOutput(() =>
      handleConfigGetCommand("not-a-key", {}, fakeCommand({ json: true }, 2)),
    );
    expect(invalid.json.success).toBe(false);
    expect(invalid.json.errorMessage).toContain("Unknown config key");
  });

  test("sets default chain, rpc override, and recovery phrase while rejecting signer-key config writes", async () => {
    const home = useIsolatedHome();
    const phraseFile = join(home, "phrase.txt");
    const signerFile = join(home, "signer.txt");
    writeFileSync(
      phraseFile,
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about\n",
      "utf8",
    );
    writeFileSync(signerFile, `${"33".repeat(32)}\n`, "utf8");

    const defaultChain = await captureAsyncOutput(() =>
      handleConfigSetCommand("default-chain", "op-sepolia", {}, fakeCommand({}, 2)),
    );
    expect(defaultChain.stdout).toBe("");
    expect(defaultChain.stderr).toContain("Configuration updated");
    expect(loadConfig().defaultChain).toBe("op-sepolia");

    const rpcOverride = await captureAsyncJsonOutput(() =>
      handleConfigSetCommand(
        "rpc-override.sepolia",
        "https://rpc.sepolia.example.test",
        {},
        fakeCommand({ json: true }, 2),
      ),
    );
    expect(rpcOverride.json.success).toBe(true);
    expect(loadConfig().rpcOverrides[11155111]).toBe("https://rpc.sepolia.example.test");

    await captureAsyncOutput(() =>
      handleConfigSetCommand(
        "recovery-phrase",
        undefined,
        { file: phraseFile },
        fakeCommand({}, 2),
      ),
    );
    expect(loadMnemonicFromFile()).toContain("abandon");

    const signerUpdate = await captureAsyncJsonOutputAllowExit(() =>
      handleConfigSetCommand(
        "signer-key",
        undefined,
        { file: signerFile },
        fakeCommand({ json: true }, 2),
      ),
    );
    expect(signerUpdate.json.success).toBe(false);
    expect(signerUpdate.json.errorCode).toBe("INPUT_ERROR");
    expect(signerUpdate.json.error.message ?? signerUpdate.json.errorMessage).toContain(
      "cannot be updated through config set",
    );
    expect(signerUpdate.json.error.hint).toContain("init --signer-only");
    expect(loadSignerKey()).toBeNull();
    expect(signerUpdate.exitCode).toBe(2);

    const invalidRpc = await captureAsyncJsonOutput(() =>
      handleConfigSetCommand(
        "rpc-override.mainnet",
        "notaurl",
        {},
        fakeCommand({ json: true }, 2),
      ),
    );
    expect(invalidRpc.json.success).toBe(false);
    expect(invalidRpc.json.errorMessage).toContain("Invalid URL for RPC override");

    const positionalSensitive = await captureAsyncJsonOutput(() =>
      handleConfigSetCommand(
        "signer-key",
        `0x${"44".repeat(32)}`,
        {},
        fakeCommand({ json: true }, 2),
      ),
    );
    expect(positionalSensitive.json.success).toBe(false);
    expect(positionalSensitive.json.errorMessage).toContain("Sensitive keys cannot be set");
  });

  test("unsets config keys and refuses to clear environment-provided signer keys", async () => {
    useIsolatedHome();
    saveConfig({
      defaultChain: "sepolia",
      rpcOverrides: { 1: "https://rpc.example.test" },
    });
    saveMnemonicToFile("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about");
    saveSignerKey(`0x${"55".repeat(32)}`);

    const unsetRpc = await captureAsyncJsonOutput(() =>
      handleConfigUnsetCommand("rpc-override.mainnet", {}, fakeCommand({ json: true }, 2)),
    );
    expect(unsetRpc.json.success).toBe(true);
    expect(unsetRpc.json.removed).toBe(true);
    expect(loadConfig().rpcOverrides[1]).toBeUndefined();

    const unsetDefault = await captureAsyncJsonOutput(() =>
      handleConfigUnsetCommand("default-chain", {}, fakeCommand({ json: true }, 2)),
    );
    expect(unsetDefault.json.success).toBe(true);
    expect(unsetDefault.json.removed).toBe(true);
    expect(loadConfig().defaultChain).toBe("mainnet");

    const unsetPhrase = await captureAsyncJsonOutput(() =>
      handleConfigUnsetCommand("recovery-phrase", {}, fakeCommand({ json: true }, 2)),
    );
    expect(unsetPhrase.json.success).toBe(true);
    expect(unsetPhrase.json.removed).toBe(true);
    expect(loadMnemonicFromFile()).toBeNull();

    process.env.PRIVACY_POOLS_PRIVATE_KEY = `0x${"66".repeat(32)}`;
    const signerBlocked = await captureAsyncJsonOutputAllowExit(() =>
      handleConfigUnsetCommand("signer-key", {}, fakeCommand({ json: true }, 2)),
    );
    expect(signerBlocked.json.success).toBe(false);
    expect(signerBlocked.json.errorMessage).toContain("PRIVACY_POOLS_PRIVATE_KEY");
    delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    expect(loadSignerKey()).toBe(`0x${"55".repeat(32)}`);

    const unsetSigner = await captureAsyncJsonOutput(() =>
      handleConfigUnsetCommand("signer-key", {}, fakeCommand({ json: true }, 2)),
    );
    expect(unsetSigner.json.success).toBe(true);
    expect(unsetSigner.json.removed).toBe(true);
    expect(loadSignerKey()).toBeNull();
  });

  test("prints the resolved config path for scripting", async () => {
    const home = useIsolatedHome();

    const captured = await captureAsyncOutput(() =>
      handleConfigPathCommand({}, fakeCommand({}, 2)),
    );

    expect(captured.stdout).toBe(`${home}\n`);
    expect(captured.stderr).toBe("");
  });

  test("creates, lists, activates, and switches profiles", async () => {
    const home = useIsolatedHome();

    const created = await captureAsyncOutput(() =>
      handleConfigProfileCreateCommand("work", {}, fakeCommand({}, 3)),
    );
    expect(created.stdout).toBe("");
    expect(created.stderr).toContain("Profile");
    expect(existsSync(join(home, "profiles", "work", "accounts"))).toBe(true);
    expect(existsSync(join(home, "profiles", "work", "workflows"))).toBe(true);
    expect(existsSync(join(home, "profiles", "work", "workflow-secrets"))).toBe(true);

    const listed = await captureAsyncJsonOutput(() =>
      handleConfigProfileListCommand({}, fakeCommand({ json: true }, 3)),
    );
    expect(listed.json.success).toBe(true);
    expect(listed.json.profiles).toEqual(["default", "work"]);
    expect(listed.json.active).toBe("default");

    const activated = await captureAsyncJsonOutput(() =>
      handleConfigProfileUseCommand("work", {}, fakeCommand({ json: true }, 3)),
    );
    expect(activated.json.success).toBe(true);
    expect(activated.json.profile).toBe("work");
    expect(activated.json.active).toBe(true);
    expect(getActiveProfile()).toBe("work");
    expect(resolveConfigHome()).toBe(join(home, "profiles", "work"));

    const active = await captureAsyncOutput(() =>
      handleConfigProfileActiveCommand({}, fakeCommand({}, 3)),
    );
    expect(active.stdout).toBe("");
    expect(active.stderr).toContain("Active profile");
    expect(active.stderr).toContain("work");
    expect(active.stderr).toContain(join(home, "profiles", "work"));
    expect(getConfigDir()).toBe(join(home, "profiles", "work"));
  });

  test("returns structured errors for duplicate and unknown profiles", async () => {
    const home = useIsolatedHome();
    mkdirSync(join(home, "profiles", "work"), { recursive: true });

    const duplicate = await captureAsyncJsonOutput(() =>
      handleConfigProfileCreateCommand("work", {}, fakeCommand({ json: true }, 3)),
    );
    expect(duplicate.json.success).toBe(false);
    expect(duplicate.json.errorMessage).toContain("already exists");

    const unknown = await captureAsyncJsonOutput(() =>
      handleConfigProfileUseCommand("missing", {}, fakeCommand({ json: true }, 3)),
    );
    expect(unknown.json.success).toBe(false);
    expect(unknown.json.errorMessage).toContain("Unknown profile");
  });
});
