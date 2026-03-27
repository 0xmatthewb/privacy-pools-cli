import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { revertState, snapshotState } from "./anvil.ts";

export interface SharedAnvilPoolConfig {
  poolAddress: `0x${string}`;
  scope: string;
  assetAddress: `0x${string}`;
  symbol: string;
  decimals: number;
  minimumDepositAmount: string;
  vettingFeeBPS: string;
  maxRelayFeeBPS: string;
}

export interface SharedAnvilEnv {
  chainName: string;
  chainId: number;
  rpcUrl: string;
  aspUrl: string;
  relayerUrl: string;
  circuitsDir: string;
  entrypoint: `0x${string}`;
  startBlock: number;
  postmanAddress: `0x${string}`;
  signerPrivateKey: `0x${string}`;
  relayerPrivateKey: `0x${string}`;
  resetStateFile: string;
  aspStateFile: string;
  pools: {
    eth: SharedAnvilPoolConfig;
    erc20: SharedAnvilPoolConfig;
  };
}

interface SharedResetState {
  currentSnapshotId: string;
  aspStateFile: string;
  relayerUrl: string;
  baselineAspState: unknown;
}

export function loadSharedAnvilEnv(): SharedAnvilEnv {
  const file = process.env.PP_ANVIL_SHARED_ENV_FILE?.trim();
  if (!file) {
    throw new Error("PP_ANVIL_SHARED_ENV_FILE is required for shared Anvil E2E tests");
  }

  return JSON.parse(readFileSync(resolve(file), "utf8")) as SharedAnvilEnv;
}

export function sharedAnvilCliEnv(env: SharedAnvilEnv): Record<string, string> {
  const suffix = env.chainName.replace(/[^a-z0-9]/gi, "_").toUpperCase();
  const sharedEnvFile = process.env.PP_ANVIL_SHARED_ENV_FILE?.trim();
  return {
    PP_ANVIL_E2E: "1",
    ...(sharedEnvFile
      ? { PP_ANVIL_SHARED_ENV_FILE: resolve(sharedEnvFile) }
      : {}),
    [`PRIVACY_POOLS_RPC_URL_${suffix}`]: env.rpcUrl,
    PRIVACY_POOLS_ASP_HOST: env.aspUrl,
    PRIVACY_POOLS_RELAYER_HOST: env.relayerUrl,
    PRIVACY_POOLS_CIRCUITS_DIR: env.circuitsDir,
  };
}

export function applySharedAnvilProcessEnv(env: SharedAnvilEnv): void {
  for (const [key, value] of Object.entries(sharedAnvilCliEnv(env))) {
    process.env[key] = value;
  }
}

export function restoreSharedAnvilProcessEnv(
  original: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export async function resetSharedAnvilEnv(env: SharedAnvilEnv): Promise<void> {
  const resetState = JSON.parse(
    readFileSync(env.resetStateFile, "utf8"),
  ) as SharedResetState;

  const reverted = await revertState(env.rpcUrl, resetState.currentSnapshotId);
  if (!reverted) {
    throw new Error(`Failed to revert shared Anvil snapshot ${resetState.currentSnapshotId}`);
  }

  writeFileSync(
    resetState.aspStateFile,
    JSON.stringify(resetState.baselineAspState, null, 2),
    "utf8",
  );

  const relayerReset = await fetch(`${resetState.relayerUrl}/__reset`, {
    method: "POST",
  });
  if (!relayerReset.ok) {
    throw new Error(`Failed to reset Anvil relayer state: HTTP ${relayerReset.status}`);
  }

  resetState.currentSnapshotId = await snapshotState(env.rpcUrl);
  writeFileSync(env.resetStateFile, JSON.stringify(resetState, null, 2), "utf8");
}

export async function configureSharedRelayer(
  env: SharedAnvilEnv,
  body: unknown,
): Promise<void> {
  const response = await fetch(`${env.relayerUrl}/__configure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Failed to configure Anvil relayer state: HTTP ${response.status}`);
  }
}
