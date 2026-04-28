import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import { captureAsyncOutput } from "../helpers/output.ts";

const realFormat = await import("../../src/utils/format.ts");
const PREVIEW_FIXTURES_MODULE_URL = new URL(
  "../../scripts/lib/preview-cli-fixtures.mjs",
  import.meta.url,
).href;

type PreviewRuntimeModule = typeof import("../../src/preview/runtime.ts");
type PreviewFixtureMockModule = {
  isPreviewScenarioCaseForCommand?: unknown;
  renderPreviewFixture?: unknown;
};

type SpinnerRecord = {
  text: string;
  quiet: boolean;
  started: boolean;
  succeeded: string | null;
  stopped: boolean;
};

const stageHeaderCalls: Array<[number, number, string, boolean]> = [];
const spinnerCalls: SpinnerRecord[] = [];
let activePreviewFixtureModule: PreviewFixtureMockModule = {};

const originalPreviewEnv = {
  scenario: process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO,
  timing: process.env.PRIVACY_POOLS_CLI_PREVIEW_TIMING,
  step: process.env.PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP,
  columns: process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS,
};
const originalStdoutColumns = process.stdout.columns;
const originalStderrColumns = process.stderr.columns;

function restorePreviewEnv(): void {
  if (originalPreviewEnv.scenario === undefined) {
    delete process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO;
  } else {
    process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO = originalPreviewEnv.scenario;
  }

  if (originalPreviewEnv.timing === undefined) {
    delete process.env.PRIVACY_POOLS_CLI_PREVIEW_TIMING;
  } else {
    process.env.PRIVACY_POOLS_CLI_PREVIEW_TIMING = originalPreviewEnv.timing;
  }

  if (originalPreviewEnv.step === undefined) {
    delete process.env.PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP;
  } else {
    process.env.PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP = originalPreviewEnv.step;
  }

  if (originalPreviewEnv.columns === undefined) {
    delete process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS;
  } else {
    process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS = originalPreviewEnv.columns;
  }
}

function restoreColumns(): void {
  Object.defineProperty(process.stdout, "columns", {
    configurable: true,
    enumerable: true,
    value: originalStdoutColumns,
    writable: true,
  });
  Object.defineProperty(process.stderr, "columns", {
    configurable: true,
    enumerable: true,
    value: originalStderrColumns,
    writable: true,
  });
}

function stageHeaderMock(
  step: number,
  total: number,
  label: string,
  quiet: boolean = false,
): void {
  stageHeaderCalls.push([step, total, label, quiet]);
}

function spinnerMock(text: string, quiet: boolean = false) {
  const record: SpinnerRecord = {
    text,
    quiet,
    started: false,
    succeeded: null,
    stopped: false,
  };
  spinnerCalls.push(record);

  return {
    start() {
      record.started = true;
    },
    succeed(message: string) {
      record.succeeded = message;
    },
    stop() {
      record.stopped = true;
    },
  };
}

async function loadPreviewRuntime(
  previewModule: PreviewFixtureMockModule = {
    isPreviewScenarioCaseForCommand: () => true,
    renderPreviewFixture: async () => undefined,
  },
): Promise<PreviewRuntimeModule> {
  mock.restore();
  activePreviewFixtureModule = previewModule;
  mock.module("../../src/utils/format.ts", () => ({
    ...realFormat,
    stageHeader: stageHeaderMock,
    spinner: spinnerMock,
  }));
  mock.module(PREVIEW_FIXTURES_MODULE_URL, () => ({
    isPreviewScenarioCaseForCommand(commandKey: string, caseId: string) {
      const matcher =
        activePreviewFixtureModule.isPreviewScenarioCaseForCommand;
      return typeof matcher === "function"
        ? matcher(commandKey, caseId)
        : true;
    },
    async renderPreviewFixture(caseId: string) {
      const renderer = activePreviewFixtureModule.renderPreviewFixture;
      if (typeof renderer !== "function") {
        throw new Error("Preview fixture runtime is unavailable.");
      }
      return renderer(caseId);
    },
  }));

  return import(
    `../../src/preview/runtime.ts?preview-runtime-unit-${Date.now()}-${Math.random()}`
  ) as Promise<PreviewRuntimeModule>;
}

