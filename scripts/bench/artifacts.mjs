import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCheckout, buildNativeShell, nativeShellBinaryPath } from "./worktree.mjs";

export function distEntrypointPath(cwd) {
  return join(cwd, "dist", "index.js");
}

export function ensureCheckoutDist(cwd, build = buildCheckout) {
  const distPath = distEntrypointPath(cwd);
  if (!existsSync(distPath)) {
    build(cwd);
  }
  return distPath;
}

export function ensureNativeBinary(cwd, build = buildNativeShell) {
  const binaryPath = nativeShellBinaryPath(cwd);
  if (!existsSync(binaryPath)) {
    build(cwd);
  }
  return binaryPath;
}

export function prepareDistSnapshot(cwd, build = buildCheckout) {
  ensureCheckoutDist(cwd, build);
  const snapshotRoot = mkdtempSync(join(tmpdir(), "pp-cli-bench-dist-"));
  const snapshotDist = join(snapshotRoot, "dist");
  cpSync(join(cwd, "dist"), snapshotDist, {
    recursive: true,
    force: true,
  });
  const nodeModulesPath = join(cwd, "node_modules");
  if (existsSync(nodeModulesPath)) {
    symlinkSync(nodeModulesPath, join(snapshotRoot, "node_modules"), "dir");
  }
  const packageJsonPath = join(cwd, "package.json");
  if (existsSync(packageJsonPath)) {
    cpSync(packageJsonPath, join(snapshotRoot, "package.json"), {
      force: true,
    });
  }
  return {
    root: snapshotRoot,
    entrypoint: join(snapshotDist, "index.js"),
  };
}

export function cleanupDistSnapshot(snapshot) {
  if (!snapshot) return;
  rmSync(snapshot.root, { recursive: true, force: true });
}
