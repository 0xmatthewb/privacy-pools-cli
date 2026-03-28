const ANOMALOUS_BUN_EXIT_CODES = new Set([2, 3]);

function hasCleanPassingSummary(output) {
  return (
    /\n\s*\d+\s+pass\b/.test(output) &&
    /\n\s*0\s+fail\b/.test(output) &&
    /Ran \d+ tests? across \d+ files?\./.test(output) &&
    !/\(fail\)/.test(output)
  );
}

export function shouldTreatBunExitAsSuccess(result) {
  if (!ANOMALOUS_BUN_EXIT_CODES.has(result.status ?? -1)) {
    return false;
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  return hasCleanPassingSummary(`${stdout}\n${stderr}`);
}
