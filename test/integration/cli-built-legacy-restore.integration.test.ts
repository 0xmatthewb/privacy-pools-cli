import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { CHAINS } from "../../src/config/chains.ts";
import {
  TEST_MNEMONIC,
  createTempHome,
  initSeededHome,
  parseJsonOutput,
  runBuiltCli,
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
import {
  cleanupWorkspaceSnapshot,
  createBuiltWorkspaceSnapshot,
} from "../helpers/workspace-snapshot.ts";

const sepoliaChainConfig = CHAINS.sepolia;
const mockPoolAddress = "0x1234567890abcdef1234567890abcdef12345678" as const;
const mockScope = 12345n;

type ExistingAccountConfig = Extract<
  ConstructorParameters<typeof AccountService>[1],
  { account: unknown }
>;

type ExistingPrivacyPoolAccount = ExistingAccountConfig["account"];

let builtWorkspaceRoot: string;
let fixture: FixtureServer;
let rpcServer: SyncGateRpcServer;

function deriveSafeDepositPrecommitment(
  mnemonic: string,
  scope: bigint,
  index: bigint,
): bigint {
  const service = new AccountService(
    {} as ConstructorParameters<typeof AccountService>[0],
    { mnemonic },
  );
  return service.createDepositSecrets(scope, index).precommitment;
}

function deriveLegacyDepositPrecommitment(
  mnemonic: string,
  scope: bigint,
  index: bigint,
): bigint {
  const legacyPrivacyPoolAccount = (
    AccountService as unknown as {
      _initializeLegacyAccount(inputMnemonic: string): ExistingPrivacyPoolAccount;
    }
  )._initializeLegacyAccount(mnemonic);
  const legacyService = new AccountService(
    {} as ConstructorParameters<typeof AccountService>[0],
    { account: legacyPrivacyPoolAccount },
  );
  return legacyService.createDepositSecrets(scope, index).precommitment;
}

beforeAll(async () => {
  builtWorkspaceRoot = createBuiltWorkspaceSnapshot();
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
  cleanupWorkspaceSnapshot(builtWorkspaceRoot);
});

describe("built CLI legacy restore safety", () => {
  test("accounts fails closed with migration guidance for a real legacy-derived deposit", () => {
    const home = createTempHome();
    const safePrecommitment = deriveSafeDepositPrecommitment(
      TEST_MNEMONIC,
      mockScope,
      0n,
    );
    const legacyPrecommitment = deriveLegacyDepositPrecommitment(
      TEST_MNEMONIC,
      mockScope,
      0n,
    );

    expect(legacyPrecommitment).not.toBe(safePrecommitment);
    initSeededHome(home, "sepolia");

    const result = runBuiltCli(
      ["--json", "--chain", "sepolia", "accounts"],
      {
        home,
        cwd: builtWorkspaceRoot,
        timeoutMs: 30_000,
        env: {
          PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
          PRIVACY_POOLS_ASP_HOST: fixture.url,
          PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcServer.url,
        },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ACCOUNT_MIGRATION_REQUIRED");
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("require migration");
  }, 60_000);

  test("history fails closed with migration guidance for a real legacy-derived deposit", () => {
    const home = createTempHome();
    initSeededHome(home, "sepolia");

    const result = runBuiltCli(
      ["--json", "--chain", "sepolia", "history"],
      {
        home,
        cwd: builtWorkspaceRoot,
        timeoutMs: 30_000,
        env: {
          PRIVACY_POOLS_CLI_DISABLE_NATIVE: "1",
          PRIVACY_POOLS_ASP_HOST: fixture.url,
          PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcServer.url,
        },
      },
    );

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe("");

    const json = parseJsonOutput<{
      success: boolean;
      errorCode: string;
      error: { category: string; message: string };
    }>(result.stdout);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("ACCOUNT_MIGRATION_REQUIRED");
    expect(json.error.category).toBe("INPUT");
    expect(json.error.message).toContain("require migration");
  }, 60_000);
});
