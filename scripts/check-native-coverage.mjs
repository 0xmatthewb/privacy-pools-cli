import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MANIFEST_PATH = resolve(ROOT, "native", "shell", "Cargo.toml");
const coverageRootDir = mkdtempSync(join(tmpdir(), "pp-native-coverage-"));
const keepCoverageRoot = process.env.PP_KEEP_COVERAGE_ROOT === "1";
const lcovPath = join(coverageRootDir, "native.lcov");

const thresholds = [
  {
    label: "native-bootstrap",
    min: 85,
    matchers: [
      "native/shell/src/root_argv.rs",
      "native/shell/src/completion.rs",
      "native/shell/src/routing.rs",
    ],
  },
  {
    label: "native-root-argv",
    min: 90,
    matchers: ["native/shell/src/root_argv.rs"],
  },
  {
    label: "native-completion",
    min: 90,
    matchers: ["native/shell/src/completion.rs"],
  },
  {
    label: "native-routing",
    min: 85,
    matchers: ["native/shell/src/routing.rs"],
  },
  {
    label: "native-host",
    min: 85,
    matchers: [
      "native/shell/src/bridge.rs",
      "native/shell/src/dispatch.rs",
      "native/shell/src/main.rs",
    ],
  },
  {
    label: "native-core-utils",
    min: 85,
    matchers: [
      "native/shell/src/config.rs",
      "native/shell/src/contract.rs",
      "native/shell/src/error.rs",
      "native/shell/src/http_client.rs",
      "native/shell/src/json.rs",
      "native/shell/src/output.rs",
      "native/shell/src/read_only_api.rs",
    ],
  },
];

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function parseLcovFile(filePath) {
  const records = readFileSync(filePath, "utf8").split("end_of_record\n");
  const files = new Map();

  for (const record of records) {
    const sourceMatch = record.match(/^SF:(.+)$/m);
    if (!sourceMatch) continue;

    const rawSource = sourceMatch[1];
    const source = normalizePath(
      isAbsolute(rawSource) ? rawSource : resolve(ROOT, rawSource),
    );
    const lineHits = files.get(source) ?? new Map();
    for (const line of record.matchAll(/^DA:(\d+),(\d+)/gm)) {
      const lineNumber = Number(line[1]);
      const hits = Number(line[2]);
      lineHits.set(lineNumber, Math.max(lineHits.get(lineNumber) ?? 0, hits));
    }
    files.set(source, lineHits);
  }

  return files;
}

function parseCoverageByMatchers(matchers, coverageMap) {
  let linesFound = 0;
  let linesHit = 0;

  for (const [source, lineHits] of coverageMap.entries()) {
    if (!matchers.some((matcher) => source.includes(normalizePath(matcher)))) {
      continue;
    }
    linesFound += lineHits.size;
    for (const hits of lineHits.values()) {
      if (hits > 0) linesHit += 1;
    }
  }

  return {
    linesFound,
    linesHit,
    percent: linesFound === 0 ? 0 : (linesHit / linesFound) * 100,
  };
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

try {
  const toolCheck = spawnSync("cargo", ["llvm-cov", "--version"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });

  if (toolCheck.error || toolCheck.status !== 0) {
    fail(
      [
        "cargo llvm-cov is required for native coverage checks.",
        "Install it with: cargo install cargo-llvm-cov --locked",
      ].join("\n"),
    );
  }

  const result = spawnSync(
    "cargo",
    [
      "llvm-cov",
      "--manifest-path",
      MANIFEST_PATH,
      "--lcov",
      "--output-path",
      lcovPath,
      "--quiet",
    ],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  const coverageMap = parseLcovFile(lcovPath);
  let failed = false;

  for (const threshold of thresholds) {
    const stats = parseCoverageByMatchers(threshold.matchers, coverageMap);
    if (stats.linesFound === 0) {
      fail(
        `native coverage ${threshold.label}: no executable lines matched ${threshold.matchers.join(
          ", ",
        )}`,
      );
    }

    const summary = `${stats.percent.toFixed(2)}% (${stats.linesHit}/${stats.linesFound})`;
    process.stdout.write(`native coverage ${threshold.label}: ${summary}\n`);

    if (stats.percent + Number.EPSILON < threshold.min) {
      failed = true;
      process.stderr.write(
        `native coverage ${threshold.label} fell below ${threshold.min}%: ${summary}\n`,
      );
    }
  }

  if (failed) {
    process.exit(1);
  }
} finally {
  if (keepCoverageRoot) {
    process.stdout.write(`native coverage debug artifacts kept at ${coverageRootDir}\n`);
  } else {
    rmSync(coverageRootDir, { recursive: true, force: true });
  }
}
