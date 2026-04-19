import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { Command } from "commander";
import {
  captureAsyncJsonOutput,
  captureAsyncOutput,
} from "../helpers/output.ts";
import { restoreTestTty, setTestTty } from "../helpers/tty.ts";
import {
  captureModuleExports,
  restoreModuleImplementations,
} from "../helpers/module-mocks.ts";

const realPackageInfo = captureModuleExports(
  await import("../../src/package-info.ts"),
);
const realUpgradeService = captureModuleExports(
  await import("../../src/services/upgrade.ts"),
);
const realUpgradeOutput = captureModuleExports(
  await import("../../src/output/upgrade.ts"),
);
const realInquirerPrompts = captureModuleExports(
  await import("@inquirer/prompts"),
);
const realErrors = captureModuleExports(await import("../../src/utils/errors.ts"));
const realFormat = captureModuleExports(await import("../../src/utils/format.ts"));
const realProofProgress = captureModuleExports(
  await import("../../src/utils/proof-progress.ts"),
);

const UPGRADE_COMMAND_RESTORES = [
  ["../../src/package-info.ts", realPackageInfo],
  ["../../src/services/upgrade.ts", realUpgradeService],
  ["../../src/output/upgrade.ts", realUpgradeOutput],
  ["@inquirer/prompts", realInquirerPrompts],
  ["../../src/utils/errors.ts", realErrors],
  ["../../src/utils/format.ts", realFormat],
  ["../../src/utils/proof-progress.ts", realProofProgress],
] as const;

const readCliPackageInfoMock = mock(() => ({
  version: "2.0.0",
  packageRoot: "/tmp/privacy-pools-cli",
  packageJsonPath: "/tmp/privacy-pools-cli/package.json",
}));
const inspectUpgradeMock = mock(async () => ({
  mode: "upgrade" as const,
  status: "ready" as const,
  currentVersion: "2.0.0",
  latestVersion: "2.2.0",
  updateAvailable: true,
  performed: false,
  command: "npm install -g privacy-pools-cli@2.2.0",
  installContext: {
    kind: "global_npm" as const,
    supportedAutoRun: true,
    reason: "This CLI was detected as a global npm install.",
  },
  installedVersion: null,
}));
const performUpgradeMock = mock(async (result) => ({
  ...result,
  status: "upgraded" as const,
  performed: true,
  installedVersion: result.latestVersion,
}));
const markUpgradeCancelledMock = mock((result) => ({
  ...result,
  status: "cancelled" as const,
  performed: false,
}));
const renderUpgradeResultMock = mock(() => undefined);
const confirmPromptMock = mock(async () => true);
const printErrorMock = mock(() => undefined);

let handleUpgradeCommand: typeof import("../../src/commands/upgrade.ts").handleUpgradeCommand;

function fakeCommand(globalOpts: Record<string, unknown> = {}): Command {
  return {
    parent: {
      opts: () => globalOpts,
    },
  } as unknown as Command;
}

async function loadUpgradeCommand(): Promise<void> {
  mock.module("../../src/package-info.ts", () => ({
    ...realPackageInfo,
    readCliPackageInfo: readCliPackageInfoMock,
  }));
  mock.module("../../src/services/upgrade.ts", () => ({
    ...realUpgradeService,
    inspectUpgrade: inspectUpgradeMock,
    performUpgrade: performUpgradeMock,
    markUpgradeCancelled: markUpgradeCancelledMock,
  }));
  mock.module("../../src/output/upgrade.ts", () => ({
    ...realUpgradeOutput,
    renderUpgradeResult: renderUpgradeResultMock,
  }));
  mock.module("@inquirer/prompts", () => ({
    ...realInquirerPrompts,
    confirm: confirmPromptMock,
  }));
  mock.module("../../src/utils/errors.ts", () => ({
    ...realErrors,
    printError: printErrorMock,
  }));

  ({ handleUpgradeCommand } = await import(
    "../../src/commands/upgrade.ts"
  ));
}

