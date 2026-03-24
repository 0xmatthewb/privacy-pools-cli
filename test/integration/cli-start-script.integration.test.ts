import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { CLI_CWD } from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";

function createCheckoutWithoutDist(): string {
  const checkoutDir = mkdtempSync(join(tmpdir(), "pp-start-script-"));
  mkdirSync(join(checkoutDir, "scripts"), { recursive: true });
  copyFileSync(
    join(CLI_CWD, "scripts", "start-built-cli.mjs"),
    join(checkoutDir, "scripts", "start-built-cli.mjs"),
  );
  writeFileSync(
    join(checkoutDir, "package.json"),
    readFileSync(join(CLI_CWD, "package.json"), "utf8"),
    "utf8",
  );
  return checkoutDir;
}

describe("start script", () => {
  test("prints a build hint when dist is missing", () => {
    const checkoutDir = createCheckoutWithoutDist();

    try {
      const result = spawnSync("npm", ["run", "--silent", "start", "--", "--help"], {
        cwd: checkoutDir,
        encoding: "utf8",
        timeout: 20_000,
        env: buildChildProcessEnv(),
      });

      expect(result.status).toBe(1);
      expect(result.stdout.trim()).toBe("");
      expect(result.stderr).toContain("Built CLI not found.");
      expect(result.stderr).toContain("bun run build");
      expect(result.stderr).toContain("bun run dev --");
    } finally {
      rmSync(checkoutDir, { recursive: true, force: true });
    }
  });
});
