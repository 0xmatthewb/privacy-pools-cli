import { expect, test } from "bun:test";
import { captureAsyncOutput } from "../helpers/output.ts";

test("shared output capture restores leaked process.exitCode", async () => {
  await captureAsyncOutput(async () => {
    process.exitCode = 2;
  });

  expect(process.exitCode ?? 0).toBe(0);
});

test("later passing tests still see a clean exit state", () => {
  expect(process.exitCode ?? 0).toBe(0);
  expect(true).toBe(true);
});
