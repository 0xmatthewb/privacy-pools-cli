import { beforeAll, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARGO_AVAILABLE,
  ensureNativeShellBinary,
  expectJsonParity,
  expectStreamParity,
  nativeTest,
} from "../helpers/native-shell.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

interface RootHelpModeFixture {
  argv: string[];
  modes: Array<"stream-parity" | "json-parity">;
}

const ROOT_HELP_MODES = JSON.parse(
  readFileSync(join(CLI_ROOT, "test/fixtures/root-help-modes.json"), "utf8"),
) as RootHelpModeFixture[];

describe("root help parity", () => {
  let nativeBinary: string;

  beforeAll(() => {
    if (!CARGO_AVAILABLE) return;
    nativeBinary = ensureNativeShellBinary();
  }, 240_000);

  for (const fixture of ROOT_HELP_MODES) {
    nativeTest(`root help parity: ${fixture.argv.join(" ")}`, () => {
      for (const mode of fixture.modes) {
        if (mode === "json-parity") {
          expectJsonParity(nativeBinary, fixture.argv);
        } else {
          expectStreamParity(nativeBinary, fixture.argv);
        }
      }
    });
  }
});
