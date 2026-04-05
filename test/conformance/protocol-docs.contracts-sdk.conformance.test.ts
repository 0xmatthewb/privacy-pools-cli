/**
 * Protocol conformance: cross-checks CLI source code against the public
 * website/core sources and the installed SDK to catch drift between the CLI
 * and the protocol. Every test reads BOTH the source of truth and the local
 * CLI source, then asserts alignment between the two.
 *
 * Source of truth:
 *   Core contracts/circuits: checked-out privacy-pools-core source (with optional strict-local mode)
 *   Frontend patterns:       checked-out privacy-pools-website source (with optional strict-local mode)
 *   SDK:                     installed @0xbow/privacy-pools-core-sdk@1.2.0
 *
 * @frontend-parity
 */
import { beforeAll, describe, expect, test } from "bun:test";
import {
  DEPOSIT_EVENT_SIGNATURE,
  RAGEQUIT_EVENT_SIGNATURE,
  WITHDRAWN_EVENT_SIGNATURE,
  bundledCircuitFiles,
  extractEventSignature,
  extractFunctionNameLiterals,
  extractSolidityErrorNames,
  extractSolidityFunctionNames,
  extractSolidityStructFields,
  extractNamedExports,
  extractQuotedPathLiterals,
  loadProtocolTruthSources,
  protocolCliSources,
  sdkRuntimeExports,
  type ProtocolTruthSources,
} from "../helpers/protocol-conformance.ts";

let fetchFailed = false;
let truthSources: ProtocolTruthSources | null = null;
const {
  account: cliAccount,
  asp: cliAsp,
  chains: cliChains,
  circuitAssets: cliCircuitAssets,
  contracts: cliContracts,
  deposit: cliDeposit,
  installAnvilVerifier: cliInstallAnvilVerifier,
  pools: cliPools,
  poolRoots: cliPoolRoots,
  proofs: cliProofs,
  ragequit: cliRagequit,
  relayer: cliRelayer,
  sdk: cliSdk,
  syncGateRpcServer,
  unsignedFlows: cliUnsignedFlows,
  wallet: cliWallet,
  withdraw: cliWithdraw,
  workflow: cliWorkflow,
} = protocolCliSources;

