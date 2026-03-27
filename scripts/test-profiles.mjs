import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
export const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export const TEST_PROFILE_FRAGMENTS = {
  install: [
    ["npm", ["run", "test:smoke"]],
    ["npm", ["run", "test:smoke:native:package"]],
    ["npm", ["run", "test:artifacts:host"]],
  ],
  build: [["bun", ["run", "build"]]],
  "docs-reference-check": [["node", ["scripts/generate-reference.mjs", "--check"]]],
  "repo-conformance-core": [
    ["npm", ["run", "test:scripts"]],
    ["node", ["scripts/run-conformance-suite.mjs", "core"]],
  ],
  "repo-conformance-all": [
    ["npm", ["run", "test:scripts"]],
    ["node", ["scripts/run-conformance-suite.mjs", "all"]],
  ],
  "native-core": [
    ["npm", ["run", "test:native:fmt"]],
    ["npm", ["run", "test:native:lint"]],
    ["npm", ["run", "test:native"]],
  ],
  coverage: [["npm", ["run", "test:coverage"]]],
  "anvil-smoke": [["npm", ["run", "test:e2e:anvil:smoke"]]],
  "anvil-full": [["npm", ["run", "test:e2e:anvil"]]],
  evals: [["node", ["scripts/run-bun-tests.mjs", "./test/evals", "--timeout", "120000"]]],
  "release-bench": [["npm", ["run", "bench:gate:release"]]],
};

function composeProfile(...fragmentNames) {
  return fragmentNames.flatMap((name) => TEST_PROFILE_FRAGMENTS[name] ?? []);
}

export const TEST_PROFILES = {
  install: composeProfile("install"),
  conformance: composeProfile("build", "repo-conformance-core"),
  "conformance-all": composeProfile("build", "repo-conformance-all"),
  ci: [
    ["npm", ["test"]],
    ["npm", ["run", "test:install"]],
    ...composeProfile("native-core", "coverage", "anvil-smoke", "evals"),
    ...composeProfile("build", "docs-reference-check", "repo-conformance-core"),
  ],
  release: [
    ["npm", ["test"]],
    ["npm", ["run", "test:install"]],
    ...composeProfile("native-core", "coverage", "anvil-full", "anvil-smoke", "evals"),
    ...composeProfile(
      "build",
      "docs-reference-check",
      "repo-conformance-core",
      "release-bench",
    ),
  ],
  all: [
    ["npm", ["test"]],
    ["npm", ["run", "test:install"]],
    ...composeProfile("native-core", "coverage", "anvil-full", "anvil-smoke", "evals"),
    ...composeProfile(
      "build",
      "docs-reference-check",
      "repo-conformance-all",
      "release-bench",
    ),
  ],
};

export function resolveProfile(name) {
  return TEST_PROFILES[name] ?? null;
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
      env: options.env ?? process.env,
    });

    if (result.error) {
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
