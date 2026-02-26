import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const CORE_ROOT = "/workspace/privacy-pools-core-main";
const FRONTEND_ROOT = "/workspace/privacy-pools-website-main";

const skills = readFileSync(`${CORE_ROOT}/docs/static/skills.md`, "utf8");
const skillsCore = readFileSync(`${CORE_ROOT}/docs/static/skills-core.md`, "utf8");
const deployments = readFileSync(`${CORE_ROOT}/docs/docs/deployments.md`, "utf8");
const sdkRef = readFileSync(`${CORE_ROOT}/docs/docs/reference/sdk.md`, "utf8");
const contractsRef = readFileSync(`${CORE_ROOT}/docs/docs/reference/contracts.md`, "utf8");
const privacyPoolInterface = readFileSync(
  `${CORE_ROOT}/packages/contracts/src/interfaces/IPrivacyPool.sol`,
  "utf8"
);
const circuitsIndex = readFileSync(`${CORE_ROOT}/packages/circuits/src/index.ts`, "utf8");
const sdkCopyCircuitsScript = readFileSync(
  `${CORE_ROOT}/packages/sdk/scripts/copy_circuits.sh`,
  "utf8"
);
const withdrawCircuitDefaultInput = JSON.parse(
  readFileSync(`${CORE_ROOT}/packages/circuits/inputs/withdraw/default.json`, "utf8")
) as {
  stateSiblings: string[];
  ASPSiblings: string[];
};
const frontendAspClient = readFileSync(`${FRONTEND_ROOT}/src/utils/aspClient.ts`, "utf8");
const frontendRelayerClient = readFileSync(
  `${FRONTEND_ROOT}/src/utils/relayerClient.ts`,
  "utf8"
);