beforeEach(async () => {
  mock.restore();
  readCliPackageInfoMock.mockClear();
  inspectUpgradeMock.mockClear();
  performUpgradeMock.mockClear();
  markUpgradeCancelledMock.mockClear();
  renderUpgradeResultMock.mockClear();
  confirmPromptMock.mockClear();
  printErrorMock.mockClear();
  inspectUpgradeMock.mockImplementation(async () => ({
    mode: "upgrade" as const,
    status: "ready" as const,
    currentVersion: "2.0.0",
    latestVersion: "2.2.0",
    updateAvailable: true,
    performed: false,
    command: "npm install -g privacy-pools-cli@2.2.0",
    installContext: {
      kind: "global_npm" as const,
      supportedAutoRun: true,
      reason: "This CLI was detected as a global npm install.",
    },
    installedVersion: null,
  }));
  performUpgradeMock.mockImplementation(async (result) => ({
    ...result,
    status: "upgraded" as const,
    performed: true,
    installedVersion: result.latestVersion,
  }));
  markUpgradeCancelledMock.mockImplementation((result) => ({
    ...result,
    status: "cancelled" as const,
    performed: false,
  }));
  confirmPromptMock.mockImplementation(async () => true);
  setTestTty();
  await loadUpgradeCommand();
});

afterEach(() => {
  restoreModuleImplementations(UPGRADE_COMMAND_RESTORES);
  restoreTestTty();
});

