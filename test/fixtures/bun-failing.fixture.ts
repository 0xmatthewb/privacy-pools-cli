import { expect, test } from "bun:test";

test("reports a real test failure", () => {
  expect("privacy-pools-cli").toBe("not-the-cli");
});
