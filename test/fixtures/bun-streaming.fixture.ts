import { expect, test } from "bun:test";

test("streams output before the runner exits", async () => {
  console.log("stream-ready");
  await Bun.sleep(1200);
  expect(true).toBe(true);
});
