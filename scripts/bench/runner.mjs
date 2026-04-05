import { spawnSync } from "node:child_process";

function hrtimeMs(start) {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function runBench(command, prefixArgs, cwd, args, env, warmupRuns, timedRuns) {
  const timings = [];
  const fullArgs = [...prefixArgs, ...args];

  for (let i = 0; i < warmupRuns; i += 1) {
    const warmup = spawnSync(command, fullArgs, {
      cwd,
      env,
      encoding: "utf8",
      stdio: "pipe",
    });
    if (warmup.error) {
      throw warmup.error;
    }
    if (warmup.status !== 0) {
      throw new Error(
        `Benchmark command failed: ${fullArgs.join(" ")}\n${warmup.stderr?.trim() || warmup.stdout?.trim() || ""}`,
      );
    }
  }

  for (let i = 0; i < timedRuns; i += 1) {
    const start = process.hrtime.bigint();
    const result = spawnSync(command, fullArgs, {
      cwd,
      env,
      encoding: "utf8",
      stdio: "pipe",
    });
    const elapsedMs = hrtimeMs(start);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `Benchmark command failed: ${fullArgs.join(" ")}\n${result.stderr?.trim() || result.stdout?.trim() || ""}`,
      );
    }
    timings.push(elapsedMs);
  }

  return {
    mean: mean(timings),
    median: median(timings),
    min: Math.min(...timings),
    max: Math.max(...timings),
  };
}
