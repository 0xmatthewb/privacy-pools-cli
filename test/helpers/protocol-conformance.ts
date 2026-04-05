import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  AccountService,
  DataService,
  PrivacyPoolSDK,
  calculateContext,
  generateMasterKeys,
  generateMerkleProof,
} from "@0xbow/privacy-pools-core-sdk";
import {
  CORE_REPO,
  FRONTEND_REPO,
  fetchGitHubFile,
} from "./github.ts";
import { CLI_ROOT } from "./paths.ts";

export const DEPOSIT_EVENT_SIGNATURE =
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)";
export const WITHDRAWN_EVENT_SIGNATURE =
  "event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)";
export const RAGEQUIT_EVENT_SIGNATURE =
  "event Ragequit(address indexed _ragequitter, uint256 _commitment, uint256 _label, uint256 _value)";

export const protocolCliSources = {
  account: readFileSync(resolve(CLI_ROOT, "src/services/account.ts"), "utf8"),
  asp: readFileSync(resolve(CLI_ROOT, "src/services/asp.ts"), "utf8"),
  chains: readFileSync(resolve(CLI_ROOT, "src/config/chains.ts"), "utf8"),
  circuitAssets: readFileSync(
    resolve(CLI_ROOT, "src/services/circuit-assets.js"),
    "utf8",
  ),
  contracts: readFileSync(resolve(CLI_ROOT, "src/services/contracts.ts"), "utf8"),
  deposit: readFileSync(resolve(CLI_ROOT, "src/commands/deposit.ts"), "utf8"),
  githubHelper: readFileSync(resolve(CLI_ROOT, "test/helpers/github.ts"), "utf8"),
  installAnvilVerifier: readFileSync(
    resolve(CLI_ROOT, "scripts/verify-cli-install-anvil.mjs"),
    "utf8",
  ),
  pools: readFileSync(resolve(CLI_ROOT, "src/services/pools.ts"), "utf8"),
  poolRoots: readFileSync(resolve(CLI_ROOT, "src/services/pool-roots.ts"), "utf8"),
  proofs: readFileSync(resolve(CLI_ROOT, "src/services/proofs.ts"), "utf8"),
  ragequit: readFileSync(resolve(CLI_ROOT, "src/commands/ragequit.ts"), "utf8"),
  relayer: readFileSync(resolve(CLI_ROOT, "src/services/relayer.ts"), "utf8"),
  sdk: readFileSync(resolve(CLI_ROOT, "src/services/sdk.ts"), "utf8"),
  syncGateRpcServer: readFileSync(
    resolve(CLI_ROOT, "test/helpers/sync-gate-rpc-server.ts"),
    "utf8",
  ),
  unsignedFlows: readFileSync(
    resolve(CLI_ROOT, "src/utils/unsigned-flows.ts"),
    "utf8",
  ),
  wallet: readFileSync(resolve(CLI_ROOT, "src/services/wallet.ts"), "utf8"),
  withdraw: readFileSync(resolve(CLI_ROOT, "src/commands/withdraw.ts"), "utf8"),
  workflow: readFileSync(resolve(CLI_ROOT, "src/services/workflow.ts"), "utf8"),
};

export const bundledCircuitFiles = readdirSync(
  resolve(CLI_ROOT, "assets/circuits/v1.2.0"),
);

export interface ProtocolTruthSources {
  upstreamIPrivacyPool: string;
  upstreamIEntrypoint: string;
  upstreamCircuitsIndex: string;
  upstreamAspClient: string;
  upstreamRelayerClient: string;
  upstreamIState: string;
  upstreamWithdrawInput: {
    stateSiblings: string[];
    ASPSiblings: string[];
  };
  installedSdkCore: string;
  installedSdkIndex: string;
  installedSdkCrypto: string;
  installedSdkAccountService: string;
}

