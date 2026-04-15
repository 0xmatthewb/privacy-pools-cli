import { afterEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureConfigDir,
  getSignerFilePath,
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../../src/services/config.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realPrompts = captureModuleExports(await import("@inquirer/prompts"));
const realPreviewRuntime = captureModuleExports(
  await import("../../src/preview/runtime.ts"),
);
const realPromptCancellation = captureModuleExports(
  await import("../../src/utils/prompt-cancellation.ts"),
);

const selectPromptMock = mock(async () => "create");
const confirmPromptMock = mock(async () => true);
const inputPromptMock = mock(async () => "");
const passwordPromptMock = mock(async () => "");
const maybeRenderPreviewScenarioMock = mock(async () => false);
const ensurePromptInteractionAvailableMock = mock(() => undefined);

const RESTORE_DEFINITIONS = [
  ["@inquirer/prompts", realPrompts],
  ["../../src/preview/runtime.ts", realPreviewRuntime],
  ["../../src/utils/prompt-cancellation.ts", realPromptCancellation],
] as const;

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_SIGNER_ENV = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const VALID_MNEMONIC =
  "test test test test test test test test test test test junk";
const VALID_PRIVATE_KEY = "0x" + "11".repeat(32);

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-init-interactive-helpers-");
  process.env.PRIVACY_POOLS_HOME = home;
  ensureConfigDir();
  return home;
}

async function loadInitHelpers() {
  mock.module("@inquirer/prompts", () => ({
    ...realPrompts,
    select: selectPromptMock,
    confirm: confirmPromptMock,
    input: inputPromptMock,
    password: passwordPromptMock,
  }));
  mock.module("../../src/preview/runtime.ts", () => ({
    ...realPreviewRuntime,
    maybeRenderPreviewScenario: maybeRenderPreviewScenarioMock,
  }));
  mock.module("../../src/utils/prompt-cancellation.ts", () => ({
    ...realPromptCancellation,
    ensurePromptInteractionAvailable: ensurePromptInteractionAvailableMock,
  }));

  return await import(
    `../../src/commands/init.ts?interactive-helper=${Date.now()}-${Math.random()}`
  );
}

function captureStderr<T>(fn: () => Promise<T> | T): Promise<{ result: T; stderr: string }> {
  const writes: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  return Promise.resolve()
    .then(fn)
    .then((result) => ({ result, stderr: writes.join("") }))
    .finally(() => {
      process.stderr.write = originalWrite;
    });
}

