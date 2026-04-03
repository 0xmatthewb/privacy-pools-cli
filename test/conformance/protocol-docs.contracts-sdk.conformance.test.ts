/**
 * Protocol conformance: cross-checks CLI source code against the public
 * website/core sources and the installed SDK to catch drift between the CLI
 * and the protocol. Every test reads BOTH the source of truth and the local
 * CLI source, then asserts alignment between the two.
 *
 * Source of truth:
 *   Core contracts/circuits: public 0xbow-io/privacy-pools-core
 *   Frontend patterns:       public 0xbow-io/privacy-pools-website
 *   SDK:                     installed @0xbow/privacy-pools-core-sdk@1.2.0
 *
 * @frontend-parity
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
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
} from "../helpers/github.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

// --- Upstream content (populated in beforeAll) ---

let upstreamIPrivacyPool = "";
let upstreamIEntrypoint = "";
let upstreamCircuitsIndex = "";
let upstreamWithdrawInput = { stateSiblings: [] as string[], ASPSiblings: [] as string[] };
let upstreamAspClient = "";
let upstreamRelayerClient = "";
let upstreamIState = "";
let installedSdkCore = "";
let installedSdkIndex = "";
let installedSdkCrypto = "";
let installedSdkAccountService = "";

// --- CLI source code (read synchronously) ---

const cliChains = readFileSync(resolve(CLI_ROOT, "src/config/chains.ts"), "utf8");
const cliWithdraw = readFileSync(resolve(CLI_ROOT, "src/commands/withdraw.ts"), "utf8");
const cliPoolRoots = readFileSync(resolve(CLI_ROOT, "src/services/pool-roots.ts"), "utf8");
const cliRagequit = readFileSync(resolve(CLI_ROOT, "src/commands/ragequit.ts"), "utf8");
const cliDeposit = readFileSync(resolve(CLI_ROOT, "src/commands/deposit.ts"), "utf8");
const cliAsp = readFileSync(resolve(CLI_ROOT, "src/services/asp.ts"), "utf8");
const cliRelayer = readFileSync(resolve(CLI_ROOT, "src/services/relayer.ts"), "utf8");
const cliPools = readFileSync(resolve(CLI_ROOT, "src/services/pools.ts"), "utf8");
const cliSdk = readFileSync(resolve(CLI_ROOT, "src/services/sdk.ts"), "utf8");
const cliCircuitAssets = readFileSync(
  resolve(CLI_ROOT, "src/services/circuit-assets.js"),
  "utf8",
);
const bundledCircuitFiles = readdirSync(
  resolve(CLI_ROOT, "assets/circuits/v1.2.0"),
);
const cliContracts = readFileSync(resolve(CLI_ROOT, "src/services/contracts.ts"), "utf8");
const cliProofs = readFileSync(resolve(CLI_ROOT, "src/services/proofs.ts"), "utf8");
const cliWallet = readFileSync(resolve(CLI_ROOT, "src/services/wallet.ts"), "utf8");
const cliAccount = readFileSync(resolve(CLI_ROOT, "src/services/account.ts"), "utf8");
const cliUnsignedFlows = readFileSync(resolve(CLI_ROOT, "src/utils/unsigned-flows.ts"), "utf8");
const cliWorkflow = readFileSync(resolve(CLI_ROOT, "src/services/workflow.ts"), "utf8");
const cliInstallAnvilVerifier = readFileSync(
  resolve(CLI_ROOT, "scripts/verify-cli-install-anvil.mjs"),
  "utf8",
);
const githubHelper = readFileSync(
  resolve(CLI_ROOT, "test/helpers/github.ts"),
  "utf8",
);
const syncGateRpcServer = readFileSync(
  resolve(CLI_ROOT, "test/helpers/sync-gate-rpc-server.ts"),
  "utf8",
);

const DEPOSIT_EVENT_SIGNATURE =
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)";
const WITHDRAWN_EVENT_SIGNATURE =
  "event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)";
const RAGEQUIT_EVENT_SIGNATURE =
  "event Ragequit(address indexed _ragequitter, uint256 _commitment, uint256 _label, uint256 _value)";

let fetchFailed = false;

function normalizeSignature(signature: string): string {
  return signature
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function extractEventSignature(source: string, eventName: string): string {
  const match = source.match(
    new RegExp(`event\\s+${eventName}\\s*\\(([^;]+)\\)\\s*;`, "m"),
  );
  if (!match) {
    throw new Error(`Missing upstream event signature for ${eventName}`);
  }
  return normalizeSignature(`event ${eventName}(${match[1]})`);
}

describe("protocol conformance: CLI ↔ upstream", () => {
  test("conformance source helper stays pinned to public upstream inputs", () => {
    expect(githubHelper).toContain('const RAW_BASE = "https://raw.githubusercontent.com"');
    expect(githubHelper).toContain('export const CORE_REPO = "0xbow-io/privacy-pools-core"');
    expect(githubHelper).toContain('export const FRONTEND_REPO = "0xbow-io/privacy-pools-website"');
    expect(githubHelper).not.toContain("CONFORMANCE_CORE_ROOT");
    expect(githubHelper).not.toContain("CONFORMANCE_FRONTEND_ROOT");
    expect(githubHelper).not.toContain("privacy-pools-core-main");
  });

  beforeAll(async () => {
    try {
      [
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

      installedSdkCore = readFileSync(
        resolve(
          CLI_ROOT,
          "node_modules/@0xbow/privacy-pools-core-sdk/src/core/sdk.ts",
        ),
        "utf8",
      );
      installedSdkIndex = readFileSync(
        resolve(
          CLI_ROOT,
          "node_modules/@0xbow/privacy-pools-core-sdk/src/index.ts",
        ),
        "utf8",
      );
      installedSdkCrypto = readFileSync(
        resolve(
          CLI_ROOT,
          "node_modules/@0xbow/privacy-pools-core-sdk/src/crypto.ts",
        ),
        "utf8",
      );
      installedSdkAccountService = readFileSync(
        resolve(
          CLI_ROOT,
          "node_modules/@0xbow/privacy-pools-core-sdk/src/core/account.service.ts",
        ),
        "utf8",
      );

      const rawInput = await fetchGitHubFile(
        CORE_REPO,
        "packages/circuits/inputs/withdraw/default.json",
      );
      upstreamWithdrawInput = JSON.parse(rawInput);
    } catch (err) {
      console.warn("Skipping protocol conformance — could not read source-of-truth files:", err);
      fetchFailed = true;
    }
  });

  test("upstream fetch succeeded (canary — all protocol tests below are skipped if this fails)", () => {
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

  // ---------------------------------------------------------------
  // 1. SDK methods: CLI calls → installed SDK source
  // ---------------------------------------------------------------

  run("CLI proof helpers map to callable PrivacyPoolSDK methods", () => {
    const cliAll = cliWithdraw + cliRagequit + cliProofs;
    expect(cliAll).toContain("proveWithdrawal");
    expect(cliAll).toContain("proveCommitment");
    expect(installedSdkCore).toContain("proveWithdrawal");
    expect(installedSdkCore).toContain("proveCommitment");
    expect(typeof PrivacyPoolSDK.prototype.proveWithdrawal).toBe("function");
    expect(typeof PrivacyPoolSDK.prototype.proveCommitment).toBe("function");
  });

  // ---------------------------------------------------------------
  // 2. Contract read-only ABI: CLI pools.ts ↔ core Solidity
  // ---------------------------------------------------------------

  run("CLI assetConfig ABI field names match upstream IEntrypoint.sol", () => {
    for (const field of ["assetConfig", "minimumDepositAmount", "vettingFeeBPS", "maxRelayFeeBPS"]) {
      expect(cliPools).toContain(field);
      expect(upstreamIEntrypoint).toContain(field);
    }
  });

  run("CLI SCOPE() call matches core interface contract", () => {
    expect(cliPools).toContain("SCOPE()");
    expect(upstreamIState).toContain("SCOPE()");
  });

  // ---------------------------------------------------------------
  // 3. Tree depth: core circuits ↔ CLI hardcoded values
  // ---------------------------------------------------------------

  run("CLI tree depth (32) matches upstream circuit config", () => {
    expect(upstreamCircuitsIndex).toContain("params: [32]");
    expect(cliWithdraw).toContain("stateTreeDepth: 32n");
    expect(cliWithdraw).toContain("aspTreeDepth: 32n");
    expect(upstreamWithdrawInput.stateSiblings.length).toBe(32);
    expect(upstreamWithdrawInput.ASPSiblings.length).toBe(32);
  });

  // ---------------------------------------------------------------
  // 4. API endpoints: CLI ↔ website
  // ---------------------------------------------------------------

  for (const endpoint of ["/public/mt-roots", "/public/mt-leaves", "/public/pools-stats"]) {
    run(`ASP endpoint "${endpoint}" used by both CLI and frontend`, () => {
      expect(cliAsp).toContain(endpoint);
      expect(upstreamAspClient).toContain(endpoint);
    });
  }

  for (const endpoint of ["/relayer/details", "/relayer/quote", "/relayer/request"]) {
    run(`relayer endpoint "${endpoint}" used by both CLI and frontend`, () => {
      expect(cliRelayer).toContain(endpoint);
      expect(upstreamRelayerClient).toContain(endpoint);
    });
  }

  run("X-Pool-Scope header used by both CLI and frontend", () => {
    expect(cliAsp).toContain("X-Pool-Scope");
    expect(upstreamAspClient).toContain("X-Pool-Scope");
  });

  // ---------------------------------------------------------------
  // 5. Circuit artifacts: core circuit config ↔ CLI expectations
  // ---------------------------------------------------------------

  run("core circuit compile config includes the circuits the CLI provisions", () => {
    expect(upstreamCircuitsIndex).toContain('compile("commitment"');
    expect(upstreamCircuitsIndex).toContain('compile("withdraw"');
  });

  // ---------------------------------------------------------------
  // 6. SDK class exports: installed SDK source → CLI imports
  // ---------------------------------------------------------------

  run("SDK service classes are callable exports and referenced by the CLI", () => {
    const cliAll = cliSdk + cliAccount;
    expect(cliAll).toContain("AccountService");
    expect(cliAll).toContain("DataService");
    expect(installedSdkIndex).toContain('export { AccountService }');
    expect(installedSdkIndex).toContain('export { DataService }');
    expect(typeof AccountService).toBe("function");
    expect(typeof DataService).toBe("function");
  });

  // ---------------------------------------------------------------
  // 7. SDK crypto functions: installed SDK source → CLI imports
  // ---------------------------------------------------------------

  run("CLI crypto helpers map to callable installed SDK exports", () => {
    expect(cliWallet).toContain("generateMasterKeys");
    expect(cliWithdraw).toContain("calculateContext");
    expect(cliWithdraw).toContain("generateMerkleProof");
    expect(installedSdkCrypto).toContain("generateMasterKeys");
    expect(installedSdkCrypto).toContain("calculateContext");
    expect(installedSdkCrypto).toContain("generateMerkleProof");
    expect(typeof generateMasterKeys).toBe("function");
    expect(typeof calculateContext).toBe("function");
    expect(typeof generateMerkleProof).toBe("function");
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

    expect(extractEventSignature(upstreamIPrivacyPool, "Deposited")).toBe(
      DEPOSIT_EVENT_SIGNATURE,
    );
  });

  run("all deposit event parser copies used by sync and install remain aligned with upstream", () => {
    expect(extractEventSignature(upstreamIPrivacyPool, "Deposited")).toBe(
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
    expect(upstreamIPrivacyPool).toContain("event Withdrawn");
    expect(upstreamIPrivacyPool).toContain("event Ragequit");
  });

  run("sync reconstruction parser signatures stay aligned with upstream withdraw and ragequit events", () => {
    expect(extractEventSignature(upstreamIPrivacyPool, "Withdrawn")).toBe(
      WITHDRAWN_EVENT_SIGNATURE,
    );
    expect(extractEventSignature(upstreamIPrivacyPool, "Ragequit")).toBe(
      RAGEQUIT_EVENT_SIGNATURE,
    );
    expect(cliSdk).toContain(WITHDRAWN_EVENT_SIGNATURE);
    expect(cliSdk).toContain(RAGEQUIT_EVENT_SIGNATURE);
  });

  run("CLI Withdrawal struct fields match upstream IPrivacyPool.sol", () => {
    expect(upstreamIPrivacyPool).toContain("struct Withdrawal");
    expect(upstreamIPrivacyPool).toContain("processooor");

    // CLI unsigned-flows constructs this struct in withdraw and relay ABIs
    expect(cliUnsignedFlows).toContain("processooor");
    // CLI withdraw command also references it
    expect(cliWithdraw).toContain("processooor");
  });

  // ---------------------------------------------------------------
  // 11. IEntrypoint.sol: functions the CLI depends on
  // ---------------------------------------------------------------

  run("upstream IEntrypoint.sol defines latestRoot used by CLI for stale-state detection", () => {
    expect(cliWithdraw).toContain("latestRoot");
    expect(upstreamIEntrypoint).toContain("latestRoot");
  });

  run("upstream IEntrypoint.sol defines precommitment tracking the CLI relies on", () => {
    expect(cliDeposit).toContain("precommitment");
    expect(upstreamIEntrypoint).toContain("usedPrecommitments");
    expect(upstreamIEntrypoint).toContain("PrecommitmentAlreadyUsed");
  });

  run("upstream IState.sol defines the known-root history the CLI validates", () => {
    // CLI reads currentRoot and cached roots from the pool contract
    expect(cliPoolRoots).toContain("currentRoot");
    expect(cliPoolRoots).toContain("roots");
    expect(cliPoolRoots).toContain("ROOT_HISTORY_SIZE");

    // currentRoot and roots are defined in IState.sol (inherited by IPrivacyPool)
    expect(upstreamIState).toContain("currentRoot");
    expect(upstreamIState).toContain("roots");
    expect(upstreamIState).toContain("ROOT_HISTORY_SIZE");

    // IPrivacyPool must inherit from IState
    expect(upstreamIPrivacyPool).toContain("IState");
  });

  run("upstream IState.sol defines depositors mapping the CLI reads for ragequit", () => {
    // CLI ragequit looks up the original depositor for a commitment label
    expect(cliRagequit).toContain("depositors");

    // depositors mapping is defined in IState.sol (inherited by IPrivacyPool)
    expect(upstreamIState).toContain("depositors");
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
      expect(installedSdkAccountService).toContain(method);
    });
  }

  run("AccountService.initializeWithEvents() exists upstream and is used by CLI init and sync paths", () => {
    expect(cliAccount).toContain("initializeWithEvents");
    expect(installedSdkAccountService).toContain("initializeWithEvents");
  });

  // ---------------------------------------------------------------
  // 13. SDK types: upstream crypto module → CLI type imports
  // ---------------------------------------------------------------

  run("CLI uses SDK Hash type from upstream crypto module", () => {
    expect(cliWithdraw).toContain("type Hash as SDKHash");
    expect(installedSdkCrypto).toContain("Hash");
  });

  // ---------------------------------------------------------------
  // 14. DataService + Circuits: upstream SDK → CLI initialization
  // ---------------------------------------------------------------

  run("CLI DataService constructor args match upstream SDK export", () => {
    // CLI passes these config fields when constructing DataService
    expect(cliSdk).toContain("privacyPoolAddress");
    expect(cliSdk).toContain("startBlock");
    expect(installedSdkIndex).toContain("DataService");
  });

  run("CLI-managed circuit artifacts match upstream circuit names and files", () => {
    for (const circuit of ["commitment", "withdraw"]) {
      expect(cliCircuitAssets).toContain(`${circuit}.wasm`);
      expect(cliCircuitAssets).toContain(`${circuit}.zkey`);
      expect(cliCircuitAssets).toContain(`${circuit}.vkey`);
      expect(bundledCircuitFiles).toContain(`${circuit}.wasm`);
      expect(bundledCircuitFiles).toContain(`${circuit}.zkey`);
      expect(bundledCircuitFiles).toContain(`${circuit}.vkey`);
      expect(upstreamCircuitsIndex).toContain(`"${circuit}"`);
    }
  });

  // ---------------------------------------------------------------
  // 15. Contract interaction: SDK methods → CLI usage
  // ---------------------------------------------------------------

  run("CLI local contract writes match upstream deposit, withdraw, and ragequit functions", () => {
    expect(cliContracts).toContain('functionName: "deposit"');
    expect(cliContracts).toContain('functionName: "withdraw"');
    expect(cliContracts).toContain('functionName: "ragequit"');
    expect(upstreamIEntrypoint).toContain("function deposit(");
    expect(upstreamIPrivacyPool).toContain("function withdraw(");
    expect(upstreamIPrivacyPool).toContain("function ragequit(");
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
    expect(upstreamWithdrawInput).toHaveProperty("stateSiblings");
    expect(upstreamWithdrawInput).toHaveProperty("ASPSiblings");
  });

  // ---------------------------------------------------------------
  // 17. Ragequit flow: local proveCommitment → contract ragequit
  // ---------------------------------------------------------------

  run("CLI ragequit calls local proveCommitment then submits ragequit onchain", () => {
    expect(cliRagequit).toContain("proveCommitment");
    expect(cliRagequit).toContain("submitRagequit");
    expect(cliContracts).toContain('functionName: "ragequit"');
    expect(cliProofs).toContain("proveCommitment");
    expect(upstreamIPrivacyPool).toContain("ragequit");
  });

  // ---------------------------------------------------------------
  // 18. Deposit flow: SDK secrets → contract call
  // ---------------------------------------------------------------

  run("CLI deposit generates secrets via SDK and submits deposit transactions locally", () => {
    expect(cliDeposit).toContain("createDepositSecrets");
    expect(cliDeposit).toContain("depositETH(");
    expect(cliDeposit).toContain("depositERC20(");
    expect(cliContracts).toContain('functionName: "deposit"');
    expect(installedSdkAccountService).toContain("createDepositSecrets");
    expect(upstreamIEntrypoint).toContain("function deposit(");
  });
});
