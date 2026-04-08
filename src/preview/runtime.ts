export const PREVIEW_SCENARIO_ENV = "PRIVACY_POOLS_CLI_PREVIEW_SCENARIO";

function activePreviewScenarioId(): string | null {
  const value = process.env[PREVIEW_SCENARIO_ENV]?.trim();
  return value && value.length > 0 ? value : null;
}

export async function maybeRenderPreviewScenario(
  commandKey: string,
): Promise<boolean> {
  const caseId = activePreviewScenarioId();
  if (!caseId) {
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
