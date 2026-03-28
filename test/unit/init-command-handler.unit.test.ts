import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { handleInitCommand } from "../../src/commands/init.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
} from "../helpers/output.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;

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

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.PRIVACY_POOLS_HOME;
  } else {
    process.env.PRIVACY_POOLS_HOME = ORIGINAL_HOME;
  }
  cleanupTrackedTempDirs();
});

describe("init command handler", () => {
  test("generates and returns a new mnemonic in JSON mode when --show-mnemonic is set", async () => {
    const home = useIsolatedHome();

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          showMnemonic: true,
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
          mnemonicFile,
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

  test("fails closed in machine mode when existing setup is present and --force is missing", async () => {
    useIsolatedHome();

    await captureAsyncOutput(() =>
      handleInitCommand(
        {
          showMnemonic: true,
          defaultChain: "mainnet",
          privateKey: "0x" + "33".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          showMnemonic: true,
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
          mnemonic: "test test test test test test test test test test test junk",
          mnemonicStdin: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
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
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(existsSync(join(home, ".signer"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("rejects using both mnemonic stdin and private-key stdin in one invocation", async () => {
    useIsolatedHome();

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          mnemonicStdin: true,
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
          showMnemonic: true,
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
    expect(exitCode).toBe(2);
  });

  test("rolls back partial init writes when persistence fails after config is written", async () => {
    const home = useIsolatedHome();
    mkdirSync(join(home, ".signer"), { recursive: true });

    const { json } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          showMnemonic: true,
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
    const mnemonicFile = join(home, "ambiguous.txt");
    writeFileSync(
      mnemonicFile,
      [
        "test test test test test test test test test test test junk",
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      ].join("\n\n"),
      "utf8",
    );

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          mnemonicFile,
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
    const missingFile = join(home, "missing-mnemonic.txt");

    const { json, exitCode } = await captureAsyncJsonOutputAllowExit(() =>
      handleInitCommand(
        {
          mnemonicFile: missingFile,
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
          showMnemonic: true,
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
            showMnemonic: true,
            defaultChain: "mainnet",
          },
          fakeCommand({ json: true }),
        ),
      );

      expect(json.success).toBe(true);
      expect(json.signerKeySet).toBe(true);
      expect(existsSync(join(home, ".signer"))).toBe(false);
    } finally {
      delete process.env.PRIVACY_POOLS_PRIVATE_KEY;
    }
  });

  test("warns JSON callers when a generated recovery phrase is redacted", async () => {
    useIsolatedHome();

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          defaultChain: "mainnet",
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.recoveryPhrase).toBeUndefined();
    expect(json.recoveryPhraseRedacted).toBe(true);
    expect(stderr).toContain("Recovery phrase is redacted from JSON by default");
  });

  test("prints backup guidance in human mode when mnemonic is generated", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          showMnemonic: false,
          defaultChain: "mainnet",
        },
        fakeCommand({ yes: true }),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("IMPORTANT: Save your recovery phrase securely");
    expect(stderr).toContain("No signer key set");
  });

  test("persists RPC overrides for the selected default chain", async () => {
    const home = useIsolatedHome();

    const { json } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          showMnemonic: true,
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
});
