import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import {
  launchFixtureServer,
  killFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";

const DEFAULT_RECIPIENT = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const SECONDS_EXPIRY_RECIPIENT = "0x0000000000000000000000000000000000000001";
const MALFORMED_FEE_RECIPIENT = "0x0000000000000000000000000000000000000002";

let fixture: FixtureServer;

beforeAll(async () => {
  fixture = await launchFixtureServer();
});

afterAll(async () => {
  await killFixtureServer(fixture);
});

function fixtureEnv() {
  return {
    PRIVACY_POOLS_ASP_HOST: fixture.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: fixture.url,
    PRIVACY_POOLS_RELAYER_HOST_SEPOLIA: fixture.url,
  };
}

describe("withdraw quote integration", () => {
  test("returns a semantic relayer quote payload when recipient is provided", () => {
    const result = runCli(
      [
        "--json",
        "--chain",
        "sepolia",
        "withdraw",
        "quote",
        "0.1",
        "--asset",
        "ETH",
        "--to",
        DEFAULT_RECIPIENT,
      ],
      { home: createSeededHome("sepolia"), timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      mode: string;
      chain: string;
      asset: string;
      amount: string;
      recipient: string | null;
      minWithdrawAmount: string;
      minWithdrawAmountFormatted: string;
      quoteFeeBPS: string;
      feeAmount: string;
      netAmount: string;
      feeCommitmentPresent: boolean;
      quoteExpiresAt: string | null;
      extraGas?: boolean;
      nextActions?: Array<{
        command: string;
        runnable?: boolean;
        options?: Record<string, unknown>;
      }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.mode).toBe("relayed-quote");
    expect(json.chain).toBe("sepolia");
    expect(json.asset).toBe("ETH");
    expect(json.amount).toBe("100000000000000000");
    expect(json.recipient).toBe(DEFAULT_RECIPIENT);
    expect(json.minWithdrawAmount).toBe("1000000000000000");
    expect(json.minWithdrawAmountFormatted).toBe("0.001 ETH");
    expect(json.quoteFeeBPS).toBe("250");
    expect(json.feeAmount).toBe("2500000000000000");
    expect(json.netAmount).toBe("97500000000000000");
    expect(json.feeCommitmentPresent).toBe(true);
    expect(json.quoteExpiresAt).toBe("2100-01-01T00:00:00.000Z");
    expect(json.extraGas).toBe(false);
    expect(json.nextActions?.[0]?.command).toBe("withdraw");
    expect(json.nextActions?.[0]?.runnable).not.toBe(false);
    expect(json.nextActions?.[0]?.options).toMatchObject({
      agent: true,
      chain: "sepolia",
      to: DEFAULT_RECIPIENT,
      extraGas: false,
    });
  });

  test("omits runnable follow-up until a recipient is supplied", () => {
    const result = runCli(
      ["--json", "--chain", "sepolia", "withdraw", "quote", "0.1", "--asset", "ETH"],
      { home: createSeededHome("sepolia"), timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      recipient: string | null;
      nextActions?: Array<{ runnable?: boolean; options?: Record<string, unknown> }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.recipient).toBeNull();
    expect(json.nextActions?.[0]?.runnable).toBe(false);
    expect(json.nextActions?.[0]?.options).toMatchObject({
      agent: true,
      chain: "sepolia",
      extraGas: false,
    });
    expect(json.nextActions?.[0]?.options).not.toHaveProperty("to");
  });

  test("normalizes second-based quote expirations into ISO timestamps", () => {
    const result = runCli(
      [
        "--json",
        "--chain",
        "sepolia",
        "withdraw",
        "quote",
        "0.1",
        "--asset",
        "ETH",
        "--to",
        SECONDS_EXPIRY_RECIPIENT,
      ],
      { home: createSeededHome("sepolia"), timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      quoteExpiresAt: string | null;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.quoteExpiresAt).toBe("2100-01-01T00:00:00.000Z");
  });

  test("surfaces malformed relayer quote payloads as RELAYER errors", () => {
    const result = runCli(
      [
        "--json",
        "--chain",
        "sepolia",
        "withdraw",
        "quote",
        "0.1",
        "--asset",
        "ETH",
        "--to",
        MALFORMED_FEE_RECIPIENT,
      ],
      { home: createSeededHome("sepolia"), timeoutMs: 15_000, env: fixtureEnv() },
    );
    expect(result.status).toBe(5);

    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      error: { category: string; message: string };
    }>(result.stdout);

    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("RELAYER_ERROR");
    expect(json.error.category).toBe("RELAYER");
    expect(json.error.message).toContain("unexpected quote response");
  });
});
