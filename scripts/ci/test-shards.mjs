import { spawnSync } from "node:child_process";
import {
  buildFileShards,
  collectLinuxCoreTestFiles,
  shardMatrix,
} from "./lib.mjs";

function parseArgs(argv) {
  const parsed = {
    count: 3,
    index: 1,
    mode: "files",
    run: false,
    forwardedArgs: [],
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--count") {
      parsed.count = Number.parseInt(argv[++index] ?? "3", 10);
      continue;
    }
    if (token === "--index") {
      parsed.index = Number.parseInt(argv[++index] ?? "1", 10);
      continue;
    }
    if (token === "--matrix") {
      parsed.mode = "matrix";
      continue;
    }
    if (token === "--run") {
      parsed.run = true;
      continue;
    }
    if (token === "--") {
      parsed.forwardedArgs = argv.slice(index + 1);
      break;
    }
    parsed.forwardedArgs.push(token);
  }

  return parsed;
}

const args = parseArgs(process.argv);

if (args.mode === "matrix") {
  process.stdout.write(`${JSON.stringify(shardMatrix(args.count))}\n`);
  process.exit(0);
}

const shards = buildFileShards(collectLinuxCoreTestFiles(), args.count);
const selected = shards.find((shard) => shard.index === args.index);

if (!selected) {
  throw new Error(`Unknown shard index ${args.index}; expected 1-${args.count}`);
}

if (!args.run) {
  process.stdout.write(`${selected.files.join("\n")}\n`);
  process.exit(0);
}

const result = spawnSync(
  "node",
  ["scripts/run-test-suite.mjs", ...selected.files, ...args.forwardedArgs],
  {
    stdio: "inherit",
    env: process.env,
  },
);

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
