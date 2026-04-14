import { readFileSync } from "node:fs";
import {
  loadRuntimeMetadata,
  mergeRuntimeReportsIntoMetadata,
  saveRuntimeMetadata,
  TEST_RUNTIME_METADATA_PATH,
} from "./test-runtime-metadata.mjs";

function parseArgs(argv) {
  const parsed = {
    reports: [],
    filePath: TEST_RUNTIME_METADATA_PATH,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--report") {
      const reportPath = argv[++index];
      if (!reportPath) {
        throw new Error("--report requires a value");
      }
      parsed.reports.push(reportPath);
      continue;
    }
    if (token === "--file") {
      const filePath = argv[++index];
      if (!filePath) {
        throw new Error("--file requires a value");
      }
      parsed.filePath = filePath;
      continue;
    }
  }

  return parsed;
}

const args = parseArgs(process.argv);

if (args.reports.length === 0) {
  throw new Error("At least one --report path is required");
}

const reports = args.reports.map((reportPath) =>
  JSON.parse(readFileSync(reportPath, "utf8"))
);
const metadata = loadRuntimeMetadata({ filePath: args.filePath });
const merged = mergeRuntimeReportsIntoMetadata(metadata, reports);
saveRuntimeMetadata(merged, { filePath: args.filePath });

process.stdout.write(
  `Updated runtime metadata from ${args.reports.length} report(s): ${args.filePath}\n`,
);
