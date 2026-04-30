import { spawnSync } from "node:child_process";
import {
  buildFileShards,
  collectConformanceTestFiles,
  collectLinuxCoreTestFiles,
  shardMatrix,
} from "./lib.mjs";
import { buildTestRunnerEnv } from "../test-runner-env.mjs";

function parseArgs(argv) {
  const parsed = {
    count: 3,
    index: 1,
    mode: "files",
    run: false,
    target: "main",
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
    if (token === "--target") {
      parsed.target = argv[++index]?.trim() || "main";
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

function extractExcludeTags(args) {
  const remainingArgs = [];
  const excludeTags = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--exclude-tag") {
      const value = args[index + 1]?.trim();
      if (!value) {
        throw new Error("--exclude-tag requires a value");
      }
      excludeTags.push(...value.split(",").map((tag) => tag.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (token?.startsWith("--exclude-tag=")) {
      excludeTags.push(
        ...token
          .slice("--exclude-tag=".length)
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      );
      continue;
    }
    remainingArgs.push(token);
  }

  return { excludeTags, remainingArgs };
}

function selectShardFiles(args) {
  if (args.target === "main") {
    return {
      files: collectLinuxCoreTestFiles(),
      forwardedArgs: args.forwardedArgs,
      runnerArgs: ["scripts/run-test-suite.mjs"],
      weightTarget: "main",
    };
  }

  if (args.target === "conformance") {
    const { excludeTags, remainingArgs } = extractExcludeTags(
      args.forwardedArgs,
    );
    return {
      files: collectConformanceTestFiles({ mode: "core", excludeTags }),
      forwardedArgs: remainingArgs,
      runnerArgs: [
        "scripts/run-bun-tests.mjs",
        "--timeout",
        "120000",
        "--process-timeout-ms",
        "900000",
      ],
      weightTarget: "conformance",
    };
  }

  throw new Error(`Unknown test shard target "${args.target}".`);
}

const args = parseArgs(process.argv);

if (args.mode === "matrix") {
  process.stdout.write(`${JSON.stringify(shardMatrix(args.count))}\n`);
  process.exit(0);
}

const selection = selectShardFiles(args);
const shards = buildFileShards(
  selection.files,
  args.count,
  undefined,
  selection.weightTarget,
);
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
  [
    ...selection.runnerArgs,
    ...selected.files,
    ...selection.forwardedArgs,
  ],
  {
    stdio: "inherit",
    env: buildTestRunnerEnv(),
  },
);

if (result.error) {
  throw result.error;
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.kill(process.pid, result.signal ?? "SIGTERM");
