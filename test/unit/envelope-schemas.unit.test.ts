import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cliEnvelopeSchema,
  errorEnvelopeSchema,
  successEnvelopeSchema,
} from "../../src/types/envelopes/common.ts";
import { commandEnvelopeSchemas } from "../../src/types/envelopes/commands.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

function readGoldenJson(path: string): unknown {
  const raw = readFileSync(join(CLI_ROOT, "test", "golden", path), "utf8");
  return JSON.parse(raw.replace(/^\/\/.*\n/u, ""));
}

function readGeneratedSchema(path: string): string {
  return readFileSync(join(CLI_ROOT, "schemas", path), "utf8");
}

describe("CLI envelope schemas", () => {
  test("accepts a success envelope with nextActions", () => {
    expect(() =>
      successEnvelopeSchema.parse({
        schemaVersion: "3.0.0",
        success: true,
        mode: "status",
        operation: "status",
        nextActions: [
          {
            command: "status",
            reason: "Verify setup.",
            when: "after_upgrade",
            cliCommand: "privacy-pools status --agent",
          },
        ],
      }),
    ).not.toThrow();
  });

  test("accepts an error envelope with canonical aliases", () => {
    const parsed = errorEnvelopeSchema.parse({
      schemaVersion: "3.0.0",
      success: false,
      errorCode: "INPUT_FLAG_CONFLICT",
      errorMessage: "Choose either JSON or CSV output, not both.",
      error: {
        code: "INPUT_FLAG_CONFLICT",
        category: "INPUT",
        message: "Choose either JSON or CSV output, not both.",
        hint: "Use --json/--agent for JSON, or remove JSON flags and use --output csv.",
        retryable: false,
      },
    });

    expect(parsed.error.code).toBe(parsed.errorCode);
  });

  test("rejects envelopes without a success discriminator", () => {
    expect(() =>
      cliEnvelopeSchema.parse({
        schemaVersion: "3.0.0",
        mode: "status",
      }),
    ).toThrow();
  });

  test("per-command schemas validate high-traffic success payloads", () => {
    const samples: Record<string, unknown> = {
      accounts: {
        schemaVersion: "3.0.0",
        success: true,
        mode: "accounts",
        operation: "accounts",
        chain: "mainnet",
        accounts: [],
        balances: [],
        pendingCount: 0,
      },
      capabilities: readGoldenJson("capabilities/agent.golden.json"),
      deposit: {
        schemaVersion: "3.0.0",
        success: true,
        mode: "deposit",
        operation: "deposit",
        status: "confirmed",
        txHash: "0xabc",
        amount: "100000000000000000",
        asset: "ETH",
        chain: "sepolia",
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        poolAddress: "0x1111111111111111111111111111111111111111",
        scope: "12345",
        blockNumber: "1",
        explorerUrl: "https://example.invalid/tx/0xabc",
      },
      pools: readGoldenJson("pools/sepolia-agent.golden.json"),
      "pools stats": readGoldenJson("pools/stats-pool-sepolia-agent.golden.json"),
      status: {
        schemaVersion: "3.0.0",
        success: true,
        mode: "status",
        operation: "status",
        configExists: false,
        configDir: null,
        defaultChain: null,
        selectedChain: null,
        rpcUrl: null,
        recoveryPhraseSet: false,
        signerKeySet: false,
        signerKeyValid: false,
        signerAddress: null,
        entrypoint: null,
        aspHost: null,
        readyForDeposit: false,
        readyForWithdraw: false,
        readyForUnsigned: false,
        recommendedMode: "setup_required",
        configHomeWritabilityIssue: {
          code: "home_not_writable",
          message:
            "Config home /tmp/readonly/.privacy-pools is not writable. Init cannot persist your recovery phrase or signer key.",
          affects: ["deposit", "withdraw", "unsigned"],
          reasonCode: "parent_readonly",
        },
        blockingIssues: [],
        warnings: [],
      },
      withdraw: {
        schemaVersion: "3.0.0",
        success: true,
        operation: "withdraw",
        status: "confirmed",
        mode: "withdraw",
        withdrawMode: "relayed",
        txHash: "0xabc",
        amount: "99500000000000000",
        recipient: "0x2222222222222222222222222222222222222222",
        asset: "ETH",
        chain: "sepolia",
        poolAccountNumber: 1,
        poolAccountId: "PA-1",
        poolAddress: "0x1111111111111111111111111111111111111111",
        scope: "12345",
        feeBPS: "50",
        remainingBalance: "0",
        blockNumber: "1",
        explorerUrl: "https://example.invalid/tx/0xabc",
      },
    };

    for (const [command, sample] of Object.entries(samples)) {
      expect(() =>
        commandEnvelopeSchemas[command as keyof typeof commandEnvelopeSchemas].parse(sample),
      ).not.toThrow();
    }
  });

  test("per-command schemas reject payloads missing command-specific fields", () => {
    expect(() =>
      commandEnvelopeSchemas.status.parse({
        schemaVersion: "3.0.0",
        success: true,
      }),
    ).toThrow();

    expect(() =>
      commandEnvelopeSchemas.pools.parse({
        schemaVersion: "3.0.0",
        success: true,
        pools: [],
      }),
    ).toThrow();
  });

  test("generated schema artifacts include command-specific payload fields", () => {
    expect(readGeneratedSchema("status.schema.json")).toContain("configExists");
    expect(readGeneratedSchema("pools.schema.json")).toContain("totalInPoolValue");
    expect(readGeneratedSchema("capabilities.schema.json")).toContain("commandDetails");
  });
});
