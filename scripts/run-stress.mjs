import { spawnSync } from "node:child_process";

const result = spawnSync(
  "bun",
  ["test", "./test/stress/cli.stress-120-rounds.stress.ts", "--timeout", "240000"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PP_STRESS_ENABLED: "1",
    },
  }
);

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
