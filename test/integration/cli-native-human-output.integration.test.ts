import { afterAll, beforeAll, describe, expect } from "bun:test";
import {
  type FixtureServer,
  killFixtureServer,
  launchFixtureServer,
} from "../helpers/fixture-server.ts";
import { expectGolden } from "../helpers/golden.ts";
import {
  GOLDEN_TEXT_CASES,
  resolveGoldenCaseRunOptions,
} from "../helpers/golden-cli-cases.ts";
import {
  ensureNativeShellBinary,
  nativeTest,
  runBuiltCli,
  runNativeBuiltCli,
  withJsFallback,
} from "../helpers/native-shell.ts";

describe("native human-output smoke", () => {
  let nativeBinary: string;
  let fixture: FixtureServer | null = null;

  const sharedTextCases = GOLDEN_TEXT_CASES.filter((goldenCase) => goldenCase.sharedNative);

  beforeAll(async () => {
    nativeBinary = ensureNativeShellBinary();
    fixture = await launchFixtureServer();
  }, 240_000);

  afterAll(async () => {
    if (fixture) {
      await killFixtureServer(fixture);
    }
  });

  for (const goldenCase of sharedTextCases) {
    nativeTest(goldenCase.name, () => {
      const runOptions = resolveGoldenCaseRunOptions(goldenCase.env, fixture);
      const jsResult = runBuiltCli(goldenCase.args, withJsFallback(runOptions));
      const nativeResult = runNativeBuiltCli(nativeBinary, goldenCase.args, runOptions);

      expect(jsResult.status).toBe(goldenCase.status);
      expect(nativeResult.status).toBe(goldenCase.status);
      expect(nativeResult.status).toBe(jsResult.status);

      if (goldenCase.stream === "stdout") {
        expect(jsResult.stderr).toBe("");
        expect(nativeResult.stderr).toBe("");
        expectGolden(goldenCase.name, jsResult.stdout);
        expectGolden(goldenCase.name, nativeResult.stdout);
        return;
      }

      expect(jsResult.stdout).toBe("");
      expect(nativeResult.stdout).toBe("");
      expectGolden(goldenCase.name, jsResult.stderr);
      expectGolden(goldenCase.name, nativeResult.stderr);
    });
  }
}, 300_000);
