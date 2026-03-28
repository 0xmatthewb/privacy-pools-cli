import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const builtCliPath = join(repoRoot, "dist", "index.js");

if (!existsSync(builtCliPath)) {
  console.error(
    "Built CLI not found. Run `npm run build` first, or use `npm run dev -- ...` from source.",
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [builtCliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  console.error(`Failed to launch built CLI: ${result.error.message}`);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(1);
