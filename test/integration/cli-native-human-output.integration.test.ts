import { afterAll, beforeAll, describe } from "bun:test";
import {
  type FixtureServer,
  killFixtureServer,
  launchFixtureServer,
} from "../helpers/fixture-server.ts";
import {
  ensureNativeShellBinary,
  expectContractParity,
  nativeTest,
  fixtureEnv,
} from "../helpers/native-shell.ts";
import {
  expectSemanticText,
  expectStderrOnly,
  expectStdoutOnly,
} from "../helpers/contract-assertions.ts";

describe("native human-output smoke", () => {
  let nativeBinary: string;
  let fixture: FixtureServer | null = null;

  beforeAll(async () => {
    nativeBinary = ensureNativeShellBinary();
    fixture = await launchFixtureServer();
  }, 240_000);

  afterAll(async () => {
    if (fixture) {
      await killFixtureServer(fixture);
    }
  });

  nativeTest("root help keeps stdout ownership and command-family cues", () => {
    expectContractParity(nativeBinary, ["--help"], (result) => {
      expectStdoutOnly(result);
      expectSemanticText(result.stdout, {
        includes: ["privacy-pools", "deposit", "withdraw", "completion"],
      });
    });
  });

  nativeTest("version output stays semantic and stdout-owned", () => {
    expectContractParity(nativeBinary, ["--version"], (result) => {
      expectStdoutOnly(result);
      expectSemanticText(result.stdout, {
        patterns: [/^\d+\.\d+\.\d+$/m],
      });
    });
  });

  nativeTest("subcommand help remains semantic without pinning the full transcript", () => {
    expectContractParity(nativeBinary, ["withdraw", "quote", "--help"], (result) => {
      expectStdoutOnly(result);
      expectSemanticText(result.stdout, {
        includes: ["withdraw quote", "--chain", "--to"],
      });
    });
  });

  nativeTest("guide and describe human outputs preserve stream ownership and section cues", () => {
    expectContractParity(
      nativeBinary,
      ["guide"],
      (result) => {
        expectStderrOnly(result);
        expectSemanticText(result.stderr, {
          includes: ["privacy-pools init", "privacy-pools flow start"],
          excludes: ["JS worker bootstrap is unavailable"],
        });
      },
    );

    expectContractParity(
      nativeBinary,
      ["describe", "protocol-stats"],
      (result) => {
        expectStderrOnly(result);
        expectSemanticText(result.stderr, {
          includes: ["protocol-stats", "JSON fields", "Examples:"],
        });
      },
    );
  });

  nativeTest("public read-only human outputs keep semantic section markers and stderr ownership", () => {
    const env = fixtureEnv(fixture!);

    expectContractParity(nativeBinary, ["stats"], (result) => {
      expectStderrOnly(result);
      expectSemanticText(result.stderr, {
        includes: ["All Time", "Last 24h"],
      });
    }, {
      js: { env },
      native: { env },
    });

    expectContractParity(
      nativeBinary,
      ["--chain", "sepolia", "pools"],
      (result) => {
        expectStderrOnly(result);
        expectSemanticText(result.stderr, {
          includes: ["Summary:", "Next steps:"],
        });
      },
      {
        js: { env },
        native: { env },
      },
    );
  }, 20_000);
}, 300_000);
