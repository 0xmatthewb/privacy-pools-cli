const SUITE_RUNTIME_BUDGETS = Object.freeze({
  "packed-smoke": 120_000,
  "native-machine-contract-parity": 90_000,
  "native-routing-smoke": 90_000,
  "native-human-output-smoke": 90_000,
  "native-package-smoke": 180_000,
  "workflow-mocked": 180_000,
  "workflow-internal": 180_000,
  "workflow-service": 180_000,
});

const PROFILE_STEP_RUNTIME_BUDGETS = Object.freeze({
  "npm run test:install": 900_000,
  "npm run test:coverage": 480_000,
  "npm run test:coverage:native": 300_000,
  "npm run test:smoke:native:shell": 300_000,
  "npm run test:e2e:anvil:smoke": 180_000,
  "npm run test:e2e:anvil": 600_000,
});

export function getSuiteRuntimeBudget(label) {
  return SUITE_RUNTIME_BUDGETS[label] ?? null;
}

export function getProfileStepRuntimeBudget(command, args) {
  return PROFILE_STEP_RUNTIME_BUDGETS[`${command} ${args.join(" ")}`] ?? null;
}

export function formatRuntimeDuration(durationMs) {
  return `${(durationMs / 1_000).toFixed(durationMs >= 10_000 ? 1 : 2)}s`;
}

export function formatRuntimeBudget(budgetMs) {
  return budgetMs === null || budgetMs === undefined
    ? "n/a"
    : formatRuntimeDuration(budgetMs);
}

export function reportRuntimeSummary(
  heading,
  results,
  stream = process.stdout,
  slowCount = 5,
) {
  if (!Array.isArray(results) || results.length === 0) {
    return;
  }

  const sorted = [...results].sort((left, right) =>
    right.durationMs - left.durationMs
  );

  stream.write(`\n[perf] ${heading}\n`);
  for (const result of sorted.slice(0, slowCount)) {
    const budgetLabel = result.budgetMs
      ? ` (budget ${formatRuntimeBudget(result.budgetMs)})`
      : "";
    const statusLabel = result.budgetExceeded ? " over budget" : "";
    stream.write(
      `[perf] ${result.label}: ${formatRuntimeDuration(result.durationMs)}${budgetLabel}${statusLabel}\n`,
    );
  }
}

export function collectRuntimeBudgetFailures(results) {
  return results.filter((result) => result.budgetExceeded);
}
