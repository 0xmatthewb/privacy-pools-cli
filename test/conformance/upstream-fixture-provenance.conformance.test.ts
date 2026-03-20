import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { CORE_REPO_FIXTURE_REF } from "../helpers/github.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

test("upstream fixture README stays aligned with the pinned core ref", () => {
  const readme = readFileSync(
    resolve(CLI_ROOT, "test/fixtures/upstream/README.md"),
    "utf8",
  );

  expect(readme).toContain(CORE_REPO_FIXTURE_REF);
});