describe("upgrade command handler", () => {
  test("keeps machine mode check-only unless --yes is explicit", async () => {
    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({ json: true })),
    );

    expect(inspectUpgradeMock).toHaveBeenCalledTimes(1);
    expect(performUpgradeMock).not.toHaveBeenCalled();
    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(renderUpgradeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "ready",
        performed: false,
      }),
    );
  });

  test("honors --check even when --yes is present", async () => {
    await captureAsyncOutput(() =>
      handleUpgradeCommand({ check: true }, fakeCommand({ yes: true })),
    );

    expect(inspectUpgradeMock).toHaveBeenCalledTimes(1);
    expect(performUpgradeMock).not.toHaveBeenCalled();
    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(renderUpgradeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "ready",
        performed: false,
      }),
    );
  });

  test("auto-runs immediately when --yes is provided in a supported context", async () => {
    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({ yes: true })),
    );

    expect(performUpgradeMock).toHaveBeenCalledTimes(1);
    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(renderUpgradeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "upgraded",
        performed: true,
      }),
    );
  });

  test("shows progress while inspecting and auto-installing in human mode", async () => {
    const spinnerInstances: Array<{
      start: ReturnType<typeof mock>;
      stop: ReturnType<typeof mock>;
      text: string;
    }> = [];
    const spinnerMock = mock(() => {
      const instance = {
        start: mock(() => undefined),
        stop: mock(() => undefined),
        text: "",
      };
      spinnerInstances.push(instance);
      return instance;
    });
    const withSpinnerProgressMock = mock(
      async (_spin: unknown, _label: string, fn: () => Promise<unknown>) =>
        await fn(),
    );

    mock.module("../../src/utils/format.ts", () => ({
      ...realFormat,
      spinner: spinnerMock,
    }));
    mock.module("../../src/utils/proof-progress.ts", () => ({
      ...realProofProgress,
      withSpinnerProgress: withSpinnerProgressMock,
    }));

    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({ yes: true })),
    );

    expect(spinnerMock).toHaveBeenCalledTimes(2);
    expect(spinnerMock.mock.calls[0]?.[0]).toBe("Checking for upgrades...");
    expect(spinnerMock.mock.calls[1]?.[0]).toBe("Installing update...");
    expect(withSpinnerProgressMock).toHaveBeenCalledWith(
      spinnerInstances[0],
      "Checking for upgrades",
      expect.any(Function),
    );
    expect(spinnerInstances[0]?.start).toHaveBeenCalledTimes(1);
    expect(spinnerInstances[0]?.stop).toHaveBeenCalledTimes(1);
    expect(spinnerInstances[1]?.start).toHaveBeenCalledTimes(1);
    expect(spinnerInstances[1]?.stop).toHaveBeenCalledTimes(1);
  });

  test("suppresses upgrade progress spinners in json mode", async () => {
    const spinnerMock = mock(() => ({
      start: mock(() => undefined),
      stop: mock(() => undefined),
      text: "",
    }));
    const withSpinnerProgressMock = mock(
      async (_spin: unknown, _label: string, fn: () => Promise<unknown>) =>
        await fn(),
    );

    mock.module("../../src/utils/format.ts", () => ({
      ...realFormat,
      spinner: spinnerMock,
    }));
    mock.module("../../src/utils/proof-progress.ts", () => ({
      ...realProofProgress,
      withSpinnerProgress: withSpinnerProgressMock,
    }));

    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({ json: true, yes: true })),
    );

    expect(spinnerMock).not.toHaveBeenCalled();
    expect(withSpinnerProgressMock).not.toHaveBeenCalled();
  });

  test("prompts interactive humans before upgrading", async () => {
    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({})),
    );

    expect(confirmPromptMock).toHaveBeenCalledTimes(1);
    expect(performUpgradeMock).toHaveBeenCalledTimes(1);
  });

  test("renders a cancelled result when the human declines the prompt", async () => {
    confirmPromptMock.mockImplementationOnce(async () => false);

    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({})),
    );

    expect(markUpgradeCancelledMock).toHaveBeenCalledTimes(1);
    expect(performUpgradeMock).not.toHaveBeenCalled();
    expect(renderUpgradeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "cancelled",
        performed: false,
      }),
    );
  });

  test("stays check-only when interactive prompts are unavailable", async () => {
    setTestTty({ stdin: false, stdout: true, stderr: true });

    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({})),
    );

    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(performUpgradeMock).not.toHaveBeenCalled();
    expect(renderUpgradeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "ready",
        performed: false,
      }),
    );
  });

  test("stays check-only when stderr is not a TTY", async () => {
    setTestTty({ stdin: true, stdout: true, stderr: false });

    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({})),
    );

    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(performUpgradeMock).not.toHaveBeenCalled();
    expect(renderUpgradeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "ready",
        performed: false,
      }),
    );
  });

  test("renders manual upgrade guidance without prompting for unsupported contexts", async () => {
    inspectUpgradeMock.mockImplementationOnce(async () => ({
      mode: "upgrade" as const,
      status: "manual" as const,
      currentVersion: "2.0.0",
      latestVersion: "2.2.0",
      updateAvailable: true,
      performed: false,
      command: "npm install privacy-pools-cli@2.2.0",
      installContext: {
        kind: "local_project" as const,
        supportedAutoRun: false,
        reason: "This CLI appears to be installed inside a local project.",
      },
      installedVersion: null,
    }));

    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({ yes: true })),
    );

    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(performUpgradeMock).not.toHaveBeenCalled();
    expect(renderUpgradeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "manual",
        installContext: expect.objectContaining({
          supportedAutoRun: false,
        }),
      }),
    );
  });

  test("stays check-only when the installed version is already current", async () => {
    inspectUpgradeMock.mockImplementationOnce(async () => ({
      mode: "upgrade" as const,
      status: "current" as const,
      currentVersion: "2.0.0",
      latestVersion: "2.0.0",
      updateAvailable: false,
      performed: false,
      command: null,
      installContext: {
        kind: "global_npm" as const,
        supportedAutoRun: true,
        reason: "This CLI was detected as a global npm install.",
      },
      installedVersion: "2.0.0",
    }));

    await captureAsyncOutput(() =>
      handleUpgradeCommand({}, fakeCommand({ yes: true })),
    );

    expect(confirmPromptMock).not.toHaveBeenCalled();
    expect(performUpgradeMock).not.toHaveBeenCalled();
    expect(renderUpgradeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "current",
        updateAvailable: false,
        performed: false,
      }),
    );
  });

  test("routes command failures through printError", async () => {
    inspectUpgradeMock.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const { json } = await captureAsyncJsonOutput(() =>
      handleUpgradeCommand({}, fakeCommand({ json: true })),
    );

    expect(printErrorMock).not.toHaveBeenCalled();
    expect(json.success).toBe(true);
    expect(json.status).toBe("manual");
    expect(json.warnings).toEqual([
      expect.objectContaining({
        code: "UPGRADE_CHECK_FAILED",
        message: "boom",
      }),
    ]);
  });
});
