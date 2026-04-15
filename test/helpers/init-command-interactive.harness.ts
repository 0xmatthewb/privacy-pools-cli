import {
  afterEach,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import {
  existsSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import {
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../../src/services/config.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "./output.ts";
import {
  cleanupTrackedTempDirs,
  createTrackedTempDir,
} from "./temp.ts";
import { restoreTestTty, setTestTty } from "./tty.ts";

const realInquirerPrompts = await import("@inquirer/prompts");
const realPreviewRuntime = await import("../../src/preview/runtime.ts");
const realWalletService = await import("../../src/services/wallet.ts");
const discoverLoadedAccountsMock = mock(async () => ({
  status: "no_deposits" as const,
  chainsChecked: ["mainnet", "arbitrum", "optimism"],
}));
const FIXED_GENERATED_MNEMONIC =
  "soccer grid chapter game kitchen test panda solid note share argue snack divorce begin pig permit fish man bicycle snake dress certain disagree harvest";
const generateMnemonicMock = mock(() => FIXED_GENERATED_MNEMONIC);
const confirmPromptMock = mock(async () => true);
const inputPromptMock = mock(async () => "");
const passwordPromptMock = mock(async () => "");
const selectPromptMock = mock(async () => "create");
const maybeRenderPreviewScenarioMock = mock(async () => false);
const maybeRenderPreviewProgressStepMock = mock(async () => false);

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
  mock.module("../../src/preview/runtime.ts", () => ({
    ...realPreviewRuntime,
    maybeRenderPreviewScenario: maybeRenderPreviewScenarioMock,
    maybeRenderPreviewProgressStep: maybeRenderPreviewProgressStepMock,
  }));
  mock.module("../../src/services/wallet.ts", () => ({
    ...realWalletService,
    generateMnemonic: generateMnemonicMock,
  }));
  mock.module("../../src/services/init-discovery.ts", () => ({
    discoverLoadedAccounts: discoverLoadedAccountsMock,
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
    maybeRenderPreviewScenarioMock.mockClear();
    maybeRenderPreviewProgressStepMock.mockClear();
    discoverLoadedAccountsMock.mockClear();
    generateMnemonicMock.mockClear();

    confirmPromptMock.mockImplementation(async () => true);
    inputPromptMock.mockImplementation(async () => "");
    passwordPromptMock.mockImplementation(async () => "");
    selectPromptMock.mockImplementation(async () => "create");
    maybeRenderPreviewScenarioMock.mockImplementation(async () => false);
    maybeRenderPreviewProgressStepMock.mockImplementation(async () => false);
    discoverLoadedAccountsMock.mockImplementation(async () => ({
      status: "no_deposits" as const,
      chainsChecked: ["mainnet", "arbitrum", "optimism"],
    }));
    generateMnemonicMock.mockImplementation(() => FIXED_GENERATED_MNEMONIC);
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

  test("retries invalid recovery phrases entered through the interactive import flow", async () => {
    const home = useIsolatedHome();
    const cancelled = new Error("cancelled") as Error & { name: string };
    cancelled.name = "ExitPromptError";
    selectPromptMock.mockImplementationOnce(async () => "restore");
    passwordPromptMock
      .mockImplementationOnce(async () => "not a valid phrase")
      .mockImplementationOnce(async () => {
        throw cancelled;
      });

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("doesn't look right. Please check and try again");
    expect(stderr).toContain("Operation cancelled.");
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });
}

export function registerInitGenerateBackupTests(): void {
  test("generates a wallet interactively, saves a backup file, and lets humans skip the signer", async () => {
    const home = useIsolatedHome();
    const backupPath = join(home, "workflow-recovery.txt");
    selectPromptMock
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "file")
      .mockImplementationOnce(async () => "optimism");
    inputPromptMock.mockImplementationOnce(async () => backupPath);
    passwordPromptMock.mockImplementationOnce(async () => "");

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    const generatedMnemonic = readFileSync(join(home, ".mnemonic"), "utf8").trim();

    expect(stdout).toBe("");
    expect(stderr).toContain("Recovery phrase saved");
    expect(stderr).not.toContain("This is the only time the CLI will display it.");
    expect(stderr).not.toContain(generatedMnemonic);
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
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "manual");
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
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "manual");
    confirmPromptMock.mockImplementationOnce(async () => true);
    inputPromptMock
      .mockImplementationOnce(async () => "chapter")
      .mockImplementationOnce(async () => "snack")
      .mockImplementationOnce(async () => "harvest");
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
      .mockImplementationOnce(async () => "create")
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

  test("rejects an empty recovery backup path", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "file");
    inputPromptMock.mockImplementationOnce(async () => "   ");

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Recovery phrase backup path cannot be empty");
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("rejects recovery backup paths whose parent directory does not exist", async () => {
    const home = useIsolatedHome();
    const backupPath = join(home, "missing", "workflow-recovery.txt");
    selectPromptMock
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "file");
    inputPromptMock.mockImplementationOnce(async () => backupPath);

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Recovery phrase backup directory does not exist");
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("rejects symlink recovery backup paths", async () => {
    const home = useIsolatedHome();
    const realTarget = join(home, "backup-target.txt");
    const backupPath = join(home, "workflow-recovery.txt");
    writeFileSync(realTarget, "existing target", "utf8");
    symlinkSync(realTarget, backupPath);
    selectPromptMock
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "file");
    inputPromptMock.mockImplementationOnce(async () => backupPath);

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("Recovery phrase backup path cannot be a symlink");
    expect(readFileSync(realTarget, "utf8")).toBe("existing target");
  });
}

export function registerInitImportVisibleSecretTests(): void {
  test("imports a valid recovery phrase interactively, saves an entered signer key, and picks a chain", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "restore")
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
      .mockImplementationOnce(async () => "restore")
      .mockImplementationOnce(async () => "mainnet");
    passwordPromptMock.mockImplementationOnce(async () => VALID_MNEMONIC);

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Account loaded successfully.");
    expect(stderr).toContain("No signer key set. This machine will stay in read-only mode");
    expect(stderr).toContain("Default chain set to mainnet.");
    expect(stderr).toContain("privacy-pools pools");
    expect(stderr).not.toContain("privacy-pools completion --help");
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

  test("routes existing read-only setups into the signer-only interactive path", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    selectPromptMock.mockImplementationOnce(async () => "signer_only");
    passwordPromptMock.mockImplementationOnce(async () => "0x" + "66".repeat(32));

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Finish setup");
    expect(stderr).toContain("Signer key saved.");
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      VALID_MNEMONIC,
    );
    expect(readFileSync(join(home, ".signer"), "utf8").trim()).toBe(
      "0x" + "66".repeat(32),
    );
  });

  test("lets fully configured users replace only the signer key", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    saveSignerKey("0x" + "10".repeat(32));
    selectPromptMock.mockImplementationOnce(async () => "signer_only");
    passwordPromptMock.mockImplementationOnce(async () => "0x" + "77".repeat(32));

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools is already set up");
    expect(stderr).toContain("Signer key saved.");
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      VALID_MNEMONIC,
    );
    expect(readFileSync(join(home, ".signer"), "utf8").trim()).toBe(
      "0x" + "77".repeat(32),
    );
  });

  test("requires a signer key when humans choose the signer-only setup path", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    selectPromptMock.mockImplementationOnce(async () => "signer_only");
    passwordPromptMock.mockImplementationOnce(async () => "   ");

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(exitCode).toBe(2);
    expect(stderr).toContain("A signer key is required to finish setup.");
    expect(existsSync(join(home, ".signer"))).toBe(false);
  });

  test("lets configured users replace the current setup by loading another account", async () => {
    const home = useIsolatedHome();
    const replacementMnemonic =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    saveSignerKey("0x" + "11".repeat(32));
    discoverLoadedAccountsMock.mockImplementationOnce(async () => ({
      status: "deposits_found" as const,
      chainsChecked: ["mainnet", "arbitrum", "optimism"],
      foundAccountChains: ["mainnet"],
    }));
    selectPromptMock
      .mockImplementationOnce(async () => "restore")
      .mockImplementationOnce(async () => "optimism");
    confirmPromptMock.mockImplementationOnce(async () => true);
    passwordPromptMock
      .mockImplementationOnce(async () => replacementMnemonic)
      .mockImplementationOnce(async () => "0x" + "22".repeat(32));

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Replace current setup");
    expect(stderr).toContain("Account loaded.");
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      replacementMnemonic,
    );
    expect(readFileSync(join(home, ".signer"), "utf8").trim()).toBe(
      "0x" + "22".repeat(32),
    );
    expect(readFileSync(join(home, "config.json"), "utf8")).toContain(
      '"defaultChain": "mainnet"',
    );
  });
}

