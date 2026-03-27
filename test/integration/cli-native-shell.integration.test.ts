import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CliRunOptions, CliRunResult } from "../helpers/cli.ts";
import {
  TEST_MNEMONIC,
  TEST_PRIVATE_KEY,
  createTempHome,
  parseJsonOutput,
  runBuiltCli,
} from "../helpers/cli.ts";
import {
  type FixtureServer,
  killFixtureServer,
  launchFixtureServer,
} from "../helpers/fixture-server.ts";
import {
  CARGO_AVAILABLE,
  ensureNativeShellBinary,
} from "../helpers/native.ts";

const nativeTest = CARGO_AVAILABLE ? test : test.skip;

function runNativeBuiltCli(
  nativeBinary: string,
  args: string[],
  options: CliRunOptions = {},
): CliRunResult {
  return runBuiltCli(args, {
    ...options,
    env: {
      ...options.env,
      PRIVACY_POOLS_CLI_BINARY: nativeBinary,
    },
  });
}

function expectStreamParity(
  nativeBinary: string,
  args: string[],
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runBuiltCli(args, options.js);
  const nativeResult = runNativeBuiltCli(nativeBinary, args, options.native);

  expect(nativeResult.status).toBe(jsResult.status);
  expect(nativeResult.stdout).toBe(jsResult.stdout);
  expect(nativeResult.stderr).toBe(jsResult.stderr);
}

function expectJsonParity(
  nativeBinary: string,
  args: string[],
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runBuiltCli(args, options.js);
  const nativeResult = runNativeBuiltCli(nativeBinary, args, options.native);

  expect(nativeResult.status).toBe(jsResult.status);
  expect(parseJsonOutput(nativeResult.stdout)).toEqual(
    parseJsonOutput(jsResult.stdout),
  );
  expect(nativeResult.stderr).toBe(jsResult.stderr);
}

function fixtureEnv(fixture: FixtureServer): Record<string, string> {
  return {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
  };
}

describe("native shell parity", () => {
  let nativeBinary: string;
  let fixture: FixtureServer | null = null;

  beforeAll(async () => {
    if (!CARGO_AVAILABLE) return;
    nativeBinary = ensureNativeShellBinary();
    fixture = await launchFixtureServer();
  }, 240_000);

  afterAll(async () => {
    if (fixture) {
      await killFixtureServer(fixture);
    }
  });

  nativeTest("root help matches the JS launcher surface exactly", () => {
    expectStreamParity(nativeBinary, ["--help"]);
  });

  nativeTest("structured root help stays machine-readable", () => {
    expectJsonParity(nativeBinary, ["--json", "--help"]);
  });

  nativeTest("subcommand help is manifest-driven but output-identical", () => {
    expectStreamParity(nativeBinary, ["withdraw", "quote", "--help"]);
  });

  nativeTest("describe human output matches JS without loading the full runtime", () => {
    expectStreamParity(nativeBinary, ["describe", "stats", "global"]);
  });

  nativeTest("completion scripts and query payloads stay identical", () => {
    expectStreamParity(nativeBinary, ["completion", "bash"]);
    expectJsonParity(nativeBinary, [
      "--json",
      "completion",
      "--query",
      "--shell",
      "bash",
      "--cword",
      "1",
      "--",
      "privacy-pools",
    ]);
  });

  nativeTest("status --agent --no-check stays JSON-identical", () => {
    const jsHome = createTempHome("pp-native-status-js-");
    const nativeHome = createTempHome("pp-native-status-native-");
    expectJsonParity(
      nativeBinary,
      ["--agent", "status", "--no-check"],
      {
        js: { home: jsHome },
        native: { home: nativeHome },
      },
    );
  });

  nativeTest("public read-only agent paths stay JSON-identical on fixture data", () => {
    const env = fixtureEnv(fixture!);
    expectJsonParity(nativeBinary, ["--agent", "stats"], {
      js: { env },
      native: { env },
    });
    expectJsonParity(nativeBinary, ["--agent", "activity"], {
      js: { env },
      native: { env },
    });
    expectJsonParity(nativeBinary, ["--agent", "--chain", "sepolia", "pools"], {
      js: { env },
      native: { env },
    });
  });

  nativeTest("JS-owned commands still forward through the native shell unchanged", () => {
    const args = [
      "--agent",
      "init",
      "--mnemonic",
      TEST_MNEMONIC,
      "--private-key",
      TEST_PRIVATE_KEY,
      "--default-chain",
      "sepolia",
      "--yes",
    ];
    const jsHome = createTempHome("pp-native-init-js-");
    const nativeHome = createTempHome("pp-native-init-native-");

    expectJsonParity(nativeBinary, args, {
      js: { home: jsHome },
      native: { home: nativeHome },
    });
  });
});
