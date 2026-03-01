import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import {
  CORE_REPO_ROOT,
  EXTERNAL_REFS_EXPLICIT,
  FRONTEND_REPO_ROOT,
  pathExists,
} from "../helpers/paths.ts";

const CORE_ROOT = CORE_REPO_ROOT;
const FRONTEND_ROOT = FRONTEND_REPO_ROOT;

// Source-code paths that are stable in upstream repos.
const coreSourcePaths = [
  `${CORE_ROOT}/docs/docs/deployments.md`,
  `${CORE_ROOT}/docs/docs/reference/sdk.md`,
  `${CORE_ROOT}/docs/docs/reference/contracts.md`,
  `${CORE_ROOT}/packages/contracts/src/interfaces/IPrivacyPool.sol`,
  `${CORE_ROOT}/packages/circuits/src/index.ts`,
  `${CORE_ROOT}/packages/sdk/scripts/copy_circuits.sh`,
  `${CORE_ROOT}/packages/circuits/inputs/withdraw/default.json`,
  `${FRONTEND_ROOT}/src/utils/aspClient.ts`,
  `${FRONTEND_ROOT}/src/utils/relayerClient.ts`,
];

// Documentation files that may move between upstream releases.
// Tests depending on these are gated separately so they don't
// block the contract/circuit/SDK/frontend checks.
const docsContentPaths = [
  `${CORE_ROOT}/docs/static/skills.md`,
  `${CORE_ROOT}/docs/static/skills-core.md`,
];

const hasCoreSourceRefs = coreSourcePaths.every((p) => pathExists(p));
const hasDocsContentRefs = docsContentPaths.every((p) => pathExists(p));
const externalConformanceRequired =
  process.env.PP_EXTERNAL_CONFORMANCE_REQUIRED === "1";
const canRunCoreConformance = hasCoreSourceRefs && EXTERNAL_REFS_EXPLICIT;
const canRunDocsConformance = hasDocsContentRefs && EXTERNAL_REFS_EXPLICIT;
const runExternalConformance = canRunCoreConformance ? test : test.skip;
const runDocsConformance = canRunDocsConformance ? test : test.skip;

const skills = hasDocsContentRefs
  ? readFileSync(`${CORE_ROOT}/docs/static/skills.md`, "utf8")
  : "";
const skillsCore = hasDocsContentRefs
  ? readFileSync(`${CORE_ROOT}/docs/static/skills-core.md`, "utf8")
  : "";
const deployments = hasCoreSourceRefs
  ? readFileSync(`${CORE_ROOT}/docs/docs/deployments.md`, "utf8")
  : "";
const sdkRef = hasCoreSourceRefs
  ? readFileSync(`${CORE_ROOT}/docs/docs/reference/sdk.md`, "utf8")
  : "";
const contractsRef = hasCoreSourceRefs
  ? readFileSync(`${CORE_ROOT}/docs/docs/reference/contracts.md`, "utf8")
  : "";
const privacyPoolInterface = hasCoreSourceRefs
  ? readFileSync(`${CORE_ROOT}/packages/contracts/src/interfaces/IPrivacyPool.sol`, "utf8")
  : "";
const circuitsIndex = hasCoreSourceRefs
  ? readFileSync(`${CORE_ROOT}/packages/circuits/src/index.ts`, "utf8")
  : "";
const sdkCopyCircuitsScript = hasCoreSourceRefs
  ? readFileSync(`${CORE_ROOT}/packages/sdk/scripts/copy_circuits.sh`, "utf8")
  : "";
const withdrawCircuitDefaultInput = (hasCoreSourceRefs
  ? JSON.parse(
    readFileSync(`${CORE_ROOT}/packages/circuits/inputs/withdraw/default.json`, "utf8")
  )
  : {
    stateSiblings: [],
    ASPSiblings: [],
  }) as {
  stateSiblings: string[];
  ASPSiblings: string[];
};
const frontendAspClient = hasCoreSourceRefs
  ? readFileSync(`${FRONTEND_ROOT}/src/utils/aspClient.ts`, "utf8")
  : "";
