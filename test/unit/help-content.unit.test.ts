import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guideText, helpTestInternals, welcomeScreen } from "../../src/utils/help.ts";

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
    expect(guide).toContain("dedicated per-workflow wallet");
  });

  test("guideText prefers the packaged install path and keeps the github fallback", () => {
    const guide = guideText();
    expect(guide).toContain("npm i -g privacy-pools-cli");
    expect(guide).toContain("bun add -g privacy-pools-cli");
    expect(guide).toContain("github:0xmatthewb/privacy-pools-cli");
    expect(guide).toContain("unreleased/source builds");
  });

  test("welcomeScreen includes bun link hint when running from source with bun", () => {
    process.env.npm_lifecycle_event = "dev";
    process.env.npm_execpath = "/usr/local/bin/bun";
    const packageRoot = join(tmpdir(), `pp-help-source-${Date.now()}`);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, ".git"), "gitdir: test\n", "utf8");

    try {
      const welcome = welcomeScreen({ packageRoot });
      expect(welcome).toContain("Running from source?");
      expect(welcome).toContain("bun link");
      expect(helpTestInternals.shouldShowPathRegistrationHint(packageRoot)).toBe(
        true,
      );
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  test("welcomeScreen prefers bun link when bun is the active runtime", () => {
    process.env.npm_lifecycle_event = "dev";
    process.env.npm_execpath = "/usr/local/bin/npm";
    const packageRoot = join(tmpdir(), `pp-help-source-${Date.now()}-bun`);
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, ".git"), "gitdir: test\n", "utf8");

    try {
      const welcome = welcomeScreen({ packageRoot });
      expect(welcome).toContain("Running from source?");
      expect(welcome).toContain("bun link");
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
      expect(welcome).not.toContain("Running from source?");
      expect(welcome).not.toContain("npm link");
      expect(welcome).not.toContain("bun link");
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });
});