export function registerInitDryRunAndPreviewTests(): void {
  test("reports dry-run targets and overwrite prompts in JSON mode", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      handleInitCommand(
        {
          dryRun: true,
          privateKey: "0x" + "66".repeat(32),
        },
        fakeCommand({ json: true }),
      ),
    );

    expect(json.success).toBe(true);
    expect(json.operation).toBe("init");
    expect(json.dryRun).toBe(true);
    expect(json.effectiveChain).toBe("mainnet");
    expect(json.overwriteExisting).toBe(false);
    expect(json.overwritePromptRequired).toBe(false);
    expect(json.writeTargets).toEqual(
      expect.arrayContaining([
        join(home, "config.json"),
        join(home, ".signer"),
      ]),
    );
    expect(stderr).toBe("");
  });

  test("preview setup mode returns before the first interactive choice", async () => {
    const home = useIsolatedHome();
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init setup mode",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Set up Privacy Pools");
    expect(selectPromptMock).not.toHaveBeenCalled();
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("preview import checkpoint returns before reading the recovery phrase", async () => {
    const home = useIsolatedHome();
    selectPromptMock.mockImplementationOnce(async () => "restore");
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init import recovery prompt",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Load existing account");
    expect(passwordPromptMock).not.toHaveBeenCalled();
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("preview backup path checkpoint returns before prompting for a file path", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "file");
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init backup path",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Save recovery phrase backup");
    expect(stderr).toContain("Default path:");
    expect(inputPromptMock).not.toHaveBeenCalled();
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("preview signer-key checkpoint returns before the signer prompt", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "manual");
    confirmPromptMock.mockImplementationOnce(async () => true);
    inputPromptMock
      .mockImplementationOnce(async () => "chapter")
      .mockImplementationOnce(async () => "snack")
      .mockImplementationOnce(async () => "harvest");
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init signer key",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Your signer key pays gas");
    expect(passwordPromptMock).not.toHaveBeenCalled();
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("preview backup method checkpoint returns before backup selection", async () => {
    const home = useIsolatedHome();
    selectPromptMock.mockImplementationOnce(async () => "create");
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init backup method",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Back up recovery phrase");
    expect(selectPromptMock).toHaveBeenCalledTimes(1);
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("preview backup confirmation checkpoint returns before confirmation", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "manual");
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init backup confirm",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Confirm recovery phrase backup");
    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("preview recovery verification checkpoint returns before word checks", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "manual");
    confirmPromptMock.mockImplementationOnce(async () => true);
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init recovery verification",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Verify recovery phrase");
    expect(inputPromptMock).not.toHaveBeenCalled();
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
  });

  test("preview default-chain checkpoint returns before network selection", async () => {
    const home = useIsolatedHome();
    process.env.PRIVACY_POOLS_PRIVATE_KEY = "0x" + "77".repeat(32);
    selectPromptMock
      .mockImplementationOnce(async () => "create")
      .mockImplementationOnce(async () => "manual");
    confirmPromptMock.mockImplementationOnce(async () => true);
    inputPromptMock
      .mockImplementationOnce(async () => "chapter")
      .mockImplementationOnce(async () => "snack")
      .mockImplementationOnce(async () => "harvest");
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init default chain",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(selectPromptMock).toHaveBeenCalledTimes(2);
    expect(stderr).toContain("Verify recovery phrase");
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });

  test("final preview checkpoint returns before persistence", async () => {
    const home = useIsolatedHome();
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand(
        {
          recoveryPhrase: VALID_MNEMONIC,
          privateKey: "0x" + "88".repeat(32),
          defaultChain: "mainnet",
        },
        fakeCommand({}),
      ),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("--recovery-phrase is visible in process list");
    expect(existsSync(join(home, "config.json"))).toBe(false);
    expect(existsSync(join(home, ".mnemonic"))).toBe(false);
    expect(existsSync(join(home, ".signer"))).toBe(false);
  });

  test("preview overwrite checkpoint returns before replacement confirmation", async () => {
    const home = useIsolatedHome();
    saveConfig({ defaultChain: "mainnet", rpcOverrides: {} });
    saveMnemonicToFile(VALID_MNEMONIC);
    saveSignerKey("0x" + "11".repeat(32));
    selectPromptMock.mockImplementationOnce(async () => "restore");
    maybeRenderPreviewScenarioMock.mockImplementation(async (commandKey) =>
      commandKey === "init overwrite prompt",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Replace current setup");
    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      VALID_MNEMONIC,
    );
  });

  test("preview restore discovery progress returns before the discovery scan runs", async () => {
    const home = useIsolatedHome();
    selectPromptMock
      .mockImplementationOnce(async () => "restore")
      .mockImplementationOnce(async () => "mainnet");
    passwordPromptMock.mockImplementationOnce(async () => VALID_MNEMONIC);
    maybeRenderPreviewProgressStepMock.mockImplementation(async (stepId) =>
      stepId === "init.restore-discovery",
    );

    const { stdout, stderr } = await captureAsyncOutput(() =>
      handleInitCommand({}, fakeCommand({})),
    );

    expect(stdout).toBe("");
    expect(stderr).toContain("Load existing account");
    expect(discoverLoadedAccountsMock).not.toHaveBeenCalled();
    expect(readFileSync(join(home, ".mnemonic"), "utf8").trim()).toBe(
      VALID_MNEMONIC,
    );
  });
}
