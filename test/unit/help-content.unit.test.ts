import { afterEach, describe, expect, test } from "bun:test";
import { guideText, welcomeScreen } from "../../src/utils/help.ts";

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

  test("welcomeScreen includes bun link hint when running from source with bun", () => {
    process.env.npm_lifecycle_event = "dev";
    process.env.npm_execpath = "/usr/local/bin/bun";

    const welcome = welcomeScreen();
    expect(welcome).toContain("Running from source?");
    expect(welcome).toContain("bun link");
  });

  test("welcomeScreen prefers bun link when bun is the active runtime", () => {
    process.env.npm_lifecycle_event = "dev";
    process.env.npm_execpath = "/usr/local/bin/npm";

    const welcome = welcomeScreen();
    expect(welcome).toContain("Running from source?");
    expect(welcome).toContain("bun link");
  });
});