const frontendRelayerClient = hasCoreSourceRefs
  ? readFileSync(`${FRONTEND_ROOT}/src/utils/relayerClient.ts`, "utf8")
  : "";

describe("protocol conformance against docs/contracts/sdk/frontend", () => {
  test("external protocol refs are available when required", () => {
    if (externalConformanceRequired) {
      if (!EXTERNAL_REFS_EXPLICIT) {
        throw new Error(
          "PP_EXTERNAL_CONFORMANCE_REQUIRED=1 but external repo paths are not set.\n"
          + "Set PP_CORE_REPO_ROOT and PP_FRONTEND_REPO_ROOT before running, e.g.:\n"
          + "  PP_CORE_REPO_ROOT=/path/to/privacy-pools-core "
          + "PP_FRONTEND_REPO_ROOT=/path/to/privacy-pools-website "
          + "bun run test:release"
        );
      }
      expect(hasCoreSourceRefs).toBe(true);
      if (!hasDocsContentRefs) {
        console.warn(
          "Note: docs/static/skills*.md not found in core repo. "
          + "Skills-content conformance tests will be skipped."
        );
      }
    } else {
      expect(true).toBe(true);
    }
  });

  // --- Skills-content checks (gated on docs files existing) ---

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
    runDocsConformance(`skills-core includes rule fragment: ${snippet}`, () => {
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
    runDocsConformance(`skills.md covers endpoint/flow: ${endpoint}`, () => {
      expect(skills.includes(endpoint)).toBe(true);
    });
  }

  // --- Source-code checks (gated on core source paths existing) ---

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
    runExternalConformance(`deployments include canonical snippet: ${snippet}`, () => {
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
    runExternalConformance(`IPrivacyPool interface includes: ${snippet}`, () => {
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
    runExternalConformance(`sdk reference includes: ${snippet}`, () => {
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
    runExternalConformance(`contracts reference includes: ${snippet}`, () => {
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
    runExternalConformance(`frontend clients include expected snippet: ${snippet}`, () => {
      const source =
        snippet.startsWith("/relayer") ? frontendRelayerClient : frontendAspClient;
      expect(source.includes(snippet)).toBe(true);
    });
  }

  runExternalConformance("circuits compile config uses canonical circuit names and depth=32", () => {
    expect(circuitsIndex).toContain('compile("commitment"');
    expect(circuitsIndex).toContain('compile("withdraw"');
    expect(circuitsIndex).toContain('template: "Withdraw"');
    expect(circuitsIndex).toContain("params: [32]");
    expect(circuitsIndex).toContain("stateTreeDepth");
    expect(circuitsIndex).toContain("ASPTreeDepth");
    expect(circuitsIndex).toContain('compile("merkleTree"');
    expect(circuitsIndex).toContain('template: "LeanIMTInclusionProof"');
  });

  runExternalConformance("sdk artifact copy script is aligned with commitment/withdraw artifacts", () => {
    expect(sdkCopyCircuitsScript).toContain('CIRCUITS=("commitment" "withdraw")');
    expect(sdkCopyCircuitsScript).toContain("trusted-setup/final-keys/$circuit.zkey");
    expect(sdkCopyCircuitsScript).toContain("trusted-setup/final-keys/$circuit.vkey");
    expect(sdkCopyCircuitsScript).toContain("build/$circuit/${circuit}_js/${circuit}.wasm");
  });

  runExternalConformance("core repo contains expected circuit artifact files", () => {
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

  runExternalConformance("withdraw circuit default input reflects tree depth shape", () => {
    expect(Array.isArray(withdrawCircuitDefaultInput.stateSiblings)).toBe(true);
    expect(Array.isArray(withdrawCircuitDefaultInput.ASPSiblings)).toBe(true);
    expect(withdrawCircuitDefaultInput.stateSiblings.length).toBe(32);
    expect(withdrawCircuitDefaultInput.ASPSiblings.length).toBe(32);
  });
});
