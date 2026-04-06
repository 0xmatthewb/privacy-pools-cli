import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  parseArgs,
  npmCommand,
  packTarball,
} from "../lib/install-verification.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function setGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT?.trim();
  if (!outputPath) {
    return;
  }

  writeFileSync(outputPath, `${name}=${value}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: "inherit",
  });

  if (result.error) {
    fail(
      `Failed to execute ${command} ${args.join(" ")}:\n${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const args = parseArgs(process.argv.slice(2));
const artifactRoot = resolve(
  args["artifact-root"]?.trim() || join(ROOT, ".tmp", "ci-js-artifacts"),
);
const tarballRoot = join(artifactRoot, "tarball");
const npmStateRoot = join(artifactRoot, "npm-state");
const distDir = join(ROOT, "dist");

mkdirSync(artifactRoot, { recursive: true });
mkdirSync(tarballRoot, { recursive: true });
mkdirSync(npmStateRoot, { recursive: true });

run(npmCommand, ["run", "build"]);

if (!existsSync(join(distDir, "index.js"))) {
  fail("dist/index.js not found after npm run build.");
}

const cliTarball = packTarball(ROOT, tarballRoot, {
  ignoreScripts: true,
  npmStateRoot,
});
const cliTarballName = cliTarball.split(/[/\\]/).pop();

if (!cliTarballName) {
  fail(`Failed to determine tarball name for ${cliTarball}.`);
}

setGithubOutput("artifact_root", artifactRoot);
setGithubOutput("dist_dir", distDir);
setGithubOutput("cli_tarball", cliTarball);
setGithubOutput("cli_tarball_name", cliTarballName);

process.stdout.write(
  JSON.stringify(
    {
      artifactRoot,
      distDir,
      cliTarball,
      cliTarballName,
    },
    null,
    2,
  ) + "\n",
);
