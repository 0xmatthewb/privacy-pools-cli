import { spinner, stageHeader } from "../utils/format.js";

export const PREVIEW_SCENARIO_ENV = "PRIVACY_POOLS_CLI_PREVIEW_SCENARIO";
export const PREVIEW_SCENARIO_TIMING_ENV = "PRIVACY_POOLS_CLI_PREVIEW_TIMING";
export const PREVIEW_PROGRESS_STEP_ENV = "PRIVACY_POOLS_CLI_PREVIEW_PROGRESS_STEP";
export const PREVIEW_COLUMNS_ENV = "PRIVACY_POOLS_CLI_PREVIEW_COLUMNS";

export type PreviewScenarioTiming = "before-prompts" | "after-prompts";

interface PreviewProgressStage {
  step: number;
  total: number;
  label: string;
}

export interface PreviewProgressSnapshot {
  stage?: PreviewProgressStage;
  spinnerText?: string;
  doneText?: string | null;
  notes?: string[];
  quiet?: boolean;
}

export class PreviewScenarioRenderedError extends Error {
  constructor() {
    super("Preview scenario rendered.");
    this.name = "PreviewScenarioRenderedError";
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function activePreviewScenarioId(): string | null {
  const value = process.env[PREVIEW_SCENARIO_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

function activePreviewScenarioTiming(): PreviewScenarioTiming {
  return process.env[PREVIEW_SCENARIO_TIMING_ENV]?.trim() === "after-prompts"
    ? "after-prompts"
    : "before-prompts";
}

function activePreviewProgressStep(): string | null {
  const value = process.env[PREVIEW_PROGRESS_STEP_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

function activePreviewColumns(): number | null {
  const value = process.env[PREVIEW_COLUMNS_ENV]?.trim();
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function applyColumnsOverride(
  stream: NodeJS.WriteStream,
  columns: number,
): void {
  try {
    Object.defineProperty(stream, "columns", {
      configurable: true,
      enumerable: true,
      get: () => columns,
    });
  } catch {
    try {
      (stream as NodeJS.WriteStream & { columns?: number }).columns = columns;
    } catch {
      // Best effort.
    }
  }
}

export function applyPreviewRuntimeOverrides(): void {
  const columns = activePreviewColumns();
  if (!columns) {
    return;
  }
  applyColumnsOverride(process.stdout, columns);
  applyColumnsOverride(process.stderr, columns);
}

export async function maybeRenderPreviewScenario(
  commandKey: string,
  options: {
    timing?: PreviewScenarioTiming;
  } = {},
): Promise<boolean> {
  applyPreviewRuntimeOverrides();
  const caseId = activePreviewScenarioId();
  if (!caseId) {
    return false;
  }

  const expectedTiming = options.timing ?? "before-prompts";
  if (activePreviewScenarioTiming() !== expectedTiming) {
    return false;
  }

  const previewModuleUrl = new URL(
    "../../scripts/lib/preview-cli-fixtures.mjs",
    import.meta.url,
  ).href;
  const previewModule = await import(previewModuleUrl);
  if (
    typeof previewModule.isPreviewScenarioCaseForCommand === "function"
    && !previewModule.isPreviewScenarioCaseForCommand(commandKey, caseId)
  ) {
    return false;
  }

  if (typeof previewModule.renderPreviewFixture !== "function") {
    throw new Error("Preview fixture runtime is unavailable.");
  }

  await previewModule.renderPreviewFixture(caseId);
  return true;
}

export async function maybeRenderPreviewProgressStep(
  stepId: string,
  snapshot: PreviewProgressSnapshot,
): Promise<boolean> {
  applyPreviewRuntimeOverrides();
  if (activePreviewProgressStep() !== stepId) {
    return false;
  }

  const quiet = snapshot.quiet ?? false;
  if (snapshot.stage) {
    stageHeader(
      snapshot.stage.step,
      snapshot.stage.total,
      snapshot.stage.label,
      quiet,
    );
  }

  if (snapshot.spinnerText) {
    const spin = spinner(snapshot.spinnerText, quiet);
    spin.start();
    await wait(120);
    if (snapshot.doneText) {
      spin.succeed(snapshot.doneText);
    } else {
      spin.stop();
    }
  }

  if (!quiet && snapshot.notes && snapshot.notes.length > 0) {
    for (const note of snapshot.notes) {
      process.stderr.write(`${note}\n`);
    }
  }

  return true;
}
