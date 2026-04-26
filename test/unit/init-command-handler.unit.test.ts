import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";
import {
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../../src/services/config.ts";

const realInquirerPrompts = await import("@inquirer/prompts");
const realPromptCancellation = await import("../../src/utils/prompt-cancellation.ts");
const realIsPromptCancellationError =
  realPromptCancellation.isPromptCancellationError;
const discoverLoadedAccountsMock = mock(async () => ({
  status: "no_deposits" as const,
  chainsChecked: ["mainnet", "arbitrum", "optimism"],
}));
const isPromptCancellationErrorMock = mock(
  realIsPromptCancellationError,
);
const confirmPromptMock = mock(async () => {
  throw new Error("unexpected confirm prompt in non-interactive init tests");
});
const inputPromptMock = mock(async () => {
  throw new Error("unexpected input prompt in non-interactive init tests");
});
const passwordPromptMock = mock(async () => {
  throw new Error("unexpected password prompt in non-interactive init tests");
});
const selectPromptMock = mock(async () => {
  throw new Error("unexpected select prompt in non-interactive init tests");
});

let handleInitCommand: typeof import("../../src/commands/init.ts").handleInitCommand;

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_SIGNER = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const ORIGINAL_FORCE_TTY = process.env.PP_FORCE_TTY;
const ORIGINAL_INIT_PROMPT_ENGINE = process.env.PRIVACY_POOLS_INIT_PROMPT_ENGINE;
const VALID_MNEMONIC =
  "test test test test test test test test test test test junk";

async function loadInitCommandHandler(): Promise<void> {
  mock.module("@inquirer/prompts", () => ({
    ...realInquirerPrompts,
    confirm: confirmPromptMock,
    input: inputPromptMock,
    password: passwordPromptMock,
    select: selectPromptMock,
  }));
  mock.module("../../src/services/init-discovery.ts", () => ({
    discoverLoadedAccounts: discoverLoadedAccountsMock,
  }));
  mock.module("../../src/utils/prompt-cancellation.ts", () => ({
    ...realPromptCancellation,
    isPromptCancellationError: isPromptCancellationErrorMock,
  }));

  ({ handleInitCommand } = await import("../../src/commands/init.ts"));
}

function fakeCommand(
  globalOpts: Record<string, unknown> = {},
): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-init-handler-test-");
  process.env.PRIVACY_POOLS_HOME = home;
  return home;
}

beforeEach(() => {
  process.env.PRIVACY_POOLS_INIT_PROMPT_ENGINE = "inquirer";
  mock.restore();
  confirmPromptMock.mockClear();
  inputPromptMock.mockClear();
  passwordPromptMock.mockClear();
  selectPromptMock.mockClear();
  discoverLoadedAccountsMock.mockClear();
  isPromptCancellationErrorMock.mockClear();

  confirmPromptMock.mockImplementation(async () => {
    throw new Error("unexpected confirm prompt in non-interactive init tests");
  });
  inputPromptMock.mockImplementation(async () => {
    throw new Error("unexpected input prompt in non-interactive init tests");
  });
  passwordPromptMock.mockImplementation(async () => {
    throw new Error("unexpected password prompt in non-interactive init tests");
  });
  selectPromptMock.mockImplementation(async () => {
    throw new Error("unexpected select prompt in non-interactive init tests");
  });
  discoverLoadedAccountsMock.mockImplementation(async () => ({
    status: "no_deposits" as const,
    chainsChecked: ["mainnet", "arbitrum", "optimism"],
  }));
  isPromptCancellationErrorMock.mockImplementation(realIsPromptCancellationError);
});

beforeEach(async () => {
  await loadInitCommandHandler();
});

afterEach(() => {
  mock.restore();
  isPromptCancellationErrorMock.mockImplementation(realIsPromptCancellationError);
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  if (ORIGINAL_SIGNER === undefined) {
    delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
  } else {
    process.env.PRIVACY_POOLS_PRIVATE_KEY = ORIGINAL_SIGNER;
  }
  if (ORIGINAL_FORCE_TTY === undefined) {
    delete process.env.PP_FORCE_TTY;
  } else {
    process.env.PP_FORCE_TTY = ORIGINAL_FORCE_TTY;
  }
  if (ORIGINAL_INIT_PROMPT_ENGINE === undefined) {
    delete process.env.PRIVACY_POOLS_INIT_PROMPT_ENGINE;
  } else {
    process.env.PRIVACY_POOLS_INIT_PROMPT_ENGINE = ORIGINAL_INIT_PROMPT_ENGINE;
  }
  cleanupTrackedTempDirs();
});

