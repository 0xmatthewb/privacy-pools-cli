import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CLI_ROOT } from "../helpers/paths.ts";

describe("docs generation drift detection", () => {
  test("docs/reference.md matches generated output", () => {
    const distExists = existsSync(join(CLI_ROOT, "dist", "program.js"));
    if (!distExists) {
      throw new Error(
        "dist/program.js not found. Run `bun run build` before running conformance tests.",
      );
    }

    const result = spawnSync("node", ["scripts/generate-reference.mjs", "--check"], {
      cwd: CLI_ROOT,
      timeout: 30_000,
    });

    const stderr = result.stderr?.toString() ?? "";
    if (result.status !== 0) {
      throw new Error(
        `docs/reference.md is out of date. Run \`bun run docs:generate\` to regenerate.\n${stderr}`,
      );
    }
    expect(result.status).toBe(0);
  });
});
