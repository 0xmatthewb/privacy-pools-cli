import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTestRunnerEnv } from "./test-runner-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
export const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
export const DEFAULT_PROFILE_STEP_TIMEOUT_MS = 1_800_000;

export const TEST_PROFILE_FRAGMENTS = {
  install: [["node", ["scripts/run-install-profile.mjs"]]],
  build: [["npm", ["run", "build"]]],
  "docs-reference-check": [["npm", ["run", "docs:check"]]],
  "repo-conformance-core": [
    ["npm", ["run", "test:scripts"]],
    ["node", ["scripts/run-conformance-suite.mjs", "core"]],
  ],
  "repo-conformance-live": [
    ["npm", ["run", "test:scripts"]],
    ["node", ["scripts/run-conformance-suite.mjs", "all"]],
  ],
  "native-core": [
    ["npm", ["run", "test:native:fmt"]],
    ["npm", ["run", "test:native:lint"]],
    ["npm", ["run", "test:native"]],
  ],
  "native-coverage": [["npm", ["run", "test:coverage:native"]]],
  "native-shell-parity": [["npm", ["run", "test:smoke:native:shell"]]],
  coverage: [["npm", ["run", "test:coverage"]]],
  "anvil-smoke": [["npm", ["run", "test:e2e:anvil:smoke"]]],
  "anvil-installed-smoke": [[
    "node",
    ["scripts/run-anvil-smoke.mjs", "--installed-only"],
  ]],
  "anvil-full": [["npm", ["run", "test:e2e:anvil"]]],
  evals: [["npm", ["run", "test:evals"]]],
  "release-bench": [["npm", ["run", "bench:gate:release"]]],
};

function composeProfile(...fragmentNames) {
  return fragmentNames.flatMap((name) => TEST_PROFILE_FRAGMENTS[name] ?? []);
}

const RELEASE_GRADE_PROFILE = [
    ["npm", ["test"]],
    ["npm", ["run", "test:install"]],
    ...composeProfile(
      "native-core",
      "native-coverage",
      "coverage",
      "anvil-full",
      "anvil-installed-smoke",
    "evals",
    "native-shell-parity",
  ),
  ...composeProfile(
    "docs-reference-check",
    "repo-conformance-core",
    "release-bench",
  ),
];

export const TEST_PROFILES = {
  install: composeProfile("install"),
  conformance: composeProfile("build", "repo-conformance-core"),
  "conformance-all": composeProfile("build", "repo-conformance-live"),
  ci: [
    ["npm", ["test"]],
    ["npm", ["run", "test:install"]],
    ...composeProfile(
      "native-core",
      "native-coverage",
      "coverage",
      "anvil-smoke",
      "evals",
      "native-shell-parity",
    ),
    ...composeProfile("docs-reference-check", "repo-conformance-core"),
  ],
  release: RELEASE_GRADE_PROFILE,
  all: RELEASE_GRADE_PROFILE,
};

export function resolveProfile(name) {
  return TEST_PROFILES[name] ?? null;
}

export function resolveProfileRunEnv(options = {}) {
  return buildTestRunnerEnv(
    options.envOverrides ?? {},
    options.env ?? process.env,
  );
}

export function runProfile(name, options = {}) {
  const profile = resolveProfile(name);
  if (!profile) {
    throw new Error(`Unknown test profile: ${name}`);
  }

  for (const [commandName, args] of profile) {
    const command = commandName === "npm" ? npmCommand : commandName;
    const result = spawnSync(command, args, {
      cwd: options.cwd ?? ROOT,
      stdio: "inherit",
      env: resolveProfileRunEnv(options),
      timeout: options.stepTimeoutMs ?? DEFAULT_PROFILE_STEP_TIMEOUT_MS,
    });

    if (result.error) {
      const timedOut =
        typeof result.error.message === "string"
        && result.error.message.includes("ETIMEDOUT");
      if (timedOut) {
        throw new Error(
          `Profile step timed out after ${options.stepTimeoutMs ?? DEFAULT_PROFILE_STEP_TIMEOUT_MS}ms: ${command} ${args.join(" ")}`,
        );
      }
      throw result.error;
    }

    if (typeof result.status === "number" && result.status !== 0) {
      process.exit(result.status);
    }

    if (result.signal) {
      process.kill(process.pid, result.signal);
    }
  }
}
