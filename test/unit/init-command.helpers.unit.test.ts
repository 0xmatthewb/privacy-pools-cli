import { afterEach, describe, expect, test } from "bun:test";
import {
  buildRecoveryBackupContents,
  captureInitFileSnapshot,
  collectDefaultChain,
  collectSignerKey,
  deriveReadiness,
  describeRecoveryPhraseSource,
  persistInitFilesAtomically,
  maybeConfirmReplacement,
  describeSignerKeySource,
  normalizePrivateKeyOrThrow,
  resolveExistingInitState,
  restoreInitFileSnapshot,
  resolveDryRunPlan,
  resolveNonInteractivePlan,
  withInitTestSentinel,
  writeRecoveryBackupFile,
} from "../../src/commands/init.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../../src/services/config.ts";

const originalSentinelEnv = process.env.PRIVACY_POOLS_TEST_INIT_SENTINELS;
const originalSignerEnv = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const originalHomeEnv = process.env.PRIVACY_POOLS_HOME;

describe("init command helpers", () => {
  afterEach(() => {
    cleanupTrackedTempDirs();
    if (originalSentinelEnv === undefined) {
      delete process.env.PRIVACY_POOLS_TEST_INIT_SENTINELS;
    } else {
      process.env.PRIVACY_POOLS_TEST_INIT_SENTINELS = originalSentinelEnv;
    }
    if (originalSignerEnv === undefined) {
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    } else {
      process.env.PRIVACY_POOLS_PRIVATE_KEY = originalSignerEnv;
    }
    if (originalHomeEnv === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = originalHomeEnv;
    }
  });

  test("withInitTestSentinel prefixes only when the sentinel env is enabled", () => {
    delete process.env.PRIVACY_POOLS_TEST_INIT_SENTINELS;
    expect(withInitTestSentinel("goal", "Choose a path")).toBe("Choose a path");

    process.env.PRIVACY_POOLS_TEST_INIT_SENTINELS = "1";
    expect(withInitTestSentinel("goal", "Choose a path")).toBe(
      "[pp-init:goal] Choose a path",
    );
  });

  test("buildRecoveryBackupContents renders the recovery phrase backup format", () => {
    const contents = buildRecoveryBackupContents("alpha beta gamma");
    expect(contents).toContain("Privacy Pools Recovery Phrase");
    expect(contents).toContain("alpha beta gamma");
    expect(contents).toContain("Anyone with this phrase can access your Privacy Pools deposits.");
  });

  test("writeRecoveryBackupFile writes a new backup and rejects unsafe targets", () => {
    const home = createTrackedTempDir("pp-init-helpers-");
    const backupPath = join(home, "recovery.txt");

    expect(writeRecoveryBackupFile(backupPath, "seed words")).toBe(backupPath);

    expect(() => writeRecoveryBackupFile("   ", "seed words")).toThrow(
      "Recovery phrase backup path cannot be empty.",
    );
    expect(
      () => writeRecoveryBackupFile(join(home, "missing", "recovery.txt"), "seed words"),
    ).toThrow("Recovery phrase backup directory does not exist");
    expect(() => writeRecoveryBackupFile(backupPath, "seed words")).toThrow(
      "Recovery phrase backup already exists",
    );

    const symlinkPath = join(home, "recovery-link.txt");
    symlinkSync(backupPath, symlinkPath);
    expect(() => writeRecoveryBackupFile(symlinkPath, "seed words")).toThrow(
      "Recovery phrase backup path cannot be a symlink.",
    );
  });

  test("writeRecoveryBackupFile surfaces filesystem write failures with a targeted CLI error", () => {
    const home = createTrackedTempDir("pp-init-helpers-locked-");
    const lockedDir = join(home, "locked");
    mkdirSync(lockedDir);
    chmodSync(lockedDir, 0o500);

    try {
      expect(() =>
        writeRecoveryBackupFile(join(lockedDir, "recovery.txt"), "seed words"),
      ).toThrow("Could not write the recovery phrase backup");
    } finally {
      chmodSync(lockedDir, 0o700);
    }
  });

  test("init file snapshots capture, restore, and roll back partial writes", () => {
    const home = createTrackedTempDir("pp-init-files-");
    const existingFile = join(home, "config.json");
    const createdFile = join(home, "mnemonic.txt");
    writeFileSync(existingFile, "before", "utf8");

    expect(captureInitFileSnapshot(join(home, "missing.txt"))).toEqual({
      path: join(home, "missing.txt"),
      existed: false,
    });

    const directorySnapshot = captureInitFileSnapshot(home);
    expect(directorySnapshot).toEqual({
      path: home,
      existed: true,
    });

    const fileSnapshot = captureInitFileSnapshot(existingFile);
    expect(fileSnapshot).toEqual({
      path: existingFile,
      existed: true,
      content: "before",
    });

    writeFileSync(createdFile, "created", "utf8");
    restoreInitFileSnapshot({ path: createdFile, existed: false });
    expect(existsSync(createdFile)).toBe(false);

    writeFileSync(existingFile, "after", "utf8");
    restoreInitFileSnapshot(fileSnapshot);
    expect(readFileSync(existingFile, "utf8")).toBe("before");

    const missingParent = join(home, "missing-parent");
    expect(() =>
      persistInitFilesAtomically([
        { path: existingFile, content: "updated" },
        { path: join(missingParent, "signer.txt"), content: "0x" + "11".repeat(32) },
      ]),
    ).toThrow();
    expect(readFileSync(existingFile, "utf8")).toBe("before");
  });

  test("restoreInitFileSnapshot tolerates missing created files and leaves directory snapshots untouched", () => {
    const home = createTrackedTempDir("pp-init-restore-");
    const directorySnapshot = captureInitFileSnapshot(home);

    expect(() =>
      restoreInitFileSnapshot({
        path: join(home, "already-gone.txt"),
        existed: false,
      }),
    ).not.toThrow();
    expect(() => restoreInitFileSnapshot(directorySnapshot)).not.toThrow();
  });

  test("persistInitFilesAtomically commits all writes on success", () => {
    const home = createTrackedTempDir("pp-init-commit-");
    const configPath = join(home, "config.json");
    const mnemonicPath = join(home, ".mnemonic");

    persistInitFilesAtomically([
      { path: configPath, content: "{\"defaultChain\":\"mainnet\"}" },
      { path: mnemonicPath, content: "alpha beta gamma" },
    ]);

    expect(readFileSync(configPath, "utf8")).toBe("{\"defaultChain\":\"mainnet\"}");
    expect(readFileSync(mnemonicPath, "utf8")).toBe("alpha beta gamma");
  });

  test("describeRecoveryPhraseSource and describeSignerKeySource cover create, import, environment, and prompt flows", () => {
    process.env.PRIVACY_POOLS_PRIVATE_KEY = "0x" + "11".repeat(32);

    expect(describeRecoveryPhraseSource({ signerOnly: true })).toBe(
      "keep existing phrase",
    );
    expect(describeRecoveryPhraseSource({ phraseFile: "recovery.txt" })).toBe(
      "load from file",
    );
    expect(describeRecoveryPhraseSource({ phraseStdin: true })).toBe(
      "load from stdin",
    );
    expect(describeRecoveryPhraseSource({ phrase: "alpha beta" })).toBe(
      "load inline",
    );
    expect(describeRecoveryPhraseSource({})).toBe("generate new phrase");

    expect(describeSignerKeySource({ privateKeyFile: "signer.txt" })).toBe(
      "save from file",
    );
    expect(describeSignerKeySource({ privateKeyStdin: true })).toBe(
      "save from stdin",
    );
    expect(describeSignerKeySource({ privateKey: "0x" + "22".repeat(32) })).toBe(
      "save inline",
    );
    expect(describeSignerKeySource({})).toBe("use environment only");
    delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    expect(describeSignerKeySource({})).toBe("prompt or skip");
  });

  test("normalizePrivateKeyOrThrow accepts valid keys and rejects malformed keys", () => {
    expect(normalizePrivateKeyOrThrow("11".repeat(32))).toBe(
      "0x" + "11".repeat(32),
    );
    expect(normalizePrivateKeyOrThrow("0x" + "22".repeat(32))).toBe(
      "0x" + "22".repeat(32),
    );
    expect(() => normalizePrivateKeyOrThrow("oops")).toThrow(
      "Invalid private key format.",
    );
  });

  test("resolveExistingInitState reports saved config, mnemonic, signer validity, and invalid chain overrides", () => {
    const home = createTrackedTempDir("pp-init-existing-state-");
    process.env.PRIVACY_POOLS_HOME = home;
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile("test test test test test test test test test test test junk");
    saveSignerKey("not-a-private-key");

    expect(resolveExistingInitState(undefined)).toMatchObject({
      hasConfig: true,
      hasRecoveryPhrase: true,
      hasSignerKey: true,
      signerKeyValid: false,
      hasExistingState: true,
      existingConfig: expect.objectContaining({ defaultChain: "mainnet" }),
    });

    saveSignerKey("0x" + "44".repeat(32));
    expect(resolveExistingInitState("MAINNET")).toMatchObject({
      signerKeyValid: true,
      hasSignerKey: true,
    });

    expect(() => resolveExistingInitState("not-a-chain")).toThrow("Unknown chain");
  });

  test("resolveDryRunPlan chooses signer-only, restore, and create flows from current state", () => {
    expect(
      resolveDryRunPlan({
        opts: { signerOnly: true },
        state: { hasExistingState: true },
        hasMnemonicSource: false,
        hasSignerSource: false,
      } as never),
    ).toMatchObject({ workflow: "signer_only", setupMode: "signer_only" });

    expect(
      resolveDryRunPlan({
        opts: {},
        state: { hasExistingState: true },
        hasMnemonicSource: true,
        hasSignerSource: false,
      } as never),
    ).toMatchObject({ workflow: "restore", setupMode: "replace" });

    expect(
      resolveDryRunPlan({
        opts: {},
        state: { hasExistingState: false, hasRecoveryPhrase: true, signerKeyValid: false },
        hasMnemonicSource: false,
        hasSignerSource: true,
      } as never),
    ).toMatchObject({ workflow: "signer_only", setupMode: "signer_only" });

    expect(
      resolveDryRunPlan({
        opts: {},
        state: { hasExistingState: false },
        hasMnemonicSource: false,
        hasSignerSource: false,
      } as never),
    ).toMatchObject({ workflow: "create", setupMode: "create" });

    expect(
      resolveDryRunPlan({
        opts: {},
        state: { hasExistingState: true },
        hasMnemonicSource: false,
        hasSignerSource: false,
      } as never),
    ).toMatchObject({ workflow: "create", setupMode: "replace" });
  });

  test("resolveNonInteractivePlan enforces signer-only and replacement safety rules", () => {
    expect(() =>
      resolveNonInteractivePlan({
        opts: { signerOnly: true },
        state: { hasRecoveryPhrase: false },
        hasMnemonicSource: false,
        hasSignerSource: false,
        hasEnvironmentSigner: false,
      } as never),
    ).toThrow("No recovery phrase is configured yet.");

    expect(() =>
      resolveNonInteractivePlan({
        opts: { signerOnly: true },
        state: { hasRecoveryPhrase: true },
        hasMnemonicSource: false,
        hasSignerSource: false,
        hasEnvironmentSigner: false,
      } as never),
    ).toThrow("The signer-only path needs a signer key source");

    expect(
      resolveNonInteractivePlan({
        opts: { signerOnly: true },
        state: { hasRecoveryPhrase: true },
        hasMnemonicSource: false,
        hasSignerSource: true,
        hasEnvironmentSigner: false,
      } as never),
    ).toMatchObject({ workflow: "signer_only", setupMode: "signer_only" });

    expect(() =>
      resolveNonInteractivePlan({
        opts: {},
        state: { hasExistingState: true },
        hasMnemonicSource: true,
        hasSignerSource: false,
        hasEnvironmentSigner: false,
      } as never),
    ).toThrow("already configured on this machine");

    expect(() =>
      resolveNonInteractivePlan({
        opts: {},
        state: { hasExistingState: true, hasRecoveryPhrase: true, signerKeyValid: false },
        hasMnemonicSource: false,
        hasSignerSource: false,
        hasEnvironmentSigner: false,
      } as never),
    ).toThrow("read-only mode");

    expect(
      resolveNonInteractivePlan({
        opts: {},
        state: { hasExistingState: false },
        hasMnemonicSource: false,
        hasSignerSource: false,
        hasEnvironmentSigner: false,
      } as never),
    ).toMatchObject({ workflow: "create", setupMode: "create" });

    expect(
      resolveNonInteractivePlan({
        opts: {},
        state: {
          hasExistingState: false,
          hasRecoveryPhrase: true,
          signerKeyValid: false,
        },
        hasMnemonicSource: false,
        hasSignerSource: false,
        hasEnvironmentSigner: true,
      } as never),
    ).toMatchObject({ workflow: "signer_only", setupMode: "signer_only" });

    expect(
      resolveNonInteractivePlan({
        opts: { force: true },
        state: { hasExistingState: true },
        hasMnemonicSource: true,
        hasSignerSource: false,
        hasEnvironmentSigner: false,
      } as never),
    ).toMatchObject({ workflow: "restore", setupMode: "replace" });

    expect(() =>
      resolveNonInteractivePlan({
        opts: {},
        state: {
          hasExistingState: true,
          hasRecoveryPhrase: true,
          signerKeyValid: true,
        },
        hasMnemonicSource: false,
        hasSignerSource: false,
        hasEnvironmentSigner: false,
      } as never),
    ).toThrow("already set up");
  });

  test("maybeConfirmReplacement fails closed in non-interactive replacement mode without --force", async () => {
    await expect(
      maybeConfirmReplacement({
        plan: {
          workflow: "create",
          replacingExisting: true,
        },
        state: {
          hasExistingState: true,
        },
        forceOverwrite: false,
        skipPrompts: true,
        silent: true,
      } as never),
    ).rejects.toThrow(
      "already configured on this machine. Re-run with --force to replace it.",
    );
  });

  test("maybeConfirmReplacement returns immediately when replacement is forced or unnecessary", async () => {
    await expect(
      maybeConfirmReplacement({
        plan: {
          workflow: "restore",
          replacingExisting: true,
        },
        state: {
          hasExistingState: true,
        },
        forceOverwrite: true,
        skipPrompts: false,
        silent: false,
      } as never),
    ).resolves.toBe(true);

    await expect(
      maybeConfirmReplacement({
        plan: {
          workflow: "create",
          replacingExisting: false,
        },
        state: {
          hasExistingState: true,
        },
        forceOverwrite: false,
        skipPrompts: false,
        silent: true,
      } as never),
    ).resolves.toBe(true);
  });

  test("collectSignerKey and collectDefaultChain take deterministic non-interactive defaults", async () => {
    await expect(
      collectSignerKey({
        hasEnvironmentSigner: false,
        inlineFlagUsed: false,
        required: true,
        skipPrompts: true,
        silent: true,
      } as never),
    ).rejects.toThrow(
      "A signer key is required to finish this setup path in non-interactive mode.",
    );

    await expect(
      collectSignerKey({
        hasEnvironmentSigner: false,
        inlineFlagUsed: false,
        required: false,
        skipPrompts: true,
        silent: true,
      } as never),
    ).resolves.toBeUndefined();

    await expect(
      collectDefaultChain({
        opts: {},
        existingConfig: null,
        skipPrompts: true,
        silent: true,
        stage: { step: 1, total: 4 },
      }),
    ).resolves.toBe("mainnet");
  });

  test("deriveReadiness distinguishes ready, read-only, and degraded restore discovery", () => {
    expect(
      deriveReadiness({
        setupMode: "create",
        signerKeySet: true,
      } as never),
    ).toBe("ready");
    expect(
      deriveReadiness({
        setupMode: "restore",
        signerKeySet: false,
      } as never),
    ).toBe("read_only");
    expect(
      deriveReadiness({
        setupMode: "restore",
        signerKeySet: true,
        restoreDiscovery: { status: "degraded" },
      } as never),
    ).toBe("discovery_required");
  });

  test("deriveReadiness reports discovery-required only for degraded restore discovery", () => {
    expect(
      deriveReadiness({
        setupMode: "restore",
        signerKeySet: true,
        restoreDiscovery: { status: "degraded" },
      } as never),
    ).toBe("discovery_required");
    expect(
      deriveReadiness({
        setupMode: "restore",
        signerKeySet: false,
        restoreDiscovery: { status: "legacy_website_action_required" },
      } as never),
    ).toBe("discovery_required");
    expect(
      deriveReadiness({
        setupMode: "create",
        signerKeySet: true,
      } as never),
    ).toBe("ready");
    expect(
      deriveReadiness({
        setupMode: "create",
        signerKeySet: false,
      } as never),
    ).toBe("read_only");
  });
});
