import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const VERIFY_ROOT_ONLY_INSTALL = join(
  repoRoot,
  "scripts",
  "verify-root-only-install.mjs",
);
const installVerificationModulePath = join(
  repoRoot,
  "scripts",
  "lib",
  "install-verification.mjs",
);
const {
  isSupportedInstallNodeVersion,
  packTarball,
  unsupportedInstallNodeMessage,
} = await import(
  pathToFileURL(installVerificationModulePath).href
);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 1_200_000,
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

const distIndexPath = join(repoRoot, "dist", "index.js");
if (!existsSync(distIndexPath)) {
  fail(
    "dist/index.js not found. Run `npm run build` before verifying the root-only artifact.",
  );
}

const tempRoot = mkdtempSync(join(tmpdir(), "pp-root-artifact-host-"));
const cliTarballDir = join(tempRoot, "cli");

mkdirSync(cliTarballDir, { recursive: true });

try {
  if (!isSupportedInstallNodeVersion()) {
    process.stdout.write(
      `${unsupportedInstallNodeMessage("Installed root-only artifact verification")}\n`,
    );
    process.stdout.write(
      `Skipped root-only release artifact verification using ${distIndexPath}\n`,
    );
  } else {
    const cliTarball = packTarball(repoRoot, cliTarballDir, {
      npmStateRoot: tempRoot,
      ignoreScripts: true,
    });

    run("node", [
      VERIFY_ROOT_ONLY_INSTALL,
      "--cli-tarball",
      cliTarball,
    ]);

    process.stdout.write(
      `Verified root-only release artifact using ${distIndexPath}\n`,
    );
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
