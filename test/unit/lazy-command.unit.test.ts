import { describe, expect, mock, test } from "bun:test";
import { createLazyAction } from "../../src/utils/lazy-command.ts";

describe("lazy command actions", () => {
  test("loads the handler once and reuses it across calls", async () => {
    const handler = mock(async (...args: unknown[]) => args);
    const load = mock(async () => ({ run: handler }));
    const action = createLazyAction(load, "run");

    await action("first", 1);
    await action("second", 2);

    expect(load).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]).toEqual(["first", 1]);
    expect(handler.mock.calls[1]).toEqual(["second", 2]);
  });

  test("throws when the lazy export is not a function", async () => {
    const action = createLazyAction(async () => ({ run: "nope" }), "run");

    await expect(action()).rejects.toThrow('Lazy command export "run" was not a function.');
  });
});
