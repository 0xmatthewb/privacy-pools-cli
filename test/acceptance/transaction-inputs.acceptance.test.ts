import { expect } from "bun:test";
import { JSON_SCHEMA_VERSION } from "../../src/utils/json.ts";
import {
  assertExit,
  assertJson,
  assertJsonEnvelopeStep,
  assertStderr,
  assertStderrEmpty,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
  seedHome,
} from "./framework.ts";

const assetAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

function assertInputJsonFailure(message: string) {
  return [
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; code?: string; message: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain(message);
    }),
  ] as const;
}

function assertRpcPoolResolutionFailure(assetOrPool: string) {
  return [
    assertExit(3),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      errorCode: string;
      error: { category: string; code: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("RPC_POOL_RESOLUTION_FAILED");
      expect(json.error.category).toBe("RPC");
      expect(json.error.code).toBe("RPC_POOL_RESOLUTION_FAILED");
      expect(json.error.message).toContain(
        `Failed to resolve pool for ${assetOrPool}`,
      );
    }),
  ] as const;
}

function assertInputErrorEnvelope() {
  return [
    assertExit(2),
    assertStderrEmpty(),
    assertJsonEnvelopeStep({
      success: false,
      errorCode: "INPUT_ERROR",
    }),
    assertJson<{
      error: { category: string; code: string };
    }>((json) => {
      expect(json.error.category).toBe("INPUT");
      expect(json.error.code).toBe("INPUT_ERROR");
    }),
  ] as const;
}

defineScenarioSuite("transaction inputs acceptance", [
  defineScenario("missing transaction inputs stay machine-readable in JSON mode", [
    seedHome("sepolia"),
    runCliStep(["--json", "deposit", "0.1", "--yes"], { timeoutMs: 10_000 }),
    ...assertInputJsonFailure("No asset specified"),
    runCliStep(["--json", "withdraw", "0.1", "--yes"], { timeoutMs: 10_000 }),
    ...assertInputJsonFailure("Relayed withdrawals require --to"),
    runCliStep(["--json", "exit", "--yes"], { timeoutMs: 10_000 }),
    ...assertInputJsonFailure("No asset specified"),
  ]),
  defineScenario("unsigned transaction commands keep the INPUT_ERROR contract", [
    seedHome("sepolia"),
    runCliStep(["deposit", "0.1", "--unsigned"], { timeoutMs: 10_000 }),
    ...assertInputErrorEnvelope(),
    runCliStep(["withdraw", "0.1", "--unsigned"], { timeoutMs: 10_000 }),
    ...assertInputErrorEnvelope(),
  ]),
  defineScenario("machine mode fails fast without prompting for a missing asset", [
    seedHome("sepolia"),
    runCliStep(["--json", "deposit", "0.1"], { timeoutMs: 10_000 }),
    assertExit(2),
    assertStderr((stderr) => {
      expect(stderr).not.toContain("Select asset to deposit");
    }),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("No asset specified");
    }),
    runCliStep(["--json", "withdraw", "0.1", "--direct"], {
      timeoutMs: 10_000,
    }),
    assertExit(2),
    assertStderr((stderr) => {
      expect(stderr).not.toContain("Select asset to withdraw");
    }),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("No asset specified");
    }),
    runCliStep(["--json", "exit"], { timeoutMs: 10_000 }),
    assertExit(2),
    assertStderr((stderr) => {
      expect(stderr).not.toContain("Select asset pool for ragequit");
    }),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("No asset specified");
    }),
  ]),
  defineScenario("negative deposit amounts fail with the standard positive-amount validation", [
    seedHome("sepolia"),
    runCliStep(["--json", "deposit", "-1", "ETH", "--yes"], {
      timeoutMs: 10_000,
    }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      errorCode: string;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain(
        "Deposit amount must be greater than zero",
      );
      expect(json.error.message).not.toContain(
        "Could not infer amount/asset positional arguments",
      );
    }),
  ]),
  defineScenario("positional aliases and ambiguity guards stay stable", [
    seedHome("mainnet"),
    runCliStep(
      [
        "--json",
        "--chain",
        "mainnet",
        "--rpc-url",
        "http://127.0.0.1:9",
        "deposit",
        assetAddress,
        "0.1",
        "--yes",
      ],
      { timeoutMs: 10_000 },
    ),
    ...assertRpcPoolResolutionFailure(assetAddress),
    runCliStep(
      [
        "--json",
        "--chain",
        "mainnet",
        "--rpc-url",
        "http://127.0.0.1:9",
        "withdraw",
        assetAddress,
        "0.1",
        "--direct",
        "--yes",
        "--yes-i-understand-privacy-loss",
      ],
      { timeoutMs: 10_000 },
    ),
    ...assertRpcPoolResolutionFailure(assetAddress),
    runCliStep(
      [
        "--json",
        "--chain",
        "mainnet",
        "--rpc-url",
        "http://127.0.0.1:9",
        "ragequit",
        assetAddress,
        "--yes",
      ],
      { timeoutMs: 10_000 },
    ),
    ...assertRpcPoolResolutionFailure(assetAddress),
    runCliStep(
      ["--json", "deposit", "0.1", "--asset", "ETH", "--yes"],
      {
        timeoutMs: 10_000,
      },
    ),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("--asset has been replaced");
    }),
  ]),
  defineScenario("pre-network transaction guards reject malformed selectors before RPC work", [
    seedHome("sepolia"),
    runCliStep(
      [
        "--json",
        "withdraw",
        "0.1",
        "ETH",
        "--to",
        "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
        "--pool-account",
        "not-a-pa",
        "--chain",
        "sepolia",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("Invalid --pool-account");
    }),
    runCliStep(
      [
        "--json",
        "withdraw",
        "0.1",
        "ETH",
        "--direct",
        "--to",
        "0x0000000000000000000000000000000000000001",
        "--chain",
        "sepolia",
        "--yes-i-understand-privacy-loss",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("must match your signer address");
    }),
    runCliStep(
      [
        "--json",
        "ragequit",
        "ETH",
        "--pool-account",
        "not-a-pa",
        "--chain",
        "sepolia",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("Invalid --pool-account");
    }),
    runCliStep(
      [
        "--json",
        "ragequit",
        "ETH",
        "--pool-account",
        "PA-1",
        "--commitment",
        "0",
        "--chain",
        "sepolia",
      ],
      { timeoutMs: 10_000 },
    ),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain(
        "Cannot use --pool-account and --commitment together",
      );
    }),
  ]),
]);
