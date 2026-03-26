import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CHAINS } from "../../src/config/chains.ts";
import {
  TEST_MNEMONIC,
  createTempHome,
  parseJsonOutput,
  runCli,
  writeTestSecretFiles,
} from "../helpers/cli.ts";
import {
  launchFixtureServer,
  killFixtureServer,
  type FixtureServer,
} from "../helpers/fixture-server.ts";
import {
  killSyncGateRpcServer,
  launchSyncGateRpcServer,
  type SyncGateRpcServer,
} from "../helpers/sync-gate-rpc-server.ts";

const sepoliaChainConfig = CHAINS.sepolia;
const mockPoolAddress = "0x1234567890abcdef1234567890abcdef12345678" as const;
const mockScope = 12345n;

let fixture: FixtureServer;
let rpcServer: SyncGateRpcServer;

function deriveLegacyDepositPrecommitment(
  mnemonic: string,
  scope: bigint,
  index: bigint,
): bigint {
  const legacyPrivacyPoolAccount = (
    AccountService as unknown as {
      _initializeLegacyAccount(inputMnemonic: string): ConstructorParameters<
        typeof AccountService
      >[1]["account"];
    }
  )._initializeLegacyAccount(mnemonic);
  const legacyService = new AccountService(
    {} as ConstructorParameters<typeof AccountService>[0],
    { account: legacyPrivacyPoolAccount },
  );
  return legacyService.createDepositSecrets(scope, index).precommitment;
}

beforeAll(async () => {
  fixture = await launchFixtureServer();
  rpcServer = await launchSyncGateRpcServer({
    chainId: sepoliaChainConfig.id,
    entrypoint: sepoliaChainConfig.entrypoint,
    poolAddress: mockPoolAddress,
    scope: mockScope,
    depositCommitment: 1n,
    depositLabel: 2n,
    depositValue: 3n,
    depositPrecommitment: deriveLegacyDepositPrecommitment(
      TEST_MNEMONIC,
      mockScope,
      0n,
    ),
  });
}, 240_000);

afterAll(async () => {
  if (rpcServer) {
    await killSyncGateRpcServer(rpcServer);
  }
  if (fixture) {
    await killFixtureServer(fixture);
  }
});

describe("migrate status", () => {
  test("reports legacy migration readiness without persisting trusted account state", () => {
    const home = createTempHome();
    const { mnemonicPath, privateKeyPath } = writeTestSecretFiles(home);

    const initResult = runCli(
      [
        "--json",
        "init",
        "--mnemonic-file",
        mnemonicPath,
        "--private-key-file",
        privateKeyPath,
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home,
        timeoutMs: 60_000,
      },
    );
    expect(initResult.status).toBe(0);

    const result = runCli(
      ["--json", "--chain", "sepolia", "migrate", "status"],
      {
        home,
        timeoutMs: 30_000,
        env: {
          PRIVACY_POOLS_ASP_HOST: fixture.url,
          PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcServer.url,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      mode: string;
      chain: string;
      status: string;
      requiresMigration: boolean;
      requiresWebsiteRecovery: boolean;
      isFullyMigrated: boolean;
      readinessResolved: boolean;
      submissionSupported: boolean;
      warnings?: Array<{
        category: string;
        message: string;
      }>;
      chainReadiness: Array<{
        chain: string;
        status: string;
        candidateLegacyCommitments: number;
        expectedLegacyCommitments: number;
        migratedCommitments: number;
        legacySpendableCommitments: number;
        reviewStatusComplete: boolean;
      }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.mode).toBe("migration-status");
    expect(json.chain).toBe("sepolia");
    expect(json.status).toBe("migration_required");
    expect(json.requiresMigration).toBe(true);
    expect(json.requiresWebsiteRecovery).toBe(false);
    expect(json.isFullyMigrated).toBe(false);
    expect(json.readinessResolved).toBe(true);
    expect(json.submissionSupported).toBe(false);
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "COVERAGE",
          message: expect.stringContaining("supported by the CLI"),
        }),
      ]),
    );
    expect(json.chainReadiness).toHaveLength(1);
    expect(json.chainReadiness[0]).toMatchObject({
      chain: "sepolia",
      status: "migration_required",
      candidateLegacyCommitments: 1,
      expectedLegacyCommitments: 1,
      migratedCommitments: 0,
      legacySpendableCommitments: 1,
      reviewStatusComplete: true,
    });

    expect(
      existsSync(
        join(home, ".privacy-pools", "accounts", `${sepoliaChainConfig.id}.json`),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(home, ".privacy-pools", "accounts", `${sepoliaChainConfig.id}.sync.json`),
      ),
    ).toBe(false);
  }, 60_000);

  test("degrades to review_incomplete when ASP review data is unavailable", () => {
    const home = createTempHome();
    const { mnemonicPath, privateKeyPath } = writeTestSecretFiles(home);

    const initResult = runCli(
      [
        "--json",
        "init",
        "--mnemonic-file",
        mnemonicPath,
        "--private-key-file",
        privateKeyPath,
        "--default-chain",
        "sepolia",
        "--yes",
      ],
      {
        home,
        timeoutMs: 60_000,
      },
    );
    expect(initResult.status).toBe(0);

    const result = runCli(
      ["--json", "--chain", "sepolia", "migrate", "status"],
      {
        home,
        timeoutMs: 30_000,
        env: {
          PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
          PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcServer.url,
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      status: string;
      requiresMigration: boolean;
      readinessResolved: boolean;
      warnings?: Array<{
        category: string;
        message: string;
      }>;
      chainReadiness: Array<{
        status: string;
        reviewStatusComplete: boolean;
      }>;
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.status).toBe("review_incomplete");
    expect(json.requiresMigration).toBe(true);
    expect(json.readinessResolved).toBe(false);
    expect(json.chainReadiness).toHaveLength(1);
    expect(json.chainReadiness[0]).toMatchObject({
      status: "review_incomplete",
      reviewStatusComplete: false,
    });
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "ASP",
          message: expect.stringContaining("legacy ASP review data was unavailable"),
        }),
        expect.objectContaining({
          category: "COVERAGE",
          message: expect.stringContaining("supported by the CLI"),
        }),
      ]),
    );
  }, 60_000);
});
