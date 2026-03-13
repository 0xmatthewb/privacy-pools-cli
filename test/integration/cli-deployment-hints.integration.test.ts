import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CHAINS } from "../../src/config/chains.ts";
import {
  createTempHome,
  mustInitSeededHome,
  parseJsonOutput,
  runCli,
} from "../helpers/cli.ts";
import {
  killDeploymentHintAspServer,
  launchDeploymentHintAspServer,
  type DeploymentHintAspServer,
} from "../helpers/deployment-hint-asp-server.ts";
import {
  killSyncGateRpcServer,
  launchSyncGateRpcServer,
  type SyncGateRpcServer,
} from "../helpers/sync-gate-rpc-server.ts";

const chainConfig = CHAINS.sepolia;
const assetAddress = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" as const;
const poolAddress = "0x0b062fe33c4f1592d8ea63f9a0177fca44374c0f" as const;
const scope = 12345n;
const deploymentBlock = 8587064n;

let aspServer: DeploymentHintAspServer;
let rpcServer: SyncGateRpcServer;

function testEnv() {
  return {
    PRIVACY_POOLS_ASP_HOST: aspServer.url,
    PRIVACY_POOLS_RPC_URL_SEPOLIA: rpcServer.url,
  };
}

beforeAll(async () => {
  aspServer = await launchDeploymentHintAspServer({
    chainId: chainConfig.id,
    assetAddress,
    tokenSymbol: "USDC",
    scope,
  });

  rpcServer = await launchSyncGateRpcServer({
    chainId: chainConfig.id,
    entrypoint: chainConfig.entrypoint,
    poolAddress,
    scope,
    assetAddress,
    assetSymbol: "USDC",
    assetDecimals: 6,
    blockNumber: 9_000_000n,
    minFromBlock: deploymentBlock,
    validDepositLog: true,
  });
});

afterAll(() => {
  killSyncGateRpcServer(rpcServer);
  killDeploymentHintAspServer(aspServer);
});

describe("deployment block hints", () => {
  test("accounts sync uses the pool deployment block for known late-deployed pools", () => {
    const home = createTempHome();
    mustInitSeededHome(home, "sepolia");

    const result = runCli(
      ["--json", "--chain", "sepolia", "accounts", "--summary"],
      { home, timeoutMs: 30_000, env: testEnv() },
    );

    expect(result.status).toBe(0);

    const json = parseJsonOutput<{
      success: boolean;
      chain: string;
      pendingCount: number;
      approvedCount: number;
      poiRequiredCount: number;
      declinedCount: number;
      unknownCount: number;
      spentCount: number;
      exitedCount: number;
      balances: unknown[];
    }>(result.stdout);

    expect(json.success).toBe(true);
    expect(json.chain).toBe("sepolia");
    expect(json.pendingCount).toBe(0);
    expect(json.approvedCount).toBe(0);
    expect(json.poiRequiredCount).toBe(0);
    expect(json.declinedCount).toBe(0);
    expect(json.unknownCount).toBe(0);
    expect(json.spentCount).toBe(0);
    expect(json.exitedCount).toBe(0);
    expect(json.balances).toEqual([]);
  }, 30_000);
});
