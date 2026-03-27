import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
export const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

export const TEST_PROFILES = {
  install: [
    ["npm", ["run", "test:smoke"]],
    ["npm", ["run", "test:smoke:native:package"]],
    ["npm", ["run", "test:artifacts:host"]],
  ],
  conformance: [
    ["bun", ["run", "build"]],
    ["npm", ["run", "test:scripts"]],
    ["node", ["scripts/run-conformance-suite.mjs", "core"]],
  ],
  "conformance-all": [
    ["bun", ["run", "build"]],
    ["npm", ["run", "test:scripts"]],
    ["node", ["scripts/run-conformance-suite.mjs", "all"]],
  ],
  ci: [
    ["npm", ["test"]],
    ["npm", ["run", "test:install"]],
    ["npm", ["run", "test:native:fmt"]],
    ["npm", ["run", "test:native:lint"]],
    ["npm", ["run", "test:native"]],
    ["npm", ["run", "test:coverage"]],
    ["npm", ["run", "test:e2e:anvil:smoke"]],
    ["node", ["scripts/run-bun-tests.mjs", "./test/evals", "--timeout", "120000"]],
    ["bun", ["run", "build"]],
    ["node", ["scripts/generate-reference.mjs", "--check"]],
    ["npm", ["run", "test:scripts"]],
    ["node", ["scripts/run-conformance-suite.mjs", "core"]],
  ],
  release: [
    ["npm", ["test"]],
    ["npm", ["run", "test:install"]],
    ["npm", ["run", "test:native:fmt"]],
    ["npm", ["run", "test:native:lint"]],
    ["npm", ["run", "test:native"]],
    ["npm", ["run", "test:coverage"]],
    ["npm", ["run", "test:e2e:anvil"]],
    ["node", ["scripts/run-bun-tests.mjs", "./test/evals", "--timeout", "120000"]],
    ["bun", ["run", "build"]],
    ["node", ["scripts/generate-reference.mjs", "--check"]],
    ["npm", ["run", "test:scripts"]],
    ["node", ["scripts/run-conformance-suite.mjs", "core"]],
    ["npm", ["run", "bench:gate:release"]],
  ],
  all: [
    ["npm", ["test"]],
    ["npm", ["run", "test:install"]],
    ["npm", ["run", "test:native:fmt"]],
    ["npm", ["run", "test:native:lint"]],
    ["npm", ["run", "test:native"]],
    ["npm", ["run", "test:coverage"]],
    ["npm", ["run", "test:e2e:anvil"]],
    ["node", ["scripts/run-bun-tests.mjs", "./test/evals", "--timeout", "120000"]],
    ["bun", ["run", "build"]],
    ["node", ["scripts/generate-reference.mjs", "--check"]],
    ["npm", ["run", "test:scripts"]],
    ["node", ["scripts/run-conformance-suite.mjs", "all"]],
    ["npm", ["run", "bench:gate:release"]],
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
