import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(iteration) {
  process.stdout.write(`\n[anvil-flake] pass ${iteration}/2\n`);

  const result = spawnSync(npmCommand, ["run", "test:e2e:anvil:smoke"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    fail(
      `Failed to execute anvil flake pass ${iteration}: ${result.error.message}`,
    );
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
  }
}

run(1);
run(2);