describe("protocol conformance against docs/contracts/sdk/frontend", () => {
  const SKILLS_CORE_RULES = [
    "X-Pool-Scope",
    "onchainMtRoot",
    "Entrypoint.latestRoot()",
    "withdrawalAmount > 0n",
    "minimumDepositAmount",
    "feeCommitment",
    "Direct withdraw requires",
    "NullifierAlreadySpent",
    "partial withdrawal",
    "fastrelay.xyz",
  ];

  for (const snippet of SKILLS_CORE_RULES) {
    test(`skills-core includes rule fragment: ${snippet}`, () => {
      expect(skillsCore.includes(snippet)).toBe(true);
    });
  }

  const SKILLS_API_ENDPOINTS = [
    "/public/mt-roots",
    "/public/mt-leaves",
    "/relayer/quote",
    "/relayer/request",
    "/relayer/details",
    "calculateContext",
    "proveWithdrawal",
    "proveCommitment",
    "stateTreeDepth: 32n",
    "aspTreeDepth: 32n",
  ];

  for (const endpoint of SKILLS_API_ENDPOINTS) {
    test(`skills.md covers endpoint/flow: ${endpoint}`, () => {
      expect(skills.includes(endpoint)).toBe(true);
    });
  }

  const DEPLOYMENT_SNIPPETS = [
    "Ethereum Mainnet (Chain ID: 1)",
    "Arbitrum (Chain ID: 42161)",
    "OP Mainnet (Chain ID: 10)",
    "Sepolia Testnet (Chain ID: 11155111)",
    "OP Sepolia (Chain ID: 11155420)",
    "0x6818809eefce719e480a7526d76bd3e561526b46",
    "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
    "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
    "0x54aca0d27500669fa37867233e05423701f11ba1",
    "Use **`22153709n`** as `startBlock`",
  ];

  for (const snippet of DEPLOYMENT_SNIPPETS) {
    test(`deployments include canonical snippet: ${snippet}`, () => {
      expect(deployments.includes(snippet)).toBe(true);
    });
  }

  const CONTRACT_SNIPPETS = [
    "struct Withdrawal",
    "processooor",
    "event Deposited",
    "_precommitmentHash",
    "event Withdrawn",
    "_spentNullifier",
    "event Ragequit",
    "error InvalidProcessooor",
    "error IncorrectASPRoot",
    "function withdraw(",
  ];

  for (const snippet of CONTRACT_SNIPPETS) {
    test(`IPrivacyPool interface includes: ${snippet}`, () => {
      expect(privacyPoolInterface.includes(snippet)).toBe(true);
    });
  }

  const SDK_SNIPPETS = [
    "class PrivacyPoolSDK",
    "proveCommitment",
    "proveWithdrawal",
    "verifyWithdrawal",
    "generateMasterKeys",
    "generateMerkleProof",
    "calculateContext",
    "interface WithdrawalProofInput",
    "stateTreeDepth",
    "aspTreeDepth",
  ];

  for (const snippet of SDK_SNIPPETS) {
    test(`sdk reference includes: ${snippet}`, () => {
      expect(sdkRef.includes(snippet)).toBe(true);
    });
  }

  const CONTRACTS_REF_SNIPPETS = [
    "IPrivacyPool",
    "IEntrypoint",
    "assetConfig",
    "latestRoot",
    "relay(",
    "scopeToPool",
    "registerPool",
    "maxRelayFeeBPS",
  ];

  for (const snippet of CONTRACTS_REF_SNIPPETS) {
    test(`contracts reference includes: ${snippet}`, () => {
      expect(contractsRef.includes(snippet)).toBe(true);
    });
  }

  const FRONTEND_CONFORMANCE_SNIPPETS = [
    "interface PoolStatsResponse",
    "pools?: PoolStats[]",
    "fetchPoolStats",
    "/public/pools-stats",
    "fetchMtRoots",
    "fetchMtLeaves",
    "X-Pool-Scope",
    "/relayer/details",
    "/relayer/quote",
    "/relayer/request",
  ];

  for (const snippet of FRONTEND_CONFORMANCE_SNIPPETS) {
    test(`frontend clients include expected snippet: ${snippet}`, () => {
      const source =
        snippet.startsWith("/relayer") ? frontendRelayerClient : frontendAspClient;
      expect(source.includes(snippet)).toBe(true);
    });
  }

  test("circuits compile config uses canonical circuit names and depth=32", () => {
    expect(circuitsIndex).toContain('compile("commitment"');
    expect(circuitsIndex).toContain('compile("withdraw"');
    expect(circuitsIndex).toContain('template: "Withdraw"');
    expect(circuitsIndex).toContain("params: [32]");
    expect(circuitsIndex).toContain("stateTreeDepth");
    expect(circuitsIndex).toContain("ASPTreeDepth");
    expect(circuitsIndex).toContain('compile("merkleTree"');
    expect(circuitsIndex).toContain('template: "LeanIMTInclusionProof"');
  });

  test("sdk artifact copy script is aligned with commitment/withdraw artifacts", () => {
    expect(sdkCopyCircuitsScript).toContain('CIRCUITS=("commitment" "withdraw")');
    expect(sdkCopyCircuitsScript).toContain("trusted-setup/final-keys/$circuit.zkey");
    expect(sdkCopyCircuitsScript).toContain("trusted-setup/final-keys/$circuit.vkey");
    expect(sdkCopyCircuitsScript).toContain("build/$circuit/${circuit}_js/${circuit}.wasm");
  });

  test("core repo contains expected circuit artifact files", () => {
    const expectedArtifacts = [
      `${CORE_ROOT}/packages/circuits/trusted-setup/final-keys/commitment.zkey`,
      `${CORE_ROOT}/packages/circuits/trusted-setup/final-keys/commitment.vkey`,
      `${CORE_ROOT}/packages/circuits/trusted-setup/final-keys/withdraw.zkey`,
      `${CORE_ROOT}/packages/circuits/trusted-setup/final-keys/withdraw.vkey`,
      `${CORE_ROOT}/packages/circuits/build/commitment/commitment_js/commitment.wasm`,
      `${CORE_ROOT}/packages/circuits/build/withdraw/withdraw_js/withdraw.wasm`,
    ];

    for (const artifactPath of expectedArtifacts) {
      expect(existsSync(artifactPath)).toBe(true);
    }
  });

  test("withdraw circuit default input reflects tree depth shape", () => {
    expect(Array.isArray(withdrawCircuitDefaultInput.stateSiblings)).toBe(true);
    expect(Array.isArray(withdrawCircuitDefaultInput.ASPSiblings)).toBe(true);
    expect(withdrawCircuitDefaultInput.stateSiblings.length).toBe(32);
    expect(withdrawCircuitDefaultInput.ASPSiblings.length).toBe(32);
  });
});