describe("init command interactive helpers", () => {
  afterEach(() => {
    restoreModuleImplementations(RESTORE_DEFINITIONS);
    cleanupTrackedTempDirs();
    if (ORIGINAL_HOME === undefined) {
      delete process.env.PRIVACY_POOLS_HOME;
    } else {
      process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
    }
    if (ORIGINAL_SIGNER_ENV === undefined) {
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    } else {
      process.env.PRIVACY_POOLS_PRIVATE_KEY = ORIGINAL_SIGNER_ENV;
    }
    selectPromptMock.mockReset();
    confirmPromptMock.mockReset();
    inputPromptMock.mockReset();
    passwordPromptMock.mockReset();
    maybeRenderPreviewScenarioMock.mockReset();
    ensurePromptInteractionAvailableMock.mockReset();
    selectPromptMock.mockImplementation(async () => "create");
    confirmPromptMock.mockImplementation(async () => true);
    inputPromptMock.mockImplementation(async () => "");
    passwordPromptMock.mockImplementation(async () => "");
    maybeRenderPreviewScenarioMock.mockImplementation(async () => false);
    ensurePromptInteractionAvailableMock.mockImplementation(() => undefined);
  });

  test("resolveExistingInitState inspects existing config, mnemonic, signer state, and chain overrides", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    saveSignerKey("not-a-private-key");

    const { resolveExistingInitState } = await loadInitHelpers();

    expect(resolveExistingInitState(undefined)).toMatchObject({
      hasConfig: true,
      hasRecoveryPhrase: true,
      hasSignerKey: true,
      signerKeyValid: false,
      hasExistingState: true,
      existingConfig: expect.objectContaining({ defaultChain: "mainnet" }),
    });

    saveSignerKey(VALID_PRIVATE_KEY);
    expect(resolveExistingInitState("MAINNET")).toMatchObject({
      signerKeyValid: true,
      hasSignerKey: true,
    });

    expect(() => resolveExistingInitState("not-a-chain")).toThrow("Unknown chain");
  });

  test("promptForWorkflowGoal covers create, configured replace, and preview-cancelled flows", async () => {
    let initHelpers = await loadInitHelpers();
    selectPromptMock.mockImplementationOnce(async () => "restore");

    await expect(
      initHelpers.promptForWorkflowGoal(
        {
          hasRecoveryPhrase: false,
          signerKeyValid: false,
          existingConfig: null,
        },
        false,
      ),
    ).resolves.toMatchObject({
      workflow: "restore",
      setupMode: "restore",
      replacingExisting: false,
    });

    initHelpers = await loadInitHelpers();
    selectPromptMock.mockImplementationOnce(async () => "signer_only");
    await expect(
      initHelpers.promptForWorkflowGoal(
        {
          hasRecoveryPhrase: true,
          signerKeyValid: true,
          existingConfig: { defaultChain: "sepolia", rpcOverrides: {} },
        },
        false,
      ),
    ).resolves.toMatchObject({
      workflow: "signer_only",
      setupMode: "signer_only",
      replacingExisting: false,
    });

    initHelpers = await loadInitHelpers();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);
    await expect(
      initHelpers.promptForWorkflowGoal(
        {
          hasRecoveryPhrase: true,
          signerKeyValid: false,
          existingConfig: null,
        },
        true,
      ),
    ).rejects.toThrow("Preview scenario rendered.");
  });

  test("promptForWorkflowGoal keeps preview takeovers fail-closed across setup branches", async () => {
    let initHelpers = await loadInitHelpers();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);
    await expect(
      initHelpers.promptForWorkflowGoal(
        {
          hasRecoveryPhrase: false,
          signerKeyValid: false,
          existingConfig: null,
        },
        false,
      ),
    ).rejects.toThrow("Preview scenario rendered.");

    initHelpers = await loadInitHelpers();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);
    await expect(
      initHelpers.promptForWorkflowGoal(
        {
          hasRecoveryPhrase: true,
          signerKeyValid: true,
          existingConfig: { defaultChain: "sepolia", rpcOverrides: {} },
        },
        false,
      ),
    ).rejects.toThrow("Preview scenario rendered.");

    initHelpers = await loadInitHelpers();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);
    await expect(
      initHelpers.promptForWorkflowGoal(
        {
          hasRecoveryPhrase: true,
          signerKeyValid: false,
          existingConfig: null,
        },
        false,
      ),
    ).rejects.toThrow("Preview scenario rendered.");
  });

  test("maybeConfirmReplacement handles force, skip-prompts, interactive cancel, and interactive confirmation", async () => {
    let initHelpers = await loadInitHelpers();
    await expect(
      initHelpers.maybeConfirmReplacement({
        plan: { replacingExisting: true, workflow: "create" },
        state: { hasExistingState: true },
        forceOverwrite: true,
        skipPrompts: false,
        silent: true,
      }),
    ).resolves.toBe(true);

    initHelpers = await loadInitHelpers();
    await expect(
      initHelpers.maybeConfirmReplacement({
        plan: { replacingExisting: true, workflow: "restore" },
        state: { hasExistingState: true },
        forceOverwrite: false,
        skipPrompts: true,
        silent: false,
      }),
    ).rejects.toThrow("already configured on this machine");

    initHelpers = await loadInitHelpers();
    confirmPromptMock.mockImplementationOnce(async () => false);
    await expect(
      initHelpers.maybeConfirmReplacement({
        plan: { replacingExisting: true, workflow: "create" },
        state: { hasExistingState: true },
        forceOverwrite: false,
        skipPrompts: false,
        silent: false,
      }),
    ).resolves.toBe(false);

    initHelpers = await loadInitHelpers();
    confirmPromptMock.mockImplementationOnce(async () => true);
    await expect(
      initHelpers.maybeConfirmReplacement({
        plan: { replacingExisting: true, workflow: "restore" },
        state: { hasExistingState: true },
        forceOverwrite: false,
        skipPrompts: false,
        silent: false,
      }),
    ).resolves.toBe(true);
  });

  test("promptForLoadedRecoveryPhrase trims valid input and retries invalid input", async () => {
    let initHelpers = await loadInitHelpers();
    passwordPromptMock.mockImplementationOnce(async () => `  ${VALID_MNEMONIC}  `);
    await expect(
      initHelpers.promptForLoadedRecoveryPhrase(false),
    ).resolves.toBe(VALID_MNEMONIC);

    initHelpers = await loadInitHelpers();
    passwordPromptMock
      .mockImplementationOnce(async () => "not a valid phrase")
      .mockImplementationOnce(async () => VALID_MNEMONIC);
    await expect(
      initHelpers.promptForLoadedRecoveryPhrase(false),
    ).resolves.toBe(VALID_MNEMONIC);

    initHelpers = await loadInitHelpers();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);
    await expect(
      initHelpers.promptForLoadedRecoveryPhrase(true),
    ).rejects.toThrow("Preview scenario rendered.");
  });

  test("handleGeneratedRecoveryBackup supports explicit files, non-interactive null returns, manual confirmation, and rejected confirmations", async () => {
    const home = useIsolatedHome();
    const backupPath = join(home, "generated-backup.txt");
    let initHelpers = await loadInitHelpers();

    await expect(
      initHelpers.handleGeneratedRecoveryBackup({
        mnemonic: VALID_MNEMONIC,
        skipPrompts: false,
        isJson: true,
        isQuiet: false,
        showPhrase: false,
        backupFile: backupPath,
        silent: false,
      }),
    ).resolves.toBe(backupPath);
    expect(readFileSync(backupPath, "utf8")).toContain(VALID_MNEMONIC);

    initHelpers = await loadInitHelpers();
    await expect(
      initHelpers.handleGeneratedRecoveryBackup({
        mnemonic: VALID_MNEMONIC,
        skipPrompts: true,
        isJson: true,
        isQuiet: true,
        showPhrase: false,
        silent: true,
      }),
    ).resolves.toBeNull();

    initHelpers = await loadInitHelpers();
    selectPromptMock.mockImplementationOnce(async () => "manual");
    confirmPromptMock.mockImplementationOnce(async () => true);
    await expect(
      initHelpers.handleGeneratedRecoveryBackup({
        mnemonic: VALID_MNEMONIC,
        skipPrompts: false,
        isJson: false,
        isQuiet: false,
        showPhrase: true,
        silent: false,
      }),
    ).resolves.toBeNull();

    initHelpers = await loadInitHelpers();
    selectPromptMock.mockImplementationOnce(async () => "file");
    inputPromptMock.mockImplementationOnce(async () => join(home, "chosen-backup.txt"));
    await expect(
      initHelpers.handleGeneratedRecoveryBackup({
        mnemonic: VALID_MNEMONIC,
        skipPrompts: false,
        isJson: false,
        isQuiet: false,
        showPhrase: true,
        silent: false,
      }),
    ).resolves.toBe(join(home, "chosen-backup.txt"));
    expect(existsSync(join(home, "chosen-backup.txt"))).toBe(true);

    initHelpers = await loadInitHelpers();
    selectPromptMock.mockImplementationOnce(async () => "manual");
    confirmPromptMock.mockImplementationOnce(async () => false);
    await expect(
      initHelpers.handleGeneratedRecoveryBackup({
        mnemonic: VALID_MNEMONIC,
        skipPrompts: false,
        isJson: false,
        isQuiet: false,
        showPhrase: true,
        silent: false,
      }),
    ).rejects.toThrow("You must confirm that your recovery phrase is backed up.");
  });

  test("handleGeneratedRecoveryBackup stays fail-closed when preview rendering takes over backup prompts", async () => {
    const home = useIsolatedHome();
    let initHelpers = await loadInitHelpers();

    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);
    await expect(
      initHelpers.handleGeneratedRecoveryBackup({
        mnemonic: VALID_MNEMONIC,
        skipPrompts: false,
        isJson: false,
        isQuiet: false,
        showPhrase: true,
        silent: false,
      }),
    ).rejects.toThrow("Preview scenario rendered.");

    initHelpers = await loadInitHelpers();
    selectPromptMock.mockImplementationOnce(async () => "file");
    maybeRenderPreviewScenarioMock
      .mockImplementationOnce(async () => false)
      .mockImplementationOnce(async () => true);
    await expect(
      initHelpers.handleGeneratedRecoveryBackup({
        mnemonic: VALID_MNEMONIC,
        skipPrompts: false,
        isJson: false,
        isQuiet: false,
        showPhrase: true,
        silent: false,
      }),
    ).rejects.toThrow("Preview scenario rendered.");

    initHelpers = await loadInitHelpers();
    selectPromptMock.mockImplementationOnce(async () => "manual");
    maybeRenderPreviewScenarioMock
      .mockImplementationOnce(async () => false)
      .mockImplementationOnce(async () => true);
    await expect(
      initHelpers.handleGeneratedRecoveryBackup({
        mnemonic: VALID_MNEMONIC,
        skipPrompts: false,
        isJson: false,
        isQuiet: false,
        showPhrase: true,
        silent: false,
      }),
    ).rejects.toThrow("Preview scenario rendered.");

    expect(existsSync(join(home, "chosen-backup.txt"))).toBe(false);
  });

  test("handleGeneratedRecoveryBackup emits json guidance when machine output keeps the phrase redacted", async () => {
    const initHelpers = await loadInitHelpers();

    const { result, stderr } = await captureStderr(() =>
      initHelpers.handleGeneratedRecoveryBackup({
        mnemonic: VALID_MNEMONIC,
        skipPrompts: true,
        isJson: true,
        isQuiet: false,
        showPhrase: false,
        silent: false,
      }),
    );

    expect(result).toBeNull();
    expect(stderr).toContain(
      "Recovery phrase capture is required in non-interactive mode. Pass --show-recovery-phrase or --backup-file.",
    );
  });

  test("verifyGeneratedRecoveryPhrase accepts correct answers and retries mismatches", async () => {
    const verificationMnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
    const verificationWords = verificationMnemonic.split(" ");
    let initHelpers = await loadInitHelpers();
    inputPromptMock
      .mockImplementationOnce(async () => verificationWords[2]!)
      .mockImplementationOnce(async () => verificationWords[11]!)
      .mockImplementationOnce(async () => verificationWords[23]!);

    const { stderr } = await captureStderr(async () => {
      await initHelpers.verifyGeneratedRecoveryPhrase(
        verificationMnemonic,
        false,
      );
    });

    expect(stderr).toContain("Recovery phrase verified.");

    initHelpers = await loadInitHelpers();
    inputPromptMock
      .mockImplementationOnce(async () => "wrong")
      .mockImplementationOnce(async () => "wrong")
      .mockImplementationOnce(async () => "wrong")
      .mockImplementationOnce(async () => verificationWords[2]!)
      .mockImplementationOnce(async () => verificationWords[11]!)
      .mockImplementationOnce(async () => verificationWords[23]!);
    const retry = await captureStderr(async () => {
      await initHelpers.verifyGeneratedRecoveryPhrase(
        verificationMnemonic,
        false,
      );
    });
    expect(retry.stderr).toContain("Some words are incorrect. Please check and try again.");
    expect(retry.stderr).toContain("Recovery phrase verified.");
  });

  test("verifyGeneratedRecoveryPhrase stays fail-closed when preview rendering takes over verification", async () => {
    const initHelpers = await loadInitHelpers();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);

    await expect(
      initHelpers.verifyGeneratedRecoveryPhrase(
        VALID_MNEMONIC,
        true,
      ),
    ).rejects.toThrow("Preview scenario rendered.");
  });

  test("collectSignerKey normalizes inline keys, honors env state, and handles required prompt flows", async () => {
    let initHelpers = await loadInitHelpers();
    const { result: inlineKey, stderr } = await captureStderr(() =>
      initHelpers.collectSignerKey({
        signerKeySource: VALID_PRIVATE_KEY.slice(2),
        inlineFlagUsed: true,
        hasEnvironmentSigner: false,
        required: false,
        skipPrompts: false,
        silent: false,
      }),
    );
    expect(inlineKey).toBe(VALID_PRIVATE_KEY);
    expect(stderr).toContain("Warning: --private-key is visible");

    initHelpers = await loadInitHelpers();
    await expect(
      initHelpers.collectSignerKey({
        inlineFlagUsed: false,
        hasEnvironmentSigner: false,
        required: true,
        skipPrompts: true,
        silent: true,
      }),
    ).rejects.toThrow("A signer key is required to finish this setup path");

    initHelpers = await loadInitHelpers();
    await expect(
      initHelpers.collectSignerKey({
        inlineFlagUsed: false,
        hasEnvironmentSigner: false,
        required: false,
        skipPrompts: true,
        silent: true,
      }),
    ).resolves.toBeUndefined();

    initHelpers = await loadInitHelpers();
    passwordPromptMock.mockImplementationOnce(async () => "");
    await expect(
      initHelpers.collectSignerKey({
        inlineFlagUsed: false,
        hasEnvironmentSigner: false,
        required: true,
        skipPrompts: false,
        silent: false,
      }),
    ).rejects.toThrow("A signer key is required to finish setup.");

    initHelpers = await loadInitHelpers();
    passwordPromptMock.mockImplementationOnce(async () => VALID_PRIVATE_KEY);
    await expect(
      initHelpers.collectSignerKey({
        inlineFlagUsed: false,
        hasEnvironmentSigner: false,
        required: true,
        skipPrompts: false,
        silent: false,
      }),
    ).resolves.toBe(VALID_PRIVATE_KEY);

    initHelpers = await loadInitHelpers();
    process.env.PRIVACY_POOLS_PRIVATE_KEY = VALID_PRIVATE_KEY;
    await expect(
      initHelpers.collectSignerKey({
        inlineFlagUsed: false,
        hasEnvironmentSigner: true,
        required: false,
        skipPrompts: false,
        silent: false,
      }),
    ).resolves.toBeUndefined();
  });

  test("collectSignerKey stays fail-closed when preview rendering takes over signer capture", async () => {
    const initHelpers = await loadInitHelpers();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);

    await expect(
      initHelpers.collectSignerKey({
        inlineFlagUsed: false,
        hasEnvironmentSigner: false,
        required: false,
        skipPrompts: false,
        silent: false,
      }),
    ).rejects.toThrow("Preview scenario rendered.");
  });

  test("collectDefaultChain and hasEnvironmentSigner cover defaults, prompts, preview exits, and env trimming", async () => {
    let initHelpers = await loadInitHelpers();

    expect(
      await initHelpers.collectDefaultChain({
        opts: { defaultChain: "SEPOLIA" },
        existingConfig: null,
        skipPrompts: false,
        silent: true,
        stage: { step: 1, total: 2 },
      }),
    ).toBe("sepolia");

    expect(
      await initHelpers.collectDefaultChain({
        opts: {},
        existingConfig: { defaultChain: "optimism", rpcOverrides: {} },
        skipPrompts: false,
        silent: true,
        stage: { step: 1, total: 2 },
      }),
    ).toBe("optimism");

    expect(
      await initHelpers.collectDefaultChain({
        opts: {},
        existingConfig: null,
        skipPrompts: true,
        silent: true,
        stage: { step: 1, total: 2 },
      }),
    ).toBe("mainnet");

    initHelpers = await loadInitHelpers();
    selectPromptMock.mockImplementationOnce(async () => "op-sepolia");
    expect(
      await initHelpers.collectDefaultChain({
        opts: {},
        existingConfig: null,
        skipPrompts: false,
        silent: false,
        stage: { step: 2, total: 4 },
      }),
    ).toBe("op-sepolia");

    initHelpers = await loadInitHelpers();
    maybeRenderPreviewScenarioMock.mockImplementationOnce(async () => true);
    await expect(
      initHelpers.collectDefaultChain({
        opts: {},
        existingConfig: null,
        skipPrompts: false,
        silent: false,
        stage: { step: 2, total: 4 },
      }),
    ).rejects.toThrow("Preview scenario rendered.");

    delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    expect(initHelpers.hasEnvironmentSigner()).toBe(false);
    process.env.PRIVACY_POOLS_PRIVATE_KEY = "   ";
    expect(initHelpers.hasEnvironmentSigner()).toBe(false);
    process.env.PRIVACY_POOLS_PRIVATE_KEY = VALID_PRIVATE_KEY;
    expect(initHelpers.hasEnvironmentSigner()).toBe(true);

    saveSignerKey(VALID_PRIVATE_KEY);
    expect(readFileSync(getSignerFilePath(), "utf8").trim()).toBe(VALID_PRIVATE_KEY);
  });
});
