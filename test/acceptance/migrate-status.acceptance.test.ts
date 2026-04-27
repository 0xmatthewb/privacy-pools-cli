import { afterAll, beforeAll, expect } from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { join } from "node:path";
import { CHAINS } from "../../src/config/chains.ts";
import { TEST_MNEMONIC } from "../helpers/cli.ts";
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
import {
  assertExit,
  assertFileMissing,
  assertJson,
  defineScenario,
  defineScenarioSuite,
  runCliStep,
} from "./framework.ts";

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

defineScenarioSuite("migrate status acceptance", [
  defineScenario(
    "reports migration readiness without persisting trusted local state",
    [
      (ctx) => {
        ctx.seedConfigHome({
          defaultChain: "sepolia",
          withMnemonic: true,
          withSigner: true,
        });
        ctx.lastResult = {
          status: 0,
          signal: null,
          stdout: "",
          stderr: "",
          elapsedMs: 0,
          timedOut: false,
        };
      },
      assertExit(0),
      (ctx) =>
        runCliStep(["--json", "--chain", "sepolia", "migrate", "status"], {
          timeoutMs: 30_000,
          env: {
            PRIVACY_POOLS_ASP_HOST: fixture.url,
            PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcServer.url,
          },
        })(ctx),
      assertExit(0),
      assertJson<{
        success: boolean;
        mode: string;
        status: string;
        requiresMigration: boolean;
        requiresWebsiteRecovery: boolean;
        isFullyMigrated: boolean;
        readinessResolved: boolean;
        submissionSupported: boolean;
        warnings?: Array<{ category: string; message: string }>;
        nextActions: unknown[];
        chainReadiness: Array<{
          chain: string;
          status: string;
          candidateLegacyCommitments: number;
          expectedLegacyCommitments: number;
          migratedCommitments: number;
          legacySpendableCommitments: number;
          reviewStatusComplete: boolean;
        }>;
      }>((json) => {
        expect(json.success).toBe(true);
        expect(json.mode).toBe("migration-status");
        expect(json.status).toBe("migration_required");
        expect(json.requiresMigration).toBe(true);
        expect(json.requiresWebsiteRecovery).toBe(false);
        expect(json.isFullyMigrated).toBe(false);
        expect(json.readinessResolved).toBe(true);
        expect(json.submissionSupported).toBe(false);
        expect(json.nextActions).toEqual([]);
        expect(json.warnings).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              category: "INPUT",
              message: expect.stringContaining("supported by the CLI"),
            }),
          ]),
        );
        expect(json.chainReadiness[0]).toMatchObject({
          chain: "sepolia",
          status: "migration_required",
          candidateLegacyCommitments: 1,
          expectedLegacyCommitments: 1,
          migratedCommitments: 0,
          legacySpendableCommitments: 1,
          reviewStatusComplete: true,
        });
      }),
      assertFileMissing(`.privacy-pools/accounts/${sepoliaChainConfig.id}.json`),
      assertFileMissing(
        `.privacy-pools/accounts/${sepoliaChainConfig.id}.sync.json`,
      ),
    ],
    { timeoutMs: 60_000 },
  ),
  defineScenario("degrades to review_incomplete when ASP review data is unavailable", [
    (ctx) => {
      ctx.seedConfigHome({
        defaultChain: "sepolia",
        withMnemonic: true,
        withSigner: true,
      });
      ctx.lastResult = {
        status: 0,
        signal: null,
        stdout: "",
        stderr: "",
        elapsedMs: 0,
        timedOut: false,
      };
    },
    assertExit(0),
    (ctx) =>
      runCliStep(["--json", "--chain", "sepolia", "migrate", "status"], {
        timeoutMs: 30_000,
        env: {
          PRIVACY_POOLS_ASP_HOST: "http://127.0.0.1:9",
          PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcServer.url,
        },
      })(ctx),
    assertExit(0),
    assertJson<{
      success: boolean;
      status: string;
      requiresMigration: boolean;
      readinessResolved: boolean;
      warnings?: Array<{ category: string; message: string }>;
      nextActions?: Array<{ command: string; when: string; cliCommand: string }>;
      chainReadiness: Array<{
        status: string;
        reviewStatusComplete: boolean;
      }>;
    }>((json) => {
      expect(json.success).toBe(true);
      expect(json.status).toBe("review_incomplete");
      expect(json.requiresMigration).toBe(true);
      expect(json.readinessResolved).toBe(false);
      expect(json.chainReadiness[0]).toMatchObject({
        status: "review_incomplete",
        reviewStatusComplete: false,
      });
      expect(json.nextActions).toEqual([
        expect.objectContaining({
          command: "migrate status",
          when: "after_restore",
          cliCommand: "privacy-pools migrate status --agent --chain sepolia",
        }),
      ]);
      expect(json.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "ASP",
            message: expect.stringContaining("legacy ASP review data was unavailable"),
          }),
        ]),
      );
    }),
  ]),
]);
