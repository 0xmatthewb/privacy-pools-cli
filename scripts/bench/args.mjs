import {
  DEFAULT_BASE_REF,
  DEFAULT_MATRIX,
  DEFAULT_RUNS,
  DEFAULT_RUNTIME,
  DEFAULT_WARMUP,
  LAUNCHER_BINARY_OVERRIDE_RUNTIME,
  LEGACY_LAUNCHER_NATIVE_RUNTIME,
  SUPPORTED_MATRICES,
  SUPPORTED_RUNTIMES,
} from "./constants.mjs";

export function printUsageAndExit(exitCode = 0) {
  process.stdout.write(
    [
      "Usage: node scripts/bench-cli.mjs [--base <ref>] [--matrix <default|readonly>] [--runs <n>] [--warmup <n>] [--runtime <js|native|launcher-binary-override|both|all>]",
      "",
      "Compares the current checkout against a git ref by building both and timing",
      "a small read-only command matrix.",
      "Base timings always use the JS fallback path so native preview branches",
      "can be measured directly against the current npm baseline. The native",
      "lane executes the Rust shell directly to reflect the roadmap's shell",
      "performance targets without Node launcher startup overhead. The",
      "launcher-binary-override lane disables local JS fast paths and forces",
      "the current checkout launcher to hand off through the normal runtime",
      "planner so launcher overhead remains visible in the report.",
      `Use ${LEGACY_LAUNCHER_NATIVE_RUNTIME} as a backward-compatible alias.`,
      "",
      "Options:",
      `  --base <ref>    Git ref to compare against, or 'self' to compare the selected runtime against the current JS fallback (default: ${DEFAULT_BASE_REF})`,
      `  --matrix <m>    Benchmark matrix: ${SUPPORTED_MATRICES.join(", ")} (default: ${DEFAULT_MATRIX})`,
      `  --runs <n>      Timed runs per command (default: ${DEFAULT_RUNS})`,
      `  --warmup <n>    Warmup runs before timing (default: ${DEFAULT_WARMUP})`,
      `  --runtime <m>   Current checkout runtime: js, native, ${LAUNCHER_BINARY_OVERRIDE_RUNTIME}, both, or all (default: ${DEFAULT_RUNTIME})`,
      "  --assert-thresholds <path>  Fail if benchmark thresholds are missed",
      "  --help          Show this message",
      "",
      "Examples:",
      "  node scripts/bench-cli.mjs",
      "  node scripts/bench-cli.mjs --base origin/main --runs 12",
      "  node scripts/bench-cli.mjs --base self --runtime native",
      "  node scripts/bench-cli.mjs --matrix readonly --runtime launcher-binary-override --runs 6",
      "  node scripts/bench-cli.mjs --runtime all --runs 6",
    ].join("\n") + "\n",
  );
  process.exit(exitCode);
}

export function normalizeRuntime(value) {
  return value === LEGACY_LAUNCHER_NATIVE_RUNTIME
    ? LAUNCHER_BINARY_OVERRIDE_RUNTIME
    : value;
}

function parseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const options = {
    baseRef: DEFAULT_BASE_REF,
    matrix: DEFAULT_MATRIX,
    runs: DEFAULT_RUNS,
    warmup: DEFAULT_WARMUP,
    runtime: DEFAULT_RUNTIME,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      printUsageAndExit(0);
    }
    if (token === "--base") {
      const value = argv[i + 1];
      if (!value) throw new Error("--base requires a git ref");
      options.baseRef = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--base=")) {
      options.baseRef = token.slice("--base=".length);
      continue;
    }
    if (token === "--matrix") {
      const value = argv[i + 1];
      if (!value) throw new Error("--matrix requires a value");
      options.matrix = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--matrix=")) {
      options.matrix = token.slice("--matrix=".length);
      continue;
    }
    if (token === "--runs") {
      const value = argv[i + 1];
      if (!value) throw new Error("--runs requires a value");
      options.runs = parseInteger(value, "--runs");
      i += 1;
      continue;
    }
    if (token.startsWith("--runs=")) {
      options.runs = parseInteger(token.slice("--runs=".length), "--runs");
      continue;
    }
    if (token === "--warmup") {
      const value = argv[i + 1];
      if (!value) throw new Error("--warmup requires a value");
      options.warmup = parseInteger(value, "--warmup");
      i += 1;
      continue;
    }
    if (token.startsWith("--warmup=")) {
      options.warmup = parseInteger(token.slice("--warmup=".length), "--warmup");
      continue;
    }
    if (token === "--runtime") {
      const value = argv[i + 1];
      if (!value) throw new Error("--runtime requires a value");
      options.runtime = normalizeRuntime(value);
      i += 1;
      continue;
    }
    if (token.startsWith("--runtime=")) {
      options.runtime = normalizeRuntime(token.slice("--runtime=".length));
      continue;
    }
    if (token === "--assert-thresholds") {
      const value = argv[i + 1];
      if (!value) throw new Error("--assert-thresholds requires a value");
      options.assertThresholdsPath = value;
      i += 1;
      continue;
    }
    if (token.startsWith("--assert-thresholds=")) {
      options.assertThresholdsPath = token.slice("--assert-thresholds=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!SUPPORTED_MATRICES.includes(options.matrix)) {
    throw new Error(`--matrix must be one of: ${SUPPORTED_MATRICES.join(", ")}`);
  }
  if (!SUPPORTED_RUNTIMES.includes(options.runtime)) {
    throw new Error(
      `--runtime must be one of: ${SUPPORTED_RUNTIMES.join(", ")}`,
    );
  }

  return options;
}
