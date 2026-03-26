import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { saveConfig, saveMnemonicToFile } from "../../src/services/config.ts";
import {
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "../helpers/temp.ts";

const confirmPromptMock = mock(async () => true);
const inputPromptMock = mock(async () => "");
const passwordPromptMock = mock(async () => "");
const selectPromptMock = mock(async () => "generate");

let handleInitCommand: typeof import("../../src/commands/init.ts").handleInitCommand;

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_SIGNER = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const VALID_MNEMONIC =
  "test test test test test test test test test test test junk";

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

function useIsolatedHome(): string {
  const home = createTrackedTempDir("pp-init-interactive-");
  process.env.PRIVACY_POOLS_HOME = home;
  return home;
}

beforeAll(async () => {
  mock.module("@inquirer/prompts", () => ({
    confirm: confirmPromptMock,
    input: inputPromptMock,
    password: passwordPromptMock,
    select: selectPromptMock,
  }));

  ({ handleInitCommand } = await import(
    "../../src/commands/init.ts?init-interactive-tests"
  ));
});

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  confirmPromptMock.mockClear();
  inputPromptMock.mockClear();
  passwordPromptMock.mockClear();
  selectPromptMock.mockClear();

  confirmPromptMock.mockImplementation(async () => true);
  inputPromptMock.mockImplementation(async () => "");
  passwordPromptMock.mockImplementation(async () => "");
  selectPromptMock.mockImplementation(async () => "generate");
});

afterEach(() => {
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
  cleanupTrackedTempDirs();
});

describe("init command handler interactive coverage", () => {
  test("returns early when humans cancel reinitialization over existing state", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBeNull();
    expect(stderr).toContain("Init cancelled.");
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      VALID_MNEMONIC,
    );
  });

  test("rejects invalid recovery phrases entered through the interactive import flow", async () => {
    const home = useIsolatedHome();
    selectPromptMock.mockImplementationOnce(async () => "import");
    passwordPromptMock.mockImplementationOnce(async () => "not a valid phrase");

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid recovery phrase");
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("generates a wallet interactively, saves a backup file, and lets humans skip the signer", async () => {
    const home = useIsolatedHome();
    const backupPath = join(home, "workflow-recovery.txt");
    selectPromptMock
      .mockImplementationOnce(async () => "generate")
      .mockImplementationOnce(async () => "file")
      .mockImplementationOnce(async () => "optimism");
    inputPromptMock.mockImplementationOnce(async () => backupPath);
    passwordPromptMock.mockImplementationOnce(async () => "");
    confirmPromptMock.mockImplementationOnce(async () => true);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    const generatedMnemonic = readFileSync(join(home, ".mnemonic"), "utf8").trim();

    expect(stdout).toBe("");
    expect(stderr).toContain("IMPORTANT: Save your recovery phrase securely");
    expect(stderr).toContain(`Recovery phrase saved to ${backupPath}`);
    expect(stderr).toContain("No signer key set");
    expect(readFileSync(join(home, "config.json"), "utf8")).toContain(
      '"defaultChain": "optimism"',
    );
    expect(readFileSync(backupPath, "utf8")).toContain(generatedMnemonic);
    expect(existsSync(join(home, ".signer"))).toBe(false);
  });

  test("warns humans when secrets are supplied through visible command flags", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          mnemonic: VALID_MNEMONIC,
          privateKey: "0x" + "44".repeat(32),
          defaultChain: "mainnet",
        },
        fakeCommand({}),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("--mnemonic is visible in process list");
    expect(stderr).toContain("--private-key is visible in process list");
    expect(stderr).toContain("Signer key saved.");
  });
});
