import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Command } from "commander";
import { CLIError } from "../../src/utils/errors.ts";
import {
  captureModuleExports,
  installModuleMocks,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";
import { restoreTestTty, setTestTty } from "../helpers/tty.ts";

const realConfig = captureModuleExports(
  await import("../../src/services/config.ts"),
);
const realInit = captureModuleExports(
  await import("../../src/commands/init.ts"),
);
const realFormat = captureModuleExports(
  await import("../../src/utils/format.ts"),
);
const realPromptUtils = captureModuleExports(
  await import("../../src/utils/prompts.ts"),
);

const MODULE_RESTORES = [
  ["../../src/services/config.ts", realConfig],
  ["../../src/commands/init.ts", realInit],
  ["../../src/utils/format.ts", realFormat],
  ["../../src/utils/prompts.ts", realPromptUtils],
] as const;

const loadConfigMock = mock(() => ({ defaultChain: "sepolia" }));
const handleInitCommandMock = mock(async () => undefined);
const infoMock = mock(() => undefined);
const confirmMock = mock(async () => true);

let maybeRecoverMissingWalletSetup: typeof import("../../src/utils/setup-recovery.ts").maybeRecoverMissingWalletSetup;

function missingRecoveryPhraseError(): CLIError {
  return new CLIError(
    "No recovery phrase found. Run 'privacy-pools init' first.",
    "SETUP",
    "Initialize with 'privacy-pools init'.",
    "SETUP_RECOVERY_PHRASE_MISSING",
  );
}

function fakeRoot(globalOpts: Record<string, unknown> = {}): Command {
  return {
    opts: () => globalOpts,
    parent: null,
  } as unknown as Command;
}

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: fakeRoot(globalOpts),
  } as unknown as Command;
}

async function loadSetupRecoveryModule(): Promise<void> {
  installModuleMocks([
    ["../../src/services/config.ts", () => ({
      ...realConfig,
      loadConfig: loadConfigMock,
    })],
    ["../../src/commands/init.ts", () => ({
      ...realInit,
      handleInitCommand: handleInitCommandMock,
    })],
    ["../../src/utils/format.ts", () => ({
      ...realFormat,
      info: infoMock,
    })],
    ["../../src/utils/prompts.ts", () => ({
      ...realPromptUtils,
      confirmPrompt: confirmMock,
    })],
  ]);

  ({ maybeRecoverMissingWalletSetup } = await import(
    "../../src/utils/setup-recovery.ts?setup-recovery-unit-tests"
  ));
}

describe("setup recovery helper", () => {
  beforeEach(async () => {
    setTestTty({ stdin: true, stdout: true, stderr: true });
    process.exitCode = undefined;
    loadConfigMock.mockReset();
    loadConfigMock.mockImplementation(() => ({ defaultChain: "sepolia" }));
    handleInitCommandMock.mockReset();
    handleInitCommandMock.mockImplementation(async () => undefined);
    infoMock.mockReset();
    confirmMock.mockReset();
    confirmMock.mockImplementation(async () => true);
    await loadSetupRecoveryModule();
  });

  afterEach(() => {
    restoreModuleImplementations(MODULE_RESTORES);
    restoreTestTty();
    process.exitCode = undefined;
  });

  test("offers to run init for interactive missing-recovery errors", async () => {
    const handled = await maybeRecoverMissingWalletSetup(
      missingRecoveryPhraseError(),
      fakeCommand({ chain: "mainnet" }),
    );

    expect(handled).toBe(true);
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Run privacy-pools init now?",
        default: true,
      }),
    );
    expect(handleInitCommandMock).toHaveBeenCalledWith(
      { defaultChain: "mainnet" },
      expect.objectContaining({
        parent: expect.objectContaining({
          opts: expect.any(Function),
        }),
      }),
    );
  });

  test("respects a declined init prompt and leaves the original error path in place", async () => {
    confirmMock.mockImplementation(async () => false);

    const handled = await maybeRecoverMissingWalletSetup(
      missingRecoveryPhraseError(),
      fakeCommand({ chain: "mainnet" }),
    );

    expect(handled).toBe(false);
    expect(handleInitCommandMock).not.toHaveBeenCalled();
  });

  test("stays inactive in machine mode and does not prompt", async () => {
    const handled = await maybeRecoverMissingWalletSetup(
      missingRecoveryPhraseError(),
      fakeCommand({ json: true }),
    );

    expect(handled).toBe(false);
    expect(confirmMock).not.toHaveBeenCalled();
    expect(handleInitCommandMock).not.toHaveBeenCalled();
  });

  test("treats prompt cancellation as a clean handled stop", async () => {
    confirmMock.mockImplementation(async () => {
      const error = new Error("prompt aborted") as Error & { name: string };
      error.name = "AbortPromptError";
      throw error;
    });

    const handled = await maybeRecoverMissingWalletSetup(
      missingRecoveryPhraseError(),
      fakeCommand(),
    );

    expect(handled).toBe(true);
    expect(infoMock).toHaveBeenCalledWith("Operation cancelled.", false);
    expect(process.exitCode).toBe(0);
    expect(handleInitCommandMock).not.toHaveBeenCalled();
  });
});
