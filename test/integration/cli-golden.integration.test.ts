import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseJsonOutput, runBuiltCli } from "../helpers/cli.ts";
import {
  type FixtureServer,
  killFixtureServer,
  launchFixtureServer,
} from "../helpers/fixture-server.ts";
import { expectGolden, expectJsonGolden } from "../helpers/golden.ts";
import {
  GOLDEN_JSON_CASES,
  GOLDEN_TEXT_CASES,
  resolveGoldenCaseRunOptions,
} from "../helpers/golden-cli-cases.ts";
import { withJsFallback } from "../helpers/native-shell.ts";

describe("cli golden files", () => {
  let fixture: FixtureServer | null = null;

  beforeAll(async () => {
    fixture = await launchFixtureServer();
  }, 240_000);

  afterAll(async () => {
    if (fixture) {
      await killFixtureServer(fixture);
    }
  });

  for (const goldenCase of GOLDEN_TEXT_CASES) {
    test(goldenCase.name, () => {
      const runOptions = withJsFallback(
        resolveGoldenCaseRunOptions(goldenCase.env, fixture),
      );
      const result = runBuiltCli(goldenCase.args, runOptions);

      expect(result.status).toBe(goldenCase.status);
      expect(goldenCase.stream === "stdout" ? result.stderr : result.stdout).toBe("");
      expectGolden(
        goldenCase.name,
        goldenCase.stream === "stdout" ? result.stdout : result.stderr,
      );
    });
  }

  for (const goldenCase of GOLDEN_JSON_CASES) {
    test(goldenCase.name, () => {
      const result = runBuiltCli(
        goldenCase.args,
        withJsFallback(resolveGoldenCaseRunOptions(goldenCase.env, fixture)),
      );

      expect(result.status).toBe(goldenCase.status);
      expect(result.stderr).toBe("");
      expectJsonGolden(goldenCase.name, parseJsonOutput(result.stdout));
    });
  }
}, 300_000);