afterEach(() => {
  restorePreviewEnv();
  restoreColumns();
  stageHeaderCalls.length = 0;
  spinnerCalls.length = 0;
  activePreviewFixtureModule = {};
  jest.useRealTimers();
  mock.restore();
});

describe("preview runtime", () => {
  test("applyPreviewRuntimeOverrides ignores invalid columns and applies positive integers", async () => {
    const runtime = await loadPreviewRuntime();

    process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS = "wide";
    runtime.applyPreviewRuntimeOverrides();
    expect(process.stdout.columns).toBe(originalStdoutColumns);
    expect(process.stderr.columns).toBe(originalStderrColumns);

    process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS = "0";
    runtime.applyPreviewRuntimeOverrides();
    expect(process.stdout.columns).toBe(originalStdoutColumns);
    expect(process.stderr.columns).toBe(originalStderrColumns);

    process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS = "72";
    runtime.applyPreviewRuntimeOverrides();
    expect(process.stdout.columns).toBe(72);
    expect(process.stderr.columns).toBe(72);
  });

  test("maybeRenderPreviewScenario returns false when no preview scenario is active", async () => {
    const renderPreviewFixture = mock(async () => undefined);
    const runtime = await loadPreviewRuntime({
      renderPreviewFixture,
    });

    await expect(runtime.maybeRenderPreviewScenario("withdraw")).resolves.toBe(
      false,
    );
    expect(renderPreviewFixture).not.toHaveBeenCalled();
  });

  test("maybeRenderPreviewScenario respects the requested timing gate", async () => {
    const renderPreviewFixture = mock(async () => undefined);
    const runtime = await loadPreviewRuntime({
      renderPreviewFixture,
    });

    process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO = "withdraw";
    process.env.PRIVACY_POOLS_CLI_PREVIEW_TIMING = "after-prompts";

    await expect(
      runtime.maybeRenderPreviewScenario("withdraw", {
        timing: "before-prompts",
      }),
    ).resolves.toBe(false);
    expect(renderPreviewFixture).not.toHaveBeenCalled();
  });

  test("maybeRenderPreviewScenario skips cases that do not belong to the command", async () => {
    const isPreviewScenarioCaseForCommand = mock(() => false);
    const renderPreviewFixture = mock(async () => undefined);
    const runtime = await loadPreviewRuntime({
      isPreviewScenarioCaseForCommand,
      renderPreviewFixture,
    });

    process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO = "withdraw-case";

    await expect(runtime.maybeRenderPreviewScenario("withdraw")).resolves.toBe(
      false,
    );
    expect(isPreviewScenarioCaseForCommand).toHaveBeenCalledWith(
      "withdraw",
      "withdraw-case",
    );
    expect(renderPreviewFixture).not.toHaveBeenCalled();
  });

  test("maybeRenderPreviewScenario renders the matched preview fixture", async () => {
    const renderPreviewFixture = mock(async (_caseId: string) => undefined);
    const runtime = await loadPreviewRuntime({
      isPreviewScenarioCaseForCommand: () => true,
      renderPreviewFixture,
    });

    process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO = "withdraw-case";

    await expect(runtime.maybeRenderPreviewScenario("withdraw")).resolves.toBe(
      true,
    );
    expect(renderPreviewFixture).toHaveBeenCalledWith("withdraw-case");
  });

  test("maybeRenderPreviewScenario renders after prompts when requested", async () => {
    const renderPreviewFixture = mock(async (_caseId: string) => undefined);
    const runtime = await loadPreviewRuntime({
      isPreviewScenarioCaseForCommand: () => true,
      renderPreviewFixture,
    });

    process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO = "withdraw-case";
    process.env.PRIVACY_POOLS_CLI_PREVIEW_TIMING = "after-prompts";

    await expect(
      runtime.maybeRenderPreviewScenario("withdraw", {
        timing: "after-prompts",
      }),
    ).resolves.toBe(true);
    expect(renderPreviewFixture).toHaveBeenCalledWith("withdraw-case");
  });

  test("maybeRenderPreviewScenario renders without a command matcher helper", async () => {
    const renderPreviewFixture = mock(async (_caseId: string) => undefined);
    const runtime = await loadPreviewRuntime({
      renderPreviewFixture,
    });

    process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO = "status-ready";

    await expect(runtime.maybeRenderPreviewScenario("status")).resolves.toBe(
      true,
    );
    expect(renderPreviewFixture).toHaveBeenCalledWith("status-ready");
  });

  test("maybeRenderPreviewScenario fails cleanly when the fixture renderer is unavailable", async () => {
    const runtime = await loadPreviewRuntime({
      isPreviewScenarioCaseForCommand: () => true,
      renderPreviewFixture: null,
    });

    process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO = "withdraw-case";

    await expect(runtime.maybeRenderPreviewScenario("withdraw")).rejects.toThrow(
      "Preview fixture runtime is unavailable.",
    );
  });

  test("maybeRenderPreviewScenario surfaces preview render failures", async () => {
    const runtime = await loadPreviewRuntime({
      isPreviewScenarioCaseForCommand: () => true,
      renderPreviewFixture: async () => {
        throw new Error("preview fixture failed");
      },
    });

    process.env.PRIVACY_POOLS_CLI_PREVIEW_SCENARIO = "withdraw-case";

    await expect(runtime.maybeRenderPreviewScenario("withdraw")).rejects.toThrow(
      "preview fixture failed",
    );
  });

  test("maybeRenderPreviewProgressStep returns false when the step id does not match", async () => {
    const runtime = await loadPreviewRuntime();

    process.env.PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP = "withdraw.submit";

    await expect(
      runtime.maybeRenderPreviewProgressStep("withdraw.generate-proof", {
        spinnerText: "Generating proof",
      }),
    ).resolves.toBe(false);
    expect(stageHeaderCalls).toEqual([]);
    expect(spinnerCalls).toEqual([]);
  });

  test("maybeRenderPreviewProgressStep renders stage headers, spinners, and notes", async () => {
    jest.useFakeTimers();
    const runtime = await loadPreviewRuntime();

    process.env.PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP =
      "withdraw.generate-proof";

    const captured = await captureAsyncOutput(async () => {
      const promise = runtime.maybeRenderPreviewProgressStep(
        "withdraw.generate-proof",
        {
          stage: {
            step: 3,
            total: 5,
            label: "Generate and verify proof",
          },
          spinnerText: "Generating proof",
          doneText: "Proof ready",
          notes: ["Proof verified locally before submission."],
        },
      );

      await Promise.resolve();
      jest.advanceTimersByTime(120);
      await expect(promise).resolves.toBe(true);
    });

    expect(stageHeaderCalls).toEqual([
      [3, 5, "Generate and verify proof", false],
    ]);
    expect(spinnerCalls).toEqual([
      {
        text: "Generating proof",
        quiet: false,
        started: true,
        succeeded: "Proof ready",
        stopped: false,
      },
    ]);
    expect(captured.stdout).toBe("");
    expect(captured.stderr).toContain(
      "Proof verified locally before submission.",
    );
  });

  test("maybeRenderPreviewProgressStep stops quietly when there is no done text", async () => {
    jest.useFakeTimers();
    const runtime = await loadPreviewRuntime();

    process.env.PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP = "status.health-check";

    const captured = await captureAsyncOutput(async () => {
      const promise = runtime.maybeRenderPreviewProgressStep(
        "status.health-check",
        {
          spinnerText: "Checking health",
          notes: ["This note stays hidden in quiet mode."],
          quiet: true,
        },
      );

      await Promise.resolve();
      jest.advanceTimersByTime(120);
      await expect(promise).resolves.toBe(true);
    });

    expect(stageHeaderCalls).toEqual([]);
    expect(spinnerCalls).toEqual([
      {
        text: "Checking health",
        quiet: true,
        started: true,
        succeeded: null,
        stopped: true,
      },
    ]);
    expect(captured).toEqual({ stdout: "", stderr: "" });
  });

  test("PreviewScenarioRenderedError uses the expected name and message", async () => {
    const runtime = await loadPreviewRuntime();
    const error = new runtime.PreviewScenarioRenderedError();

    expect(error.name).toBe("PreviewScenarioRenderedError");
    expect(error.message).toBe("Preview scenario rendered.");
  });
});
