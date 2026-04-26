import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guideText, helpTestInternals, welcomeScreen } from "../../src/utils/help.ts";
import { DEFAULT_WELCOME_SCREEN_ACTIONS } from "../../src/utils/welcome-readiness.ts";

const ORIGINAL_ENV = {
  npm_lifecycle_event: process.env.npm_lifecycle_event,
  npm_execpath: process.env.npm_execpath,
};

describe("help content", () => {
  afterEach(() => {
    if (ORIGINAL_ENV.npm_lifecycle_event === undefined) {
      delete process.env.npm_lifecycle_event;
    } else {
      process.env.npm_lifecycle_event = ORIGINAL_ENV.npm_lifecycle_event;
    }

    if (ORIGINAL_ENV.npm_execpath === undefined) {
      delete process.env.npm_execpath;
    } else {
      process.env.npm_execpath = ORIGINAL_ENV.npm_execpath;
    }
  });

  test("guideText documents flow recovery and new-wallet guidance", () => {
    const guide = guideText();
    expect(guide).toContain("flow ragequit");
    expect(guide).toContain("--new-wallet");
    expect(guide).toContain("--export-new-wallet <path>");
    expect(guide).toMatch(/workflow wallet/i);
  });

  test("guideText keeps both the packaged install path and the source fallback", () => {
    const guide = guideText();
    expect(guide).toContain("npm i -g privacy-pools-cli");
    expect(guide).toContain("privacy-pools upgrade --check");
    expect(guide).toContain("privacy-pools status");
    expect(guide).toContain("github:0xmatthewb/privacy-pools-cli");
  });

  test("guideText teaches the pending-only approval flow after deposits", () => {
    const guide = guideText();
    expect(guide).toContain("privacy-pools accounts --chain mainnet --pending-only");
    expect(guide).toContain("privacy-pools accounts --chain mainnet");
    expect(guide).toContain("approved");
    expect(guide).toContain("declined");
    expect(guide).toMatch(/Proof of Association|POA Needed|poa_required/);
    expect(guide).toContain("--chain");
  });

  test("guideText frames bundled docs as package-relative and points users at built-in help", () => {
    const guide = guideText();
    expect(guide).toContain("privacy-pools <command> --help");
    expect(guide).toContain("docs/reference.md");
    expect(guide).toContain("docs/runtime-upgrades.md");
    expect(guide).toContain("AGENTS.md");
  });

  test("guideText highlights website recovery import in quickstart guidance", () => {
    const guide = guideText("quickstart");
    expect(guide).toContain("privacy-pools init");
    expect(guide).toContain("privacy-pools init --recovery-phrase-file");
    expect(guide).toContain("privacy-pools init --recovery-phrase-stdin");
    expect(guide).toMatch(/website export|load an existing account/i);
  });

  test("guideText exposes a topic index and accepts flow as a workflow shortcut", () => {
    const topics = guideText("topics");
    expect(topics).toContain("Available Topics");
    expect(topics).toContain("quickstart");
    expect(topics).toContain("workflow");

    const flow = guideText("flow");
    expect(flow).toContain("Privacy Pools: workflow");
    expect(flow).toContain("flow start");
  });

  test("guideText formats unknown topics cleanly and lists valid topics once", () => {
    const guide = guideText("definitely-not-a-topic");
    expect(guide).toContain("Unknown guide topic: definitely-not-a-topic");
    expect(guide).toContain("Available topics\n");
    expect(guide).not.toContain("Available topics::");
    expect(guide).not.toContain("topics.:");
  });

  test("welcomeScreen includes npm link hint when running from source", () => {
    process.env.npm_lifecycle_event = "dev";
    process.env.npm_execpath = "/usr/local/bin/npm";
    const packageRoot = join(tmpdir(), `pp-help-source-${Date.now()}`);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, ".git"), "gitdir: test\n", "utf8");

    try {
      const welcome = welcomeScreen({ packageRoot });
      expect(helpTestInternals.shouldShowPathRegistrationHint(packageRoot)).toBe(
        true,
      );
      expect(welcome).toMatch(/\bPATH\b/i);
      expect(welcome).toMatch(/\blink\b/i);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  test("welcomeScreen keeps the npm link hint even when npm_execpath is absent", () => {
    process.env.npm_lifecycle_event = "dev";
    delete process.env.npm_execpath;
    const packageRoot = join(tmpdir(), `pp-help-source-${Date.now()}-npm`);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, ".git"), "gitdir: test\n", "utf8");

    try {
      const welcome = welcomeScreen({ packageRoot });
      expect(welcome).toMatch(/\bPATH\b/i);
      expect(welcome).toMatch(/\blink\b/i);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  test("welcomeScreen skips the source-link hint for installed package roots", () => {
    process.env.npm_lifecycle_event = "dev";
    process.env.npm_execpath = "/usr/local/bin/npm";
    const packageRoot = join(tmpdir(), `pp-help-installed-${Date.now()}`);
    mkdirSync(packageRoot, { recursive: true });

    try {
      expect(helpTestInternals.shouldShowPathRegistrationHint(packageRoot)).toBe(
        false,
      );
      const welcome = welcomeScreen({ packageRoot });
      expect(welcome).not.toContain("npm link");
      expect(welcome).not.toMatch(/register the cli on your path/i);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  test("welcomeScreen surfaces status and website restore commands", () => {
    const welcome = welcomeScreen();
    for (const action of DEFAULT_WELCOME_SCREEN_ACTIONS) {
      expect(welcome).toContain(`privacy-pools ${action.cliCommand}`);
    }
    expect(welcome).toMatch(/load existing account|website export/i);
  });
});
