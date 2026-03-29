import { expect, test } from "bun:test";

test("hangs long enough for the outer watchdog to fire", async () => {
  expect(true).toBe(true);
  await new Promise(() => {
    // Intentionally never resolve so the Bun subprocess outlives the outer
    // watchdog budget in run-bun-tests.mjs.
  });
});