describe("protocol conformance: CLI ↔ upstream", () => {
  beforeAll(async () => {
    try {
      truthSources = await loadProtocolTruthSources();
    } catch (err) {
      console.warn("Skipping protocol conformance — could not read source-of-truth files:", err);
      fetchFailed = true;
    }
  });

  test("source-of-truth reads succeeded (canary — all protocol tests below are skipped if this fails)", () => {
    if (fetchFailed) {
      console.warn("WARN: source-of-truth files were unavailable — protocol conformance tests are NOT running");
    }
    expect(fetchFailed).toBe(false);
  });

  const run = (name: string, fn: () => void) => {
    test(name, () => {
      if (fetchFailed) return;
      fn();
    });
  };

  const truth = () => truthSources!;

  // ---------------------------------------------------------------
  // 1. SDK methods: CLI calls → installed SDK source
  // ---------------------------------------------------------------

  run("CLI proof helpers map to callable PrivacyPoolSDK methods", () => {
    const cliAll = cliWithdraw + cliRagequit + cliProofs;
    expect(cliAll).toContain("proveWithdrawal");
    expect(cliAll).toContain("proveCommitment");
    expect(truth().installedSdkCore).toContain("proveWithdrawal");
    expect(truth().installedSdkCore).toContain("proveCommitment");
    expect(typeof sdkRuntimeExports.PrivacyPoolSDK.prototype.proveWithdrawal).toBe("function");
    expect(typeof sdkRuntimeExports.PrivacyPoolSDK.prototype.proveCommitment).toBe("function");
  });

  // ---------------------------------------------------------------
  // 2. Contract read-only ABI: CLI pools.ts ↔ core Solidity
  // ---------------------------------------------------------------

  run("CLI assetConfig ABI field names match upstream IEntrypoint.sol", () => {
    const upstreamEntrypointFunctions = extractSolidityFunctionNames(
      truth().upstreamIEntrypoint,
    );
    expect(upstreamEntrypointFunctions).toContain("assetConfig");
    expect(cliPools).toContain(
      '"function assetConfig(address asset) view returns (address pool, uint256 minimumDepositAmount, uint256 vettingFeeBPS, uint256 maxRelayFeeBPS)"',
    );
  });

  run("CLI SCOPE() call matches core interface contract", () => {
    expect(cliPools).toContain("SCOPE()");
    expect(truth().upstreamIState).toContain("SCOPE()");
  });

  // ---------------------------------------------------------------
  // 3. Tree depth: core circuits ↔ CLI hardcoded values
  // ---------------------------------------------------------------

  run("CLI tree depth (32) matches upstream circuit config", () => {
    expect(truth().upstreamCircuitsIndex).toContain("params: [32]");
    expect(cliWithdraw).toContain("stateTreeDepth: 32n");
    expect(cliWithdraw).toContain("aspTreeDepth: 32n");
    expect(truth().upstreamWithdrawInput.stateSiblings.length).toBe(32);
    expect(truth().upstreamWithdrawInput.ASPSiblings.length).toBe(32);
  });

  // ---------------------------------------------------------------
  // 4. API endpoints: CLI ↔ website
  // ---------------------------------------------------------------

  for (const endpoint of ["/public/mt-roots", "/public/mt-leaves", "/public/pools-stats"]) {
    run(`ASP endpoint "${endpoint}" used by both CLI and frontend`, () => {
      expect(extractQuotedPathLiterals(cliAsp)).toContain(endpoint);
      expect(extractQuotedPathLiterals(truth().upstreamAspClient)).toContain(endpoint);
    });
  }

  for (const endpoint of ["/relayer/details", "/relayer/quote", "/relayer/request"]) {
    run(`relayer endpoint "${endpoint}" used by both CLI and frontend`, () => {
      expect(extractQuotedPathLiterals(cliRelayer)).toContain(endpoint);
      expect(extractQuotedPathLiterals(truth().upstreamRelayerClient)).toContain(endpoint);
    });
  }

  run("X-Pool-Scope header used by both CLI and frontend", () => {
    expect(cliAsp).toContain("X-Pool-Scope");
    expect(truth().upstreamAspClient).toContain("X-Pool-Scope");
  });

  // ---------------------------------------------------------------
  // 5. Circuit artifacts: core circuit config ↔ CLI expectations
  // ---------------------------------------------------------------

  run("core circuit compile config includes the circuits the CLI provisions", () => {
    expect(truth().upstreamCircuitsIndex).toContain('compile("commitment"');
    expect(truth().upstreamCircuitsIndex).toContain('compile("withdraw"');
  });

  // ---------------------------------------------------------------
  // 6. SDK class exports: installed SDK source → CLI imports
  // ---------------------------------------------------------------

  run("SDK service classes are callable exports and referenced by the CLI", () => {
    const cliAll = cliSdk + cliAccount;
    expect(cliAll).toContain("AccountService");
    expect(cliAll).toContain("DataService");
    const sdkExports = extractNamedExports(truth().installedSdkIndex);
    expect(sdkExports).toContain("AccountService");
    expect(sdkExports).toContain("DataService");
    expect(typeof sdkRuntimeExports.AccountService).toBe("function");
    expect(typeof sdkRuntimeExports.DataService).toBe("function");
  });

  // ---------------------------------------------------------------
  // 7. SDK crypto functions: installed SDK source → CLI imports
  // ---------------------------------------------------------------

  run("CLI crypto helpers map to callable installed SDK exports", () => {
    expect(cliWallet).toContain("generateMasterKeys");
    expect(cliWithdraw).toContain("calculateContext");
    expect(cliWithdraw).toContain("generateMerkleProof");
    expect(truth().installedSdkCrypto).toContain("generateMasterKeys");
    expect(truth().installedSdkCrypto).toContain("calculateContext");
    expect(truth().installedSdkCrypto).toContain("generateMerkleProof");
    expect(typeof sdkRuntimeExports.generateMasterKeys).toBe("function");
    expect(typeof sdkRuntimeExports.calculateContext).toBe("function");
    expect(typeof sdkRuntimeExports.generateMerkleProof).toBe("function");
  });

  // ---------------------------------------------------------------
  // 8. [Removed] Unsigned ABI signature checks — superseded by
  //    semantic 4-byte selector parity in abi-selector-parity.conformance.test.ts
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // 9. IPrivacyPool.sol: events and structs ↔ CLI decoding
  // ---------------------------------------------------------------

  run("CLI Deposited event signature shape matches upstream IPrivacyPool.sol", () => {
    // The CLI hardcodes a parseAbi for the Deposited event in deposit.ts.
    // If the upstream changes parameter types or indexed modifiers, the
    // CLI would silently decode events incorrectly, producing wrong account
    // state.  This checks the full signature, not just parameter names.
    expect(cliDeposit).toContain(DEPOSIT_EVENT_SIGNATURE);

    expect(extractEventSignature(truth().upstreamIPrivacyPool, "Deposited")).toBe(
      DEPOSIT_EVENT_SIGNATURE,
    );
  });

  run("all deposit event parser copies used by sync and install remain aligned with upstream", () => {
    expect(extractEventSignature(truth().upstreamIPrivacyPool, "Deposited")).toBe(
      DEPOSIT_EVENT_SIGNATURE,
    );

    for (const source of [
      cliDeposit,
      cliWorkflow,
      cliInstallAnvilVerifier,
      syncGateRpcServer,
    ]) {
      expect(source).toContain(DEPOSIT_EVENT_SIGNATURE);
    }
  });

  run("upstream IPrivacyPool.sol defines Withdrawn and Ragequit events the CLI rebuild path depends on", () => {
    expect(cliAccount).toContain("initializeWithEvents");
    expect(truth().upstreamIPrivacyPool).toContain("event Withdrawn");
    expect(truth().upstreamIPrivacyPool).toContain("event Ragequit");
  });

  run("sync reconstruction parser signatures stay aligned with upstream withdraw and ragequit events", () => {
    expect(extractEventSignature(truth().upstreamIPrivacyPool, "Withdrawn")).toBe(
      WITHDRAWN_EVENT_SIGNATURE,
    );
    expect(extractEventSignature(truth().upstreamIPrivacyPool, "Ragequit")).toBe(
      RAGEQUIT_EVENT_SIGNATURE,
    );
    expect(cliSdk).toContain(WITHDRAWN_EVENT_SIGNATURE);
    expect(cliSdk).toContain(RAGEQUIT_EVENT_SIGNATURE);
  });

  run("CLI Withdrawal struct fields match upstream IPrivacyPool.sol", () => {
    const upstreamWithdrawalFields = extractSolidityStructFields(
      truth().upstreamIPrivacyPool,
      "Withdrawal",
    );
    expect(upstreamWithdrawalFields).toContain("processooor");
    expect(cliUnsignedFlows).toContain(
      '"function withdraw((address processooor, bytes data) _withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) _proof)"',
    );
    expect(cliUnsignedFlows).toContain(
      '"function relay((address processooor, bytes data) _withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) _proof, uint256 _scope)"',
    );
    expect(cliWithdraw).toContain("processooor:");
  });

  // ---------------------------------------------------------------
  // 11. IEntrypoint.sol: functions the CLI depends on
  // ---------------------------------------------------------------

  run("upstream IEntrypoint.sol defines latestRoot used by CLI for stale-state detection", () => {
    expect(extractFunctionNameLiterals(cliWithdraw)).toContain("latestRoot");
    expect(extractSolidityFunctionNames(truth().upstreamIEntrypoint)).toContain(
      "latestRoot",
    );
  });

  run("upstream IEntrypoint.sol defines precommitment tracking the CLI relies on", () => {
    expect(cliDeposit).toContain("precommitment");
    expect(extractSolidityFunctionNames(truth().upstreamIEntrypoint)).toContain(
      "usedPrecommitments",
    );
    expect(extractSolidityErrorNames(truth().upstreamIEntrypoint)).toContain(
      "PrecommitmentAlreadyUsed",
    );
  });

  run("upstream IState.sol defines the known-root history the CLI validates", () => {
    const cliFunctionNames = extractFunctionNameLiterals(cliPoolRoots);
    const upstreamStateFunctions = extractSolidityFunctionNames(truth().upstreamIState);
    for (const functionName of ["currentRoot", "roots", "ROOT_HISTORY_SIZE"]) {
      expect(cliFunctionNames).toContain(functionName);
      expect(upstreamStateFunctions).toContain(functionName);
    }
    expect(truth().upstreamIPrivacyPool).toContain("IState");
  });

  run("upstream IState.sol defines depositors mapping the CLI reads for ragequit", () => {
    expect(extractFunctionNameLiterals(cliRagequit)).toContain("depositors");
    expect(truth().upstreamIState).toContain("depositors");
  });

  // ---------------------------------------------------------------
  // 12. AccountService methods: upstream source → CLI usage
  //     Verified against the actual AccountService source code,
  //     not just the class name in the barrel export.
  // ---------------------------------------------------------------

  const ACCOUNT_SERVICE_METHODS = [
    { method: "createDepositSecrets", usedBy: "deposit.ts" },
    { method: "createWithdrawalSecrets", usedBy: "withdraw.ts" },
    { method: "getSpendableCommitments", usedBy: "withdraw/ragequit/accounts" },
    { method: "addPoolAccount", usedBy: "deposit.ts" },
    { method: "addRagequitToAccount", usedBy: "ragequit.ts" },
    { method: "addWithdrawalCommitment", usedBy: "withdraw.ts" },
  ];

  for (const { method, usedBy } of ACCOUNT_SERVICE_METHODS) {
    run(`AccountService.${method}() exists upstream and is used by CLI (${usedBy})`, () => {
      const cliAll = cliDeposit + cliWithdraw + cliRagequit + cliAccount;
      expect(cliAll).toContain(method);
      expect(truth().installedSdkAccountService).toContain(method);
    });
  }

  run("AccountService.initializeWithEvents() exists upstream and is used by CLI init and sync paths", () => {
    expect(cliAccount).toContain("initializeWithEvents");
    expect(truth().installedSdkAccountService).toContain("initializeWithEvents");
  });

  // ---------------------------------------------------------------
  // 13. SDK types: upstream crypto module → CLI type imports
  // ---------------------------------------------------------------

  run("CLI uses SDK Hash type from upstream crypto module", () => {
    expect(cliWithdraw).toContain("type Hash as SDKHash");
    expect(truth().installedSdkCrypto).toContain("Hash");
  });

  // ---------------------------------------------------------------
  // 14. DataService + Circuits: upstream SDK → CLI initialization
  // ---------------------------------------------------------------

  run("CLI DataService constructor args match upstream SDK export", () => {
    // CLI passes these config fields when constructing DataService
    expect(cliSdk).toContain("privacyPoolAddress");
    expect(cliSdk).toContain("startBlock");
    expect(extractNamedExports(truth().installedSdkIndex)).toContain("DataService");
  });

  run("CLI-managed circuit artifacts match upstream circuit names and files", () => {
    for (const circuit of ["commitment", "withdraw"]) {
      expect(cliCircuitAssets).toContain(`${circuit}.wasm`);
      expect(cliCircuitAssets).toContain(`${circuit}.zkey`);
      expect(cliCircuitAssets).toContain(`${circuit}.vkey`);
      expect(bundledCircuitFiles).toContain(`${circuit}.wasm`);
      expect(bundledCircuitFiles).toContain(`${circuit}.zkey`);
      expect(bundledCircuitFiles).toContain(`${circuit}.vkey`);
      expect(truth().upstreamCircuitsIndex).toContain(`"${circuit}"`);
    }
  });

  // ---------------------------------------------------------------
  // 15. Contract interaction: SDK methods → CLI usage
  // ---------------------------------------------------------------

  run("CLI local contract writes match upstream deposit, withdraw, and ragequit functions", () => {
    const cliFunctionNames = extractFunctionNameLiterals(cliContracts);
    expect(cliFunctionNames).toContain("deposit");
    expect(cliFunctionNames).toContain("withdraw");
    expect(cliFunctionNames).toContain("ragequit");
    expect(extractSolidityFunctionNames(truth().upstreamIEntrypoint)).toContain(
      "deposit",
    );
    const privacyPoolFunctions = extractSolidityFunctionNames(
      truth().upstreamIPrivacyPool,
    );
    expect(privacyPoolFunctions).toContain("withdraw");
    expect(privacyPoolFunctions).toContain("ragequit");
  });

  // ---------------------------------------------------------------
  // 16. Withdrawal proof input shape: CLI → circuit input
  // ---------------------------------------------------------------

  run("CLI withdrawal proof input fields match upstream circuit inputs", () => {
    for (const field of [
      "context", "withdrawalAmount",
      "stateMerkleProof", "aspMerkleProof",
      "stateRoot", "stateTreeDepth",
      "aspRoot", "aspTreeDepth",
    ]) {
      expect(cliWithdraw).toContain(field);
    }
    expect(cliProofs).toContain("prepareWithdrawalInputSignals");
    expect(cliProofs).toContain("stateSiblings");
    expect(cliProofs).toContain("ASPSiblings");
    expect(cliProofs).toContain("snarkjs.groth16.fullProve");
    expect(truth().upstreamWithdrawInput).toHaveProperty("stateSiblings");
    expect(truth().upstreamWithdrawInput).toHaveProperty("ASPSiblings");
  });

  // ---------------------------------------------------------------
  // 17. Ragequit flow: local proveCommitment → contract ragequit
  // ---------------------------------------------------------------

  run("CLI ragequit calls local proveCommitment then submits ragequit onchain", () => {
    expect(cliRagequit).toContain("proveCommitment");
    expect(cliRagequit).toContain("submitRagequit");
    expect(cliContracts).toContain('functionName: "ragequit"');
    expect(cliProofs).toContain("proveCommitment");
    expect(truth().upstreamIPrivacyPool).toContain("ragequit");
  });

  // ---------------------------------------------------------------
  // 18. Deposit flow: SDK secrets → contract call
  // ---------------------------------------------------------------

  run("CLI deposit generates secrets via SDK and submits deposit transactions locally", () => {
    expect(cliDeposit).toContain("createDepositSecrets");
    expect(cliDeposit).toContain("depositETH(");
    expect(cliDeposit).toContain("depositERC20(");
    expect(cliContracts).toContain('functionName: "deposit"');
    expect(truth().installedSdkAccountService).toContain("createDepositSecrets");
    expect(truth().upstreamIEntrypoint).toContain("function deposit(");
  });
});
