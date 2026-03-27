import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CliRunOptions, CliRunResult } from "../helpers/cli.ts";
import {
  CLI_CWD,
  TEST_MNEMONIC,
  TEST_PRIVATE_KEY,
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
  runBuiltCli,
} from "../helpers/cli.ts";
import {
  type FixtureServer,
  killFixtureServer,
  launchFixtureServer,
} from "../helpers/fixture-server.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import {
  CARGO_AVAILABLE,
  ensureNativeShellBinary,
} from "../helpers/native.ts";

const TEST_RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const nativeTest = CARGO_AVAILABLE ? test : test.skip;

interface ForwardingParityCase {
  label: string;
  args: string[];
  envFactory?: (fixture: FixtureServer) => Record<string, string>;
}

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

function runNativeBinaryDirect(
  nativeBinary: string,
  args: string[],
  options: CliRunOptions = {},
): CliRunResult {
  const home = options.home ?? createTempHome("pp-native-direct-");
  const timeoutMs = options.timeoutMs ?? 20_000;
  const cwd = options.cwd ?? CLI_CWD;
  const start = Date.now();
  const result = spawnSync(nativeBinary, args, {
    cwd,
    env: buildChildProcessEnv({
      PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
      ...options.env,
    }),
    encoding: "utf8",
    input: options.input,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  const elapsedMs = Date.now() - start;
  const timedOut =
    result.status === null &&
    result.signal === "SIGTERM" &&
    typeof result.error?.message === "string" &&
    result.error.message.includes("ETIMEDOUT");

  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    elapsedMs,
    timedOut,
    errorMessage: result.error?.message,
  };
}

function withJsFallback(options: CliRunOptions = {}): CliRunOptions {
  return {
    ...options,
    env: {
      ...options.env,
      PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
    },
  };
}

function expectStreamParity(
  nativeBinary: string,
  args: string[],
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runBuiltCli(args, withJsFallback(options.js));
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
  const jsResult = runBuiltCli(args, withJsFallback(options.js));
  const nativeResult = runNativeBuiltCli(nativeBinary, args, options.native);

  expect(nativeResult.status).toBe(jsResult.status);
  expect(parseJsonOutput(nativeResult.stdout)).toEqual(
    parseJsonOutput(jsResult.stdout),
  );
  expect(nativeResult.stderr).toBe(jsResult.stderr);
}

function expectSourceJsonParity(
  nativeBinary: string,
  args: string[],
  options: {
    js?: CliRunOptions;
    native?: CliRunOptions;
  } = {},
): void {
  const jsResult = runCli(args, options.js);
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

  nativeTest("version output stays identical across launcher and native shell", () => {
    expectStreamParity(nativeBinary, ["--version"]);
    expectJsonParity(nativeBinary, ["--json", "--version"]);
  });

  nativeTest("structured root help stays machine-readable", () => {
    expectJsonParity(nativeBinary, ["--json", "--help"]);
  });

  nativeTest("root argv parsing stops at -- consistently across JS and native", () => {
    expectJsonParity(nativeBinary, ["--json", "--", "status", "--json"]);
  });

  nativeTest("subcommand help is manifest-driven but output-identical", () => {
    expectStreamParity(nativeBinary, ["withdraw", "quote", "--help"]);
  });

  nativeTest("guide, capabilities, and structured describe outputs stay identical", () => {
    expectStreamParity(nativeBinary, ["guide"]);
    expectJsonParity(nativeBinary, ["--agent", "guide"]);
    expectStreamParity(nativeBinary, ["capabilities"]);
    expectJsonParity(nativeBinary, ["--agent", "capabilities"]);
    expectJsonParity(nativeBinary, ["--agent", "describe", "stats", "global"]);
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
    expectStreamParity(nativeBinary, [
      "completion",
      "--query",
      "--shell",
      "bash",
      "--cword",
      "3",
      "--",
      "privacy-pools",
      "deposit",
      "--unsigned",
      "",
    ]);
  });

  nativeTest("status --agent --no-check stays JS-owned through native forwarding", () => {
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

  nativeTest("status --agent --check stays JS-owned through native forwarding", () => {
    const home = createTempHome("pp-native-status-check-");
    mustInitSeededHome(home, "sepolia");

    expectJsonParity(
      nativeBinary,
      [
        "--agent",
        "--chain",
        "sepolia",
        "--rpc-url",
        "http://127.0.0.1:9",
        "status",
        "--check",
      ],
      {
        js: {
          home,
          env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" },
        },
        native: {
          home,
          env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" },
        },
      },
    );
  });

  nativeTest("public read-only agent paths stay JSON-identical on fixture data", () => {
    const env = fixtureEnv(fixture!);
    expectJsonParity(nativeBinary, ["--agent", "stats"], {
      js: { env },
      native: { env },
    });
    expectJsonParity(
      nativeBinary,
      ["--agent", "--chain", "sepolia", "stats", "pool", "--asset", "ETH"],
      {
        js: { env },
        native: { env },
      },
    );
    expectJsonParity(nativeBinary, ["--agent", "activity"], {
      js: { env },
      native: { env },
    });
    expectJsonParity(nativeBinary, ["--agent", "--chain", "sepolia", "pools"], {
      js: { env },
      native: { env },
    });
  });

  nativeTest("offline public envelopes and degraded pool discovery stay aligned", () => {
    expectSourceJsonParity(nativeBinary, ["--json", "--chain", "mainnet", "activity"], {
      js: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
      native: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
    });
    expectSourceJsonParity(
      nativeBinary,
      ["--json", "--chain", "mainnet", "stats", "pool", "--asset", "ETH"],
      {
        js: {
          env: {
            PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
            PRIVACY_POOLS_RPC_URL_ETHEREUM: "http://127.0.0.1:9",
          },
        },
        native: {
          env: {
            PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
            PRIVACY_POOLS_RPC_URL_ETHEREUM: "http://127.0.0.1:9",
          },
        },
      },
    );
    expectSourceJsonParity(
      nativeBinary,
      ["--json", "--chain", "sepolia", "stats", "pool", "--asset", "ETH"],
      {
        js: {
          env: {
            PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
            PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture!.url,
          },
        },
        native: {
          env: {
            PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
            PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture!.url,
          },
        },
      },
    );
    expectSourceJsonParity(nativeBinary, ["--json", "stats"], {
      js: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
      native: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
    });
    expectSourceJsonParity(nativeBinary, ["--json", "--chain", "sepolia", "pools"], {
      js: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
      native: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
    });
    expectSourceJsonParity(
      nativeBinary,
      ["--json", "--chain", "sepolia", "pools"],
      {
        js: {
          env: {
            PRIVACY_POOLS_ASP_HOST: fixture!.url,
            PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
          },
        },
        native: {
          env: {
            PRIVACY_POOLS_ASP_HOST: fixture!.url,
            PRIVACY_POOLS_RPC_URL_SEPOLIA: "http://127.0.0.1:9",
          },
        },
      },
    );
  });

  nativeTest("stats pool stays native-owned when option values follow the command path", () => {
    const args = ["--json", "--chain", "sepolia", "stats", "pool", "--asset", "ETH"];
    const env = {
      PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
      PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture!.url,
    };

    const jsResult = runCli(args, { env });
    const directNativeResult = runNativeBinaryDirect(nativeBinary, args, { env });

    expect(directNativeResult.status).toBe(jsResult.status);
    expect(parseJsonOutput(directNativeResult.stdout)).toEqual(
      parseJsonOutput(jsResult.stdout),
    );
    expect(directNativeResult.stderr).toBe(jsResult.stderr);
  });

  nativeTest("stats pool input validation stays identical through the native path", () => {
    expectSourceJsonParity(
      nativeBinary,
      ["--json", "stats", "pool", "--chain", "sepolia"],
      {
        js: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
        native: { env: { PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9" } },
      },
    );
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

  const forwardingCases: ForwardingParityCase[] = [
    {
      label: "pools detail",
      args: ["--agent", "--chain", "sepolia", "pools", "ETH"],
      envFactory: fixtureEnv,
    },
    {
      label: "flow status latest",
      args: ["--agent", "flow", "status", "latest"],
    },
    {
      label: "flow watch latest",
      args: ["--agent", "flow", "watch", "latest"],
    },
    {
      label: "flow ragequit latest",
      args: ["--agent", "flow", "ragequit", "latest"],
    },
    {
      label: "flow start",
      args: ["--agent", "flow", "start", "0.1", "ETH", "--to", TEST_RECIPIENT],
    },
    {
      label: "deposit",
      args: ["--agent", "deposit", "0.1", "ETH"],
    },
    {
      label: "withdraw quote",
      args: [
        "--agent",
        "--chain",
        "not-a-chain",
        "withdraw",
        "quote",
        "0.1",
        "ETH",
        "--to",
        TEST_RECIPIENT,
      ],
    },
    {
      label: "withdraw",
      args: ["--agent", "withdraw", "0.1", "ETH", "--to", TEST_RECIPIENT],
    },
    {
      label: "ragequit",
      args: ["--agent", "ragequit", "ETH", "--from-pa", "PA-1"],
    },
    {
      label: "accounts",
      args: ["--agent", "accounts"],
    },
    {
      label: "history",
      args: ["--agent", "history"],
    },
    {
      label: "sync",
      args: ["--agent", "sync"],
    },
    {
      label: "migrate status",
      args: ["--agent", "migrate", "status"],
    },
  ];

  for (const { label, args, envFactory } of forwardingCases) {
    nativeTest(`${label} stays identical through native forwarding`, () => {
      const jsHome = createTempHome(`pp-native-${label.replaceAll(" ", "-")}-js-`);
      const nativeHome = createTempHome(
        `pp-native-${label.replaceAll(" ", "-")}-native-`,
      );
      const env = envFactory ? envFactory(fixture!) : undefined;

      expectJsonParity(nativeBinary, args, {
        js: { home: jsHome, env },
        native: { home: nativeHome, env },
      });
    });
  }
});
