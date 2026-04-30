import { describe, expect, test } from "bun:test";
import { nativeTestInternals } from "../helpers/native.ts";

function normalize(path: string): string {
  return path.replaceAll("\\", "/");
}

describe("native helper staleness inputs", () => {
  test("native build inputs include nested rust sources", () => {
    const inputs = nativeTestInternals.nativeBuildInputs().map(normalize);

    expect(
      inputs.some((path) => path.endsWith("/native/shell/src/root_argv.rs")),
    ).toBe(true);
    expect(
      inputs.some((path) =>
        path.endsWith("/native/shell/src/commands/pools/query.rs"),
      ),
    ).toBe(true);
    expect(
      inputs.some((path) =>
        path.endsWith("/native/shell/src/commands/pools/activity/mod.rs"),
      ),
    ).toBe(true);
  });
});
