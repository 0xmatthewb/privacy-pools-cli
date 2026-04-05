import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { benchHomesRoot } from "./constants.mjs";

export function prepareFixtureHomeCopy(fixtureName) {
  const sourceRoot = join(benchHomesRoot, fixtureName);
  if (!existsSync(sourceRoot)) {
    throw new Error(`Unknown benchmark fixture home: ${fixtureName}`);
  }

  const tempRoot = mkdtempSync(join(tmpdir(), `pp-cli-bench-home-${fixtureName}-`));
  const copiedHome = join(tempRoot, "home");
  cpSync(sourceRoot, copiedHome, {
    recursive: true,
    force: true,
  });

  return {
    tempRoot,
    homeRoot: copiedHome,
    configHome: join(copiedHome, ".privacy-pools"),
  };
}

export function cleanupPreparedFixtureHome(preparedHome) {
  if (!preparedHome) return;
  rmSync(preparedHome.tempRoot, { recursive: true, force: true });
}
