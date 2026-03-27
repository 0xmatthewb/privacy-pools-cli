import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fail,
  npmCommand,
  parseArgs,
  repoRoot,
} from "./lib/install-verification.mjs";
import {
  getNativeDistributionByTriplet,
} from "../src/native-distribution.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function usageAndExit() {
  process.stderr.write(
    "Usage: node scripts/pack-native-tarball.mjs --triplet <triplet> [--binary <path>] [--out-dir <path>]\n",
  );
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });

  if (result.error) {
    fail(
      `Failed to execute ${command} ${args.join(" ")}:\n${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    fail(
      `Command failed: ${command} ${args.join(" ")}\n${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim(),
    );
  }

  return result;
}

const args = parseArgs(process.argv.slice(2));
const triplet = args.triplet?.trim();
if (!triplet) {
  usageAndExit();
}

const distribution = getNativeDistributionByTriplet(triplet);
if (!distribution) {
  fail(`Unsupported native triplet '${triplet}'.`);
}

const outDir = resolve(args["out-dir"] ?? join(repoRoot, "dist-native", triplet));
const binaryPath = resolve(
  args.binary ??
    join(repoRoot, "native", "shell", "target", "release", distribution.binaryFileName),
);
mkdirSync(dirname(outDir), { recursive: true });

run("node", [
  join(scriptDir, "prepare-native-package.mjs"),
  "--triplet",
  triplet,
  "--binary",
  binaryPath,
  "--out-dir",
  outDir,
]);

const packResult = run(npmCommand, ["pack", "--silent"], { cwd: outDir });
const tarballName = packResult.stdout.trim();
const tarballSource = join(outDir, tarballName);
const tarballDestination = join(dirname(outDir), tarballName);
renameSync(tarballSource, tarballDestination);

run("node", [
  join(scriptDir, "verify-packed-native-package.mjs"),
  "--triplet",
  triplet,
  "--tarball",
  tarballDestination,
]);

process.stdout.write(`${tarballDestination}\n`);
