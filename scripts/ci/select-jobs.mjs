import { evaluateJobSelection, resolveChangedFiles } from "./lib.mjs";

function parseArgs(argv) {
  const parsed = {
    job: "",
    eventName: process.env.GITHUB_EVENT_NAME ?? "pull_request",
    baseRef: process.env.GITHUB_BASE_REF ?? "main",
    changedFiles: null,
    format: "github",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--job") {
      parsed.job = argv[++index] ?? "";
      continue;
    }
    if (token === "--event") {
      parsed.eventName = argv[++index] ?? parsed.eventName;
      continue;
    }
    if (token === "--base-ref") {
      parsed.baseRef = argv[++index] ?? parsed.baseRef;
      continue;
    }
    if (token === "--changed") {
      parsed.changedFiles = [];
      for (let nextIndex = index + 1; nextIndex < argv.length; nextIndex += 1) {
        const candidate = argv[nextIndex];
        if (candidate.startsWith("--")) break;
        parsed.changedFiles.push(candidate);
        index = nextIndex;
      }
      continue;
    }
    if (token === "--format") {
      parsed.format = argv[++index] ?? parsed.format;
    }
  }

  return parsed;
}

const args = parseArgs(process.argv);
if (!args.job) {
  throw new Error("--job is required");
}

const changedFiles =
  args.changedFiles ?? resolveChangedFiles({
    eventName: args.eventName,
    baseRef: args.baseRef,
  });

const decision = evaluateJobSelection({
  job: args.job,
  eventName: args.eventName,
  changedFiles,
});

if (args.format === "json") {
  process.stdout.write(
    `${JSON.stringify({ ...decision, changedFiles }, null, 2)}\n`,
  );
  process.exit(0);
}

process.stdout.write(`should_run=${decision.shouldRun ? "true" : "false"}\n`);
process.stdout.write(`reason=${decision.reason}\n`);
