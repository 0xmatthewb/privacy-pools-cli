import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./constants.mjs";

export function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

export function loadThresholds(thresholdsPath) {
  if (!thresholdsPath) return null;
  return JSON.parse(readFileSync(join(repoRoot, thresholdsPath), "utf8"));
}

export function printHeader(options) {
  process.stdout.write(
    [
      "CLI benchmark comparison",
      `base ref: ${options.baseRef}`,
      `matrix: ${options.matrix}`,
      `runs: ${options.runs}`,
      `warmup: ${options.warmup}`,
      "base runtime: js",
      `current runtime: ${options.runtime}`,
      "",
      [
        "runtime",
        "family",
        "command",
        "base median",
        "current median",
        "delta",
        "delta %",
      ].join("\t"),
    ].join("\n") + "\n",
  );
}

export function printFamilyHeader(label) {
  process.stdout.write(`# ${label}\n`);
}

export function printRow({
  runtime,
  familyLabel,
  label,
  baseMedian,
  currentMedian,
}) {
  const delta = currentMedian - baseMedian;
  const deltaPct = (delta / baseMedian) * 100;

  process.stdout.write(
    [
      runtime,
      familyLabel,
      label,
      formatMs(baseMedian),
      formatMs(currentMedian),
      `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} ms`,
      `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`,
    ].join("\t") + "\n",
  );
}

export function evaluateThresholds({
  thresholdFailures,
  thresholds,
  runtime,
  label,
  currentMedian,
  baseMedian,
}) {
  const threshold = thresholds?.[runtime]?.[label];
  if (!threshold) return;

  const improvementPct = ((baseMedian - currentMedian) / baseMedian) * 100;
  if (threshold.maxMedianMs !== undefined && currentMedian > threshold.maxMedianMs) {
    thresholdFailures.push(
      `${runtime} ${label}: median ${formatMs(currentMedian)} exceeded ${formatMs(threshold.maxMedianMs)}`,
    );
  }
  if (
    threshold.minImprovementPct !== undefined &&
    improvementPct < threshold.minImprovementPct
  ) {
    thresholdFailures.push(
      `${runtime} ${label}: improvement ${improvementPct.toFixed(1)}% was below ${threshold.minImprovementPct.toFixed(1)}%`,
    );
  }
}

export function assertNoThresholdFailures(thresholdFailures) {
  if (thresholdFailures.length === 0) {
    return;
  }
  process.stderr.write(
    ["Benchmark gate failed:", ...thresholdFailures].join("\n") + "\n",
  );
  process.exit(1);
}