describe("init command handler", () => {
  test("generates and returns a new mnemonic in JSON mode when --show-recovery-phrase is set", async () => {
    const home = useIsolatedHome();

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          showRecoveryPhrase: true,
          defaultChain: "sepolia",
          privateKey: "0x" + "11".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("sepolia");
    expect(json.signerKeySet).toBe(true);
    expect(json.recoveryPhrase.split(/\s+/)).toHaveLength(24);
    expect(existsSync(join(home, ".mnemonic"))).toBe(true);
    expect(existsSync(join(home, ".signer"))).toBe(true);
    expect(readFileSync(join(home, "config.json"), "utf8")).toContain(
      '"defaultChain": "sepolia"',
    );
    expect(stderr).toContain("Save your recovery phrase");
  });

  test("imports an existing mnemonic without echoing it back in JSON mode", async () => {
    const home = useIsolatedHome();
    const mnemonic =
      "test test test test test test test test test test test junk";
    const mnemonicFile = join(home, "recovery.txt");
    writeFileSync(
      mnemonicFile,
      `Privacy Pools Recovery Phrase\n\nRecovery Phrase:\n${mnemonic}\n`,
      "utf8",
    );

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          recoveryPhraseFile: mnemonicFile,
          privateKey: "0x" + "22".repeat(32),
          defaultChain: "mainnet",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.defaultChain).toBe("mainnet");
    expect(json.signerKeySet).toBe(true);
    expect(json.recoveryPhrase).toBeUndefined();
    expect(json.recoveryPhraseRedacted).toBeUndefined();
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(mnemonic);
    expect(stderr).toBe("");
  });

  test("warns humans when loading an existing account from an inline recovery phrase", async () => {
    const home = useIsolatedHome();

    const { stderr } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          recoveryPhrase: VALID_MNEMONIC,
          privateKey: "0x" + "23".repeat(32),
          defaultChain: "mainnet",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(VALID_MNEMONIC);
    expect(stderr).toContain("visible in process list and shell history");
    expect(stderr).toContain("Account loaded successfully");
  });

  test("updates interactive discovery progress while loading an existing account", async () => {
    useIsolatedHome();
    discoverLoadedAccountsMock.mockImplementationOnce(async (_mnemonic, options) => {
      options?.onProgress?.({
        currentChain: "mainnet",
        completedChains: 0,
        totalChains: 3,
      });
      return {
        status: "deposits_found" as const,
        chainsChecked: ["mainnet", "arbitrum", "optimism"],
        foundAccountChains: ["mainnet"],
      };
    });

    const { stderr } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          recoveryPhrase: VALID_MNEMONIC,
          privateKey: "0x" + "24".repeat(32),
          defaultChain: "mainnet",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(stderr).toContain("Checking supported chains for existing deposits...");
    expect(stderr).toContain("Discovery complete.");
    expect(stderr).toContain("Account loaded.");
  });

  test("includes restore discovery metadata in json mode when loading an existing account", async () => {
    useIsolatedHome();
    discoverLoadedAccountsMock.mockImplementationOnce(async () => ({
      status: "deposits_found" as const,
      chainsChecked: ["mainnet", "arbitrum", "optimism"],
      foundAccountChains: ["mainnet"],
    }));

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          recoveryPhrase: VALID_MNEMONIC,
          privateKey: "0x" + "25".repeat(32),
          defaultChain: "mainnet",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.setupMode).toBe("restore");
    expect(json.readiness).toBe("ready");
    expect(json.restoreDiscovery).toEqual({
      status: "deposits_found",
      chainsChecked: ["mainnet", "arbitrum", "optimism"],
      foundAccountChains: ["mainnet"],
    });
    expect(stderr).toBe("");
  });

  test("fails closed in machine mode when existing setup is present and --force is missing", async () => {
    useIsolatedHome();

    await captureAsyncOutput(() =>
      handleInitCommand(
        {
          showRecoveryPhrase: true,
          defaultChain: "mainnet",
          privateKey: "0x" + "33".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          showRecoveryPhrase: true,
          defaultChain: "mainnet",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "already set up",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects multiple mnemonic sources before writing files", async () => {
    const home = useIsolatedHome();
    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          recoveryPhrase: "test test test test test test test test test test test junk",
          recoveryPhraseStdin: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_MUTUALLY_EXCLUSIVE");
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("rejects multiple signer key sources before writing files", async () => {
    const home = useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          privateKey: "0x" + "44".repeat(32),
          privateKeyStdin: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_MUTUALLY_EXCLUSIVE");
    expect(existsSync(join(home, ".signer"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("rejects using both mnemonic stdin and private-key stdin in one invocation", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          recoveryPhraseStdin: true,
          privateKeyStdin: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "recovery phrase and signer key from stdin",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects unknown default chains before saving secrets", async () => {
    const home = useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          defaultChain: "polygon",
          showRecoveryPhrase: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("rejects recovery phrase files that contain no valid mnemonic", async () => {
    const home = useIsolatedHome();
    const recoveryPhraseFile = join(home, "recovery.txt");
    writeFileSync(recoveryPhraseFile, "not a recovery phrase", "utf8");

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          recoveryPhraseFile,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No valid recovery phrase found in file",
    );
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("rejects invalid inline recovery phrases before writing files", async () => {
    const home = useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          recoveryPhrase: "not a valid phrase",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Invalid recovery phrase",
    );
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("rolls back partial init writes when persistence fails after config is written", async () => {
    const home = useIsolatedHome();
    mkdirSync(join(home, ".signer"), { recursive: true });

    const { json } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          showRecoveryPhrase: true,
          defaultChain: "mainnet",
          privateKey: "0x" + "11".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(existsSync(join(home, "config.json"))).toBe(false);
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
    expect(existsSync(join(home, ".signer"))).toBe(true);
  });

  test("rejects private keys with the wrong length", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          privateKey: "0x1234",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Invalid private key format",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects ambiguous mnemonic backup files that contain multiple recovery phrases", async () => {
    const home = useIsolatedHome();
    const recoveryPhraseFile = join(home, "ambiguous.txt");
    writeFileSync(
      recoveryPhraseFile,
      [
        "test test test test test test test test test test test junk",
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      ].join("\n\n"),
      "utf8",
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          recoveryPhraseFile,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Multiple valid recovery phrases found in file",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed when the recovery phrase file cannot be read", async () => {
    const home = useIsolatedHome();
    const missingFile = join(home, "missing-recovery-phrase.txt");

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          recoveryPhraseFile: missingFile,
          privateKey: "0x" + "66".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Could not read recovery phrase file",
    );
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
    expect(existsSync(join(home, ".signer"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("fails closed when the signer key file cannot be read", async () => {
    const home = useIsolatedHome();
    const missingFile = join(home, "missing-signer.txt");

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          privateKeyFile: missingFile,
          showRecoveryPhrase: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "Could not read private key file",
    );
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
    expect(existsSync(join(home, ".signer"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("rejects empty private-key stdin input", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          privateKeyStdin: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No private key received on stdin",
    );
    expect(exitCode).toBe(2);
  });

  test("accepts an environment signer without persisting a signer file", async () => {
    const home = useIsolatedHome();
    process.env.PRIVACY_POOLS_PRIVATE_KEY = "0x" + "55".repeat(32);

    try {
      const { json } = await captureAsyncJsonOutput(() =>
        handleInitCommand(
          {
            showRecoveryPhrase: true,
            defaultChain: "mainnet",
          },
          fakeCommand({ json: true }),
        ),
      );

      expect(json.success).toBe(true);
      expect(json.signerKeySet).toBe(true);
      expect(json.setupMode).toBe("create");
      expect(json.readiness).toBe("ready");
      expect(existsSync(join(home, ".signer"))).toBe(false);
    } finally {
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    }
  });

  test("fails closed when --signer-only is used before any recovery phrase is configured", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          signerOnly: true,
          privateKey: "0x" + "77".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "No recovery phrase is configured yet",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects combining --signer-only with recovery phrase import flags", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          signerOnly: true,
          recoveryPhrase: VALID_MNEMONIC,
          privateKey: "0x" + "71".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "--signer-only cannot be combined with recovery phrase import flags",
    );
    expect(exitCode).toBe(2);
  });

  test("fails closed when --signer-only has no signer source in non-interactive mode", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(
      VALID_MNEMONIC,
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          signerOnly: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "needs a signer key source",
    );
    expect(exitCode).toBe(2);
  });

  test("treats an invalid persisted signer as a read-only setup that needs signer completion", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    saveSignerKey("not-a-valid-private-key");

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({ json: true })),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "still in read-only mode",
    );
    expect(exitCode).toBe(2);
  });

  test("automatically finishes read-only setup when a signer key source is provided", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);

    const { json } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          privateKey: "0x" + "77".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.setupMode).toBe("signer_only");
    expect(json.readiness).toBe("ready");
    expect(json.signerKeySet).toBe(true);
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(VALID_MNEMONIC);
    expect(readFileSync(join(home, ".signer"), "utf8").trim()).toBe(
      "0x" + "77".repeat(32),
    );
  });

  test("supports an explicit --signer-only machine flow when a signer source is provided", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);

    const { json } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          signerOnly: true,
          privateKey: "0x" + "72".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.setupMode).toBe("signer_only");
    expect(json.readiness).toBe("ready");
    expect(json.signerKeySet).toBe(true);
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(VALID_MNEMONIC);
    expect(readFileSync(join(home, ".signer"), "utf8").trim()).toBe(
      "0x" + "72".repeat(32),
    );
  });

  test("supports an explicit --signer-only human flow when a signer source is provided", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);

    const { stdout } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          signerOnly: true,
          privateKey: "0x" + "73".repeat(32),
        },
        fakeCommand({}),
      ),
    );

    expect(stdout).toBe("");
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      VALID_MNEMONIC,
    );
    expect(readFileSync(join(home, ".signer"), "utf8").trim()).toBe(
      "0x" + "73".repeat(32),
    );
  });

  test("automatically finishes human read-only setup when a signer key source is provided", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);

    const { stdout } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          privateKey: "0x" + "74".repeat(32),
        },
        fakeCommand({}),
      ),
    );

    expect(stdout).toBe("");
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      VALID_MNEMONIC,
    );
    expect(readFileSync(join(home, ".signer"), "utf8").trim()).toBe(
      "0x" + "74".repeat(32),
    );
  });

  test("requires --force before loading an account over existing local setup in machine mode", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          recoveryPhrase: VALID_MNEMONIC,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "already configured on this machine",
    );
    expect(exitCode).toBe(2);
  });

  test("creates a new account with --backup-file in JSON mode while keeping the phrase redacted", async () => {
    const home = useIsolatedHome();
    const backupFile = join(home, "privacy-pools-recovery.txt");

    const { json } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          defaultChain: "mainnet",
          backupFile,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.setupMode).toBe("create");
    expect(json.readiness).toBe("read_only");
    expect(json.signerKeySet).toBe(false);
    expect(json.recoveryPhrase).toBeUndefined();
    expect(json.recoveryPhraseRedacted).toBe(true);
    expect(json.backupFilePath).toBe(backupFile);
    expect(readFileSync(backupFile, "utf8")).toContain("Recovery Phrase:");
  });

  test("rejects --backup-file when loading an existing account", async () => {
    const home = useIsolatedHome();
    const backupFile = join(home, "privacy-pools-recovery.txt");

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          recoveryPhrase: VALID_MNEMONIC,
          backupFile,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message ?? json.errorMessage).toContain(
      "--backup-file only applies when creating a new account",
    );
    expect(existsSync(backupFile)).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("fails closed in JSON mode when a generated recovery phrase is not captured", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          defaultChain: "mainnet",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_INIT_GENERATE_REQUIRES_CAPTURE");
    expect(json.error.message ?? json.errorMessage).toContain(
      "requires recovery capture",
    );
    expect(exitCode).toBe(2);
  });

  test("rejects --backup-file in interactive mode when keeping the current account", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    const backupFile = join(home, "privacy-pools-recovery.txt");

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand(
        {
          backupFile,
        },
        fakeCommand({}),
      ),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("--backup-file only applies when creating a new account");
    expect(existsSync(backupFile)).toBe(false);
  });

  test("prints recovery guidance in human non-interactive mode when a backup file is provided", async () => {
    const home = useIsolatedHome();
    const backupFile = join(home, "privacy-pools-recovery.txt");

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          showRecoveryPhrase: false,
          defaultChain: "mainnet",
          backupFile,
        },
        fakeCommand({ yes: true }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Recovery phrase saved");
    expect(stderr).toContain("No signer key set");
    expect(readFileSync(backupFile, "utf8")).toContain("Recovery Phrase:");
  });

  test("restores existing config and mnemonic files if signer persistence fails mid-init", async () => {
    const home = useIsolatedHome();
    const originalConfig = {
      defaultChain: "mainnet",
      rpcOverrides: { 1: "https://rpc.example" },
    };
    saveConfig(originalConfig);
    saveMnemonicToFile(VALID_MNEMONIC);
    mkdirSync(join(home, ".signer"), { recursive: true });
    const replacementMnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          recoveryPhrase: replacementMnemonic,
          privateKey: "0x" + "91".repeat(32),
          force: true,
          defaultChain: "sepolia",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(exitCode).toBeGreaterThan(0);
    expect(readFileSync(join(home, "config.json"), "utf8")).toContain(
      '"defaultChain": "mainnet"',
    );
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(VALID_MNEMONIC);
    expect(existsSync(join(home, ".signer"))).toBe(true);
  });

  test("describes signer-only dry runs with the existing phrase and environment signer", async () => {
    useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    process.env.PRIVACY_POOLS_PRIVATE_KEY = "0x" + "92".repeat(32);

    const { json } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          dryRun: true,
          signerOnly: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.recoveryPhraseSource).toBe("keep existing phrase");
    expect(json.signerKeySource).toBe("use environment only");
    expect(json.writeTargets).toEqual([expect.stringContaining("config.json")]);
  });

  test("includes backup-file targets in create dry runs", async () => {
    const home = useIsolatedHome();
    const backupFile = join(home, "recovery-backup.txt");

    const { json } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          dryRun: true,
          defaultChain: "sepolia",
          backupFile,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.effectiveChain).toBe("sepolia");
    expect(json.recoveryPhraseSource).toBe("generate new phrase");
    expect(json.signerKeySource).toBe("prompt or skip");
    expect(json.writeTargets).toEqual(
      expect.arrayContaining([
        expect.stringContaining("config.json"),
        expect.stringContaining(".mnemonic"),
        backupFile,
      ]),
    );
  });

  test("includes signer targets in create dry runs when a signer source is provided", async () => {
    const home = useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          dryRun: true,
          defaultChain: "sepolia",
          privateKey: "0x" + "93".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.dryRun).toBe(true);
    expect(json.signerKeySource).toBe("save inline");
    expect(json.writeTargets).toEqual(
      expect.arrayContaining([
        join(home, "config.json"),
        join(home, ".mnemonic"),
        join(home, ".signer"),
      ]),
    );
  });

  test("warns before forced human replacement of existing local setup", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    saveSignerKey("0x" + "94".repeat(32));

    const replacementMnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          recoveryPhrase: replacementMnemonic,
          privateKey: "0x" + "95".repeat(32),
          defaultChain: "sepolia",
          force: true,
        },
        fakeCommand({ chain: "sepolia" }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Replacing the current local setup.");
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      replacementMnemonic,
    );
    expect(readFileSync(join(home, ".signer"), "utf8").trim()).toBe(
      "0x" + "95".repeat(32),
    );
  });

  test("persists RPC overrides for the selected default chain", async () => {
    const home = useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          showRecoveryPhrase: true,
          defaultChain: "sepolia",
          rpcUrl: "http://127.0.0.1:8545",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(readFileSync(join(home, "config.json"), "utf8")).toContain(
      '"11155111": "http://127.0.0.1:8545"',
    );
  });

  test("uses the environment signer for human restore flows without writing a signer file", async () => {
    const home = useIsolatedHome();
    process.env.PRIVACY_POOLS_PRIVATE_KEY = "0x" + "81".repeat(32);

    const { stderr } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          recoveryPhrase: VALID_MNEMONIC,
          defaultChain: "mainnet",
        },
        fakeCommand({ chain: "mainnet" }),
      ),
    );

    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(VALID_MNEMONIC);
    expect(existsSync(join(home, ".signer"))).toBe(false);
    expect(stderr).toContain("Using PRIVACY_POOLS_PRIVATE_KEY from environment.");
  });

  test("treats abrupt interactive prompt closure as a clean human cancellation", async () => {
    useIsolatedHome();
    process.env.PP_FORCE_TTY = "1";
    selectPromptMock.mockImplementationOnce(async () => {
      const error = new Error("prompt aborted") as Error & { name: string };
      error.name = "ExitPromptError";
      throw error;
    });

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Operation cancelled.");
  });

  test("prints a structured prompt-cancelled error in json mode when restore discovery aborts", async () => {
    useIsolatedHome();
    const cancelled = new Error("cancelled");
    discoverLoadedAccountsMock.mockImplementationOnce(async () => {
      throw cancelled;
    });
    isPromptCancellationErrorMock.mockImplementation(
      (error: unknown) => error === cancelled,
    );

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          recoveryPhrase: VALID_MNEMONIC,
          privateKey: "0x" + "82".repeat(32),
          defaultChain: "mainnet",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(stderr).toBe("");
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("PROMPT_CANCELLED");
    expect(json.error.message ?? json.errorMessage).toBe("Operation cancelled.");
  });
});
