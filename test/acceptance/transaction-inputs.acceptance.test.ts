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

defineScenarioSuite("transaction inputs acceptance", [
  defineScenario("missing transaction inputs stay machine-readable in JSON mode", [
    seedHome("sepolia"),
    runCliStep(["--json", "deposit", "0.1", "--yes"], { timeoutMs: 10_000 }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("No asset specified");
    }),
    runCliStep(["--json", "withdraw", "0.1", "--yes"], { timeoutMs: 10_000 }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("Relayed withdrawals require --to");
    }),
    runCliStep(["--json", "ragequit", "--yes"], { timeoutMs: 10_000 }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("No asset specified");
    }),
    runCliStep(["--json", "exit", "--yes"], { timeoutMs: 10_000 }),
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      schemaVersion: string;
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.schemaVersion).toBe(JSON_SCHEMA_VERSION);
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain("No asset specified");
    }),
  ]),
  defineScenario("unsigned transaction commands keep the INPUT_ERROR contract", [
    seedHome("sepolia"),
    runCliStep(["deposit", "0.1", "--unsigned"], { timeoutMs: 10_000 }),
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
    runCliStep(["withdraw", "0.1", "--unsigned"], { timeoutMs: 10_000 }),
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
    runCliStep(["ragequit", "--unsigned"], { timeoutMs: 10_000 }),
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
    runCliStep(["--json", "ragequit"], { timeoutMs: 10_000 }),
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
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain(
        `No pool found for asset ${assetAddress}`,
      );
    }),
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
        `No pool found for asset ${assetAddress}`,
      );
    }),
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
    assertExit(2),
    assertStderrEmpty(),
    assertJson<{
      success: boolean;
      error: { category: string; message: string };
    }>((json) => {
      expect(json.success).toBe(false);
      expect(json.error.category).toBe("INPUT");
      expect(json.error.message).toContain(
        `No pool found for asset ${assetAddress}`,
      );
    }),
    runCliStep(
      ["--json", "deposit", "ETH", "0.1", "--asset", "ETH", "--yes"],
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
      expect(json.error.message).toContain("Ambiguous positional arguments");
    }),
  ]),
  defineScenario("pre-network transaction guards reject malformed selectors before RPC work", [
    seedHome("sepolia"),
    runCliStep(
      [
        "--json",
        "withdraw",
        "0.1",
        "--asset",
        "ETH",
        "--to",
        "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
        "--from-pa",
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
      expect(json.error.message).toContain("Invalid --from-pa");
    }),
    runCliStep(
      [
        "--json",
        "withdraw",
        "0.1",
        "--asset",
        "ETH",
        "--direct",
        "--to",
        "0x0000000000000000000000000000000000000001",
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
      expect(json.error.message).toContain("must match your signer address");
    }),
    runCliStep(
      [
        "--json",
        "ragequit",
        "--asset",
        "ETH",
        "--from-pa",
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
      expect(json.error.message).toContain("Invalid --from-pa");
    }),
    runCliStep(
      [
        "--json",
        "ragequit",
        "--asset",
        "ETH",
        "--from-pa",
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
        "Cannot use --from-pa and --commitment together",
      );
    }),
  ]),
]);
