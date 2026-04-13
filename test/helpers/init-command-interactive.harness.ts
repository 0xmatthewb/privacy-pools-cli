import {
  afterEach,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { saveConfig, saveMnemonicToFile } from "../../src/services/config.ts";
import {
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "./output.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "./temp.ts";
import { restoreTestTty, setTestTty } from "./tty.ts";

const realInquirerPrompts = await import("@inquirer/prompts");
const confirmPromptMock = mock(async () => true);
const inputPromptMock = mock(async () => "");
const passwordPromptMock = mock(async () => "");
const selectPromptMock = mock(async () => "generate");

let handleInitCommand: typeof import("../../src/commands/init.ts").handleInitCommand;

const ORIGINAL_HOME = process.env.PRIVACY_POOLS_HOME;
const ORIGINAL_SIGNER = process.env.PRIVACY_POOLS_PRIVATE_KEY;
const VALID_MNEMONIC =
  "test test test test test test test test test test test junk";

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*m/g, "");
}

function compactRenderedOutput(text: string): string {
  return stripAnsi(text)
    .replace(/[│╭╮╰╯─+|]/g, " ")
    .replace(/\s+/g, "");
}

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

async function loadInitCommandHandler(): Promise<void> {
  mock.module("@inquirer/prompts", () => ({
    ...realInquirerPrompts,
    confirm: confirmPromptMock,
    input: inputPromptMock,
    password: passwordPromptMock,
    select: selectPromptMock,
  }));

  ({ handleInitCommand } = await import(
    "../../src/commands/init.ts"
  ));
}

export function registerInitCommandInteractiveHarness(): void {
  beforeEach(() => {
    mock.restore();
    confirmPromptMock.mockClear();
    inputPromptMock.mockClear();
    passwordPromptMock.mockClear();
    selectPromptMock.mockClear();

    confirmPromptMock.mockImplementation(async () => true);
    inputPromptMock.mockImplementation(async () => "");
    passwordPromptMock.mockImplementation(async () => "");
    selectPromptMock.mockImplementation(async () => "generate");
  });

  beforeEach(async () => {
    setTestTty();
    await loadInitCommandHandler();
  });

  afterEach(() => {
    restoreTestTty();
    mock.restore();
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
}

export function registerInitCancelInvalidTests(): void {
  test("returns early when humans cancel reinitialization over existing state", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
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
}

export function registerInitGenerateBackupTests(): void {
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
    expect(stderr).toContain("Save this recovery phrase now.");
    expect(stderr).toContain("This is the only time the CLI will display it.");
    expect(stderr).toContain("Recovery phrase saved");
    expect(compactRenderedOutput(stderr)).toContain(
      backupPath.replace(/\s+/g, ""),
    );
    expect(stderr).toContain("No signer key set");
    expect(readFileSync(join(home, "config.json"), "utf8")).toContain(
      '"defaultChain": "optimism"',
    );
    expect(readFileSync(backupPath, "utf8")).toContain(generatedMnemonic);
    expect(existsSync(join(home, ".signer"))).toBe(false);
  });

  test("requires humans to confirm that the recovery phrase is backed up", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "generate")
      .mockImplementationOnce(async () => "copied");
    confirmPromptMock.mockImplementationOnce(async () => false);

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("must confirm that your recovery phrase is backed up");
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("rejects invalid signer keys entered interactively", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "generate")
      .mockImplementationOnce(async () => "copied");
    confirmPromptMock.mockImplementationOnce(async () => true);
    passwordPromptMock.mockImplementationOnce(async () => "0x1234");

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Invalid private key format");
    expect(existsSync(join(home, ".signer"))).toBe(false);
  });

  test("refuses to overwrite an existing recovery backup file", async () => {
    const home = useIsolatedHome();
    const backupPath = join(home, "workflow-recovery.txt");
    writeFileSync(backupPath, "existing", { encoding: "utf8", mode: 0o644 });
    selectPromptMock
      .mockImplementationOnce(async () => "generate")
      .mockImplementationOnce(async () => "file");
    inputPromptMock.mockImplementationOnce(async () => backupPath);

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Recovery phrase backup already exists");
    expect(readFileSync(backupPath, "utf8")).toBe("existing");
    expect(statSync(backupPath).mode & 0o777).toBe(0o644);
  });
}

export function registerInitImportVisibleSecretTests(): void {
  test("imports a valid recovery phrase interactively, saves an entered signer key, and picks a chain", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "import")
      .mockImplementationOnce(async () => "sepolia");
    passwordPromptMock
      .mockImplementationOnce(async () => VALID_MNEMONIC)
      .mockImplementationOnce(async () => "0x" + "55".repeat(32));

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Signer key saved.");
    expect(stderr).not.toContain("Save this recovery phrase now.");
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      VALID_MNEMONIC,
    );
    expect(readFileSync(join(home, ".signer"), "utf8").trim()).toBe(
      "0x" + "55".repeat(32),
    );
    expect(readFileSync(join(home, "config.json"), "utf8")).toContain(
      '"defaultChain": "sepolia"',
    );
  });

  test("treats first-run interactive import as a restore flow", async () => {
    useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "import")
      .mockImplementationOnce(async () => "mainnet");
    passwordPromptMock.mockImplementationOnce(async () => VALID_MNEMONIC);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("privacy-pools migrate status --all-chains");
    expect(stderr).not.toContain("privacy-pools completion --help");
    expect(stderr).not.toContain("privacy-pools pools");
  });

  test("warns humans when secrets are supplied through visible command flags", async () => {
    useIsolatedHome();

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          recoveryPhrase: VALID_MNEMONIC,
          privateKey: "0x" + "44".repeat(32),
          defaultChain: "mainnet",
        },
        fakeCommand({}),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("--recovery-phrase is visible in process list");
    expect(stderr).toContain("--private-key is visible in process list");
    expect(stderr).toContain("Signer key saved.");
  });
}
