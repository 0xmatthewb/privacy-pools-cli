import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyNativeCoverageSources,
  NATIVE_COVERAGE_DIAGNOSTICS,
  NATIVE_COVERAGE_FAMILIES,
  normalizeNativeCoveragePath,
  nativeCoverageSourceMatches,
} from "./lib/native-coverage-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MANIFEST_PATH = resolve(ROOT, "native", "shell", "Cargo.toml");
const coverageRootDir = mkdtempSync(join(tmpdir(), "pp-native-coverage-"));
const keepCoverageRoot = process.env.PP_KEEP_COVERAGE_ROOT === "1";
const lcovPath = join(coverageRootDir, "native.lcov");

function parseLcovFile(filePath) {
  const records = readFileSync(filePath, "utf8").split("end_of_record\n");
  const files = new Map();

  for (const record of records) {
    const sourceMatch = record.match(/^SF:(.+)$/m);
    if (!sourceMatch) continue;

    const rawSource = sourceMatch[1];
    const absoluteSource = normalizeNativeCoveragePath(
      isAbsolute(rawSource) ? rawSource : resolve(ROOT, rawSource),
    );
    const source = absoluteSource.startsWith(`${normalizeNativeCoveragePath(ROOT)}/`)
      ? absoluteSource.slice(normalizeNativeCoveragePath(ROOT).length + 1)
      : absoluteSource;
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
    if (!matchers.some((matcher) => nativeCoverageSourceMatches(source, matcher))) {
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
  const executableSources = [...coverageMap.keys()]
    .filter((source) => source.startsWith("native/shell/src/"))
    .sort();
  const ownership = classifyNativeCoverageSources(executableSources);

  if (ownership.unmatched.length > 0) {
    fail(
      [
        "native coverage ownership has unmatched executable sources:",
        ...ownership.unmatched.map((source) => `- ${source}`),
      ].join("\n"),
    );
  }

  if (ownership.multiplyMatched.length > 0) {
    fail(
      [
        "native coverage ownership has multiply matched executable sources:",
        ...ownership.multiplyMatched.map(
          ({ source, families }) => `- ${source}: ${families.join(", ")}`,
        ),
      ].join("\n"),
    );
  }

  let failed = false;

  for (const family of NATIVE_COVERAGE_FAMILIES) {
    const stats = parseCoverageByMatchers(family.matchers, coverageMap);
    if (stats.linesFound === 0) {
      fail(
        `native coverage ${family.label}: no executable lines matched ${family.matchers.join(
          ", ",
        )}`,
      );
    }

    const summary = `${stats.percent.toFixed(2)}% (${stats.linesHit}/${stats.linesFound})`;
    const suffix = family.enforced ? "" : " (diagnostic)";
    process.stdout.write(`native coverage ${family.label}${suffix}: ${summary}\n`);

    if (family.enforced && stats.percent + Number.EPSILON < family.min) {
      failed = true;
      process.stderr.write(
        `native coverage ${family.label} fell below ${family.min}%: ${summary}\n`,
      );
    }
  }

  for (const diagnostic of NATIVE_COVERAGE_DIAGNOSTICS) {
    const stats = parseCoverageByMatchers(diagnostic.matchers, coverageMap);
    if (stats.linesFound === 0) {
      fail(
        `native coverage ${diagnostic.label}: no executable lines matched ${diagnostic.matchers.join(
          ", ",
        )}`,
      );
    }
    const summary = `${stats.percent.toFixed(2)}% (${stats.linesHit}/${stats.linesFound})`;
    process.stdout.write(`native coverage ${diagnostic.label} (diagnostic): ${summary}\n`);
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
