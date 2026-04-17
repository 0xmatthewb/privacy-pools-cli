import { describe, expect, test } from "bun:test";
import { createStatusCommand } from "../../src/commands/status.ts";

describe("status command shell", () => {
  test("keeps compatibility check aliases hidden from help", () => {
    const command = createStatusCommand();
    const options = command.options.map((option) => ({
      flags: option.flags,
      hidden: option.hidden,
    }));

    expect(options).toEqual(
      expect.arrayContaining([
        { flags: "--check [scope]", hidden: false },
        { flags: "--no-check", hidden: false },
        { flags: "--check-rpc", hidden: true },
        { flags: "--check-asp", hidden: true },
      ]),
    );
  });
});
