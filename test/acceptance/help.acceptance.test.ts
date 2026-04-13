import { expect } from "bun:test";
import {
  assertExit,
  assertJson,
  assertStderr,
  assertStderrEmpty,
  assertStdout,
  assertStdoutEmpty,
  assertStdoutOnlyStep,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
} from "./framework.ts";

// The ripple pool banner contains "PRIVACY POOLS" as the brand mark
const BANNER_SENTINEL = "PRIVACY POOLS";
const COMPACT_BANNER_SENTINEL = "PRIVACY POOLS";

defineScenarioSuite("help acceptance", [
  defineScenario("root help stays on stdout and exposes the core surface", [
    runCliStep(["--help"]),
    assertExit(0),
    assertStderrEmpty(),
    assertStdout((stdout) => {
      expect(stdout).not.toContain(BANNER_SENTINEL);
      expect(stdout).toContain("Get started:");
      expect(stdout).toContain("--quiet");
      expect(stdout).toContain("--verbose");
      expect(stdout).toContain("init");
      expect(stdout).toContain("status");
      expect(stdout).toContain("pools");
      expect(stdout).toContain("withdraw");
      expect(stdout).toContain("completion");
    }),
  ]),
  defineScenario("version prints a semantic version on stdout only", [
    runCliStep(["--version"]),
    assertExit(0),
    assertStderrEmpty(),
    assertStdoutOnlyStep(/^\d+\.\d+\.\d+\s*$/),
  ]),
  defineScenario("withdraw quote help remains a stdout-only subcommand contract", [
    runCliStep(["withdraw", "quote", "--help"]),
    assertExit(0),
    assertStderrEmpty(),
    assertStdout((stdout) => {
      expect(stdout).toContain("Request relayer quote and limits");
      expect(stdout).toContain("--asset");
    }),
  ]),
  defineScenario("guide topic help formats unknown topics cleanly", [
    runCliStep(["guide", "definitely-not-a-topic"]),
    assertExit(0),
    assertStdoutEmpty(),
    assertStderr((stderr) => {
      expect(stderr).toContain("Unknown guide topic: definitely-not-a-topic");
      expect(stderr).toContain("Available topics:");
      expect(stderr).not.toContain("Available topics::");
      expect(stderr).not.toContain("topics.:");
    }),
  ]),
  defineScenario("describe without a command path returns a targeted input error", [
    runCliStep(["describe"]),
    assertExit(2),
    assertStdout((stdout) => {
      expect(stdout.trim()).toBe("");
    }),
    assertStderr((stderr) => {
      expect(stderr).toContain("Missing command path for describe");
      expect(stderr).toContain("Valid command paths:");
    }),
  ]),
  defineScenario("json help stays machine-readable", [
    runCliStep(["--json", "--help"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{ mode: string; help: string }>((json) => {
      expect(json.mode).toBe("help");
      expect(typeof json.help).toBe("string");
      expect(json.help).toContain("privacy-pools");
    }),
  ]),
  defineScenario("json version stays machine-readable", [
    runCliStep(["--json", "--version"]),
    assertExit(0),
    assertStderrEmpty(),
    assertJson<{ mode: string; version: string }>((json) => {
      expect(json.mode).toBe("version");
      expect(json.version).toMatch(/^\d+\.\d+\.\d+$/);
    }),
  ]),
  defineScenario("bare invocation shows the welcome screen and only prints the banner once per session", [
    (ctx) => {
      ctx.setEnv({
        TERM_SESSION_ID: `pp-help-acceptance-${Date.now()}`,
      });
    },
    runCliStep([]),
    assertExit(0),
    assertStderr((stderr) => {
      expect(
        stderr.includes(BANNER_SENTINEL) || stderr.includes(COMPACT_BANNER_SENTINEL),
      ).toBe(true);
      expect(stderr).toContain("A compliant way to transact privately on Ethereum.");
    }),
    runCliStep([]),
    assertExit(0),
    assertStdout((stdout) => {
      // Second run: banner already shown, standalone welcome screen prints to stdout
      expect(stdout).toContain("privacy-pools init");
    }),
    assertStderr((stderr) => {
      expect(stderr).not.toContain(BANNER_SENTINEL);
      expect(stderr).not.toContain(COMPACT_BANNER_SENTINEL);
    }),
  ]),
  defineScenario("unknown commands fail on stderr with the documented input exit code", [
    runCliStep(["not-a-command"]),
    assertExit(2),
    assertStdout((stdout) => {
      expect(stdout.trim()).toBe("");
    }),
    assertStderr((stderr) => {
      expect(stderr.toLowerCase()).toContain("unknown command");
    }),
  ]),
]);