export async function loadProtocolTruthSources(): Promise<ProtocolTruthSources> {
  const [
    upstreamIPrivacyPool,
    upstreamIEntrypoint,
    upstreamCircuitsIndex,
    upstreamAspClient,
    upstreamRelayerClient,
    upstreamIState,
  ] = await Promise.all([
    fetchGitHubFile(CORE_REPO, "packages/contracts/src/interfaces/IPrivacyPool.sol"),
    fetchGitHubFile(CORE_REPO, "packages/contracts/src/interfaces/IEntrypoint.sol"),
    fetchGitHubFile(CORE_REPO, "packages/circuits/src/index.ts"),
    fetchGitHubFile(FRONTEND_REPO, "src/utils/aspClient.ts"),
    fetchGitHubFile(FRONTEND_REPO, "src/utils/relayerClient.ts"),
    fetchGitHubFile(CORE_REPO, "packages/contracts/src/interfaces/IState.sol"),
  ]);
  const rawInput = await fetchGitHubFile(
    CORE_REPO,
    "packages/circuits/inputs/withdraw/default.json",
  );

  return {
    upstreamIPrivacyPool,
    upstreamIEntrypoint,
    upstreamCircuitsIndex,
    upstreamAspClient,
    upstreamRelayerClient,
    upstreamIState,
    upstreamWithdrawInput: JSON.parse(rawInput),
    installedSdkCore: readFileSync(
      resolve(CLI_ROOT, "node_modules/@0xbow/privacy-pools-core-sdk/src/core/sdk.ts"),
      "utf8",
    ),
    installedSdkIndex: readFileSync(
      resolve(CLI_ROOT, "node_modules/@0xbow/privacy-pools-core-sdk/src/index.ts"),
      "utf8",
    ),
    installedSdkCrypto: readFileSync(
      resolve(CLI_ROOT, "node_modules/@0xbow/privacy-pools-core-sdk/src/crypto.ts"),
      "utf8",
    ),
    installedSdkAccountService: readFileSync(
      resolve(
        CLI_ROOT,
        "node_modules/@0xbow/privacy-pools-core-sdk/src/core/account.service.ts",
      ),
      "utf8",
    ),
  };
}

export function normalizeSignature(signature: string): string {
  return signature
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

export function extractEventSignature(source: string, eventName: string): string {
  const match = source.match(
    new RegExp(`event\\s+${eventName}\\s*\\(([^;]+)\\)\\s*;`, "m"),
  );
  if (!match) {
    throw new Error(`Missing upstream event signature for ${eventName}`);
  }
  return normalizeSignature(`event ${eventName}(${match[1]})`);
}

export function extractQuotedPathLiterals(source: string): Set<string> {
  const matches = source.matchAll(
    /\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._?=&:-]+)*/g,
  );
  return new Set(
    [...matches].map((match) => match[0].replace(/\?.*$/u, "")),
  );
}

export function extractSolidityFunctionNames(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)].map(
      (match) => match[1],
    ),
  );
}

export function extractSolidityErrorNames(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/error\s+([A-Za-z0-9_]+)\s*\(/g)].map(
      (match) => match[1],
    ),
  );
}

export function extractSolidityStructFields(
  source: string,
  structName: string,
): Set<string> {
  const match = source.match(
    new RegExp(`struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\}`, "m"),
  );
  if (!match) {
    throw new Error(`Missing struct ${structName}`);
  }
  return new Set(
    match[1]
      .split(";")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/u).pop() ?? "")
      .filter(Boolean),
  );
}

export function extractFunctionNameLiterals(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/functionName:\s*["']([A-Za-z0-9_]+)["']/g)].map(
      (match) => match[1],
    ),
  );
}

export function extractNamedExports(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1].split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      names.add(trimmed.replace(/\s+as\s+.*/u, "").trim());
    }
  }
  for (const match of source.matchAll(
    /export\s+(?:class|function|const|let|type|interface)\s+([A-Za-z0-9_]+)/g,
  )) {
    names.add(match[1]);
  }
  return names;
}

export const sdkRuntimeExports = {
  AccountService,
  DataService,
  PrivacyPoolSDK,
  calculateContext,
  generateMasterKeys,
  generateMerkleProof,
};
