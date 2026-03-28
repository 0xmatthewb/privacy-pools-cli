/**
 * Protocol conformance: cross-checks CLI source code against the canonical
 * upstream repos (main branch) to catch drift between the CLI and the
 * protocol.  Every test reads BOTH the upstream file AND the local CLI
 * source, then asserts alignment between the two.
 *
 * Source of truth (main branch):
 *   Core:     https://github.com/0xbow-io/privacy-pools-core
 *   Frontend: https://github.com/0xbow-io/privacy-pools-website
 *
 * @frontend-parity
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "bun:test";
import {
  CORE_REPO,
  FRONTEND_REPO,
  fetchGitHubFile,
} from "../helpers/github.ts";
import { CLI_ROOT } from "../helpers/paths.ts";

// --- Upstream content (populated in beforeAll) ---

let upstreamDeployments = "";
let upstreamSdkRef = "";
let upstreamContractsRef = "";
let upstreamIPrivacyPool = "";
let upstreamIEntrypoint = "";
let upstreamCircuitsIndex = "";
let upstreamCopyScript = "";
let upstreamWithdrawInput = { stateSiblings: [] as string[], ASPSiblings: [] as string[] };
let upstreamAspClient = "";
let upstreamRelayerClient = "";
let upstreamSdkIndex = "";
let upstreamSdkCrypto = "";
let upstreamAccountService = "";
let upstreamIState = "";

// --- CLI source code (read synchronously) ---

const cliChains = readFileSync(resolve(CLI_ROOT, "src/config/chains.ts"), "utf8");
const cliWithdraw = readFileSync(resolve(CLI_ROOT, "src/commands/withdraw.ts"), "utf8");
const cliRagequit = readFileSync(resolve(CLI_ROOT, "src/commands/ragequit.ts"), "utf8");
const cliDeposit = readFileSync(resolve(CLI_ROOT, "src/commands/deposit.ts"), "utf8");
const cliAsp = readFileSync(resolve(CLI_ROOT, "src/services/asp.ts"), "utf8");
const cliRelayer = readFileSync(resolve(CLI_ROOT, "src/services/relayer.ts"), "utf8");
const cliPools = readFileSync(resolve(CLI_ROOT, "src/services/pools.ts"), "utf8");
const cliSdk = readFileSync(resolve(CLI_ROOT, "src/services/sdk.ts"), "utf8");
const cliCircuits = readFileSync(resolve(CLI_ROOT, "src/services/circuits.ts"), "utf8");
const cliContracts = readFileSync(resolve(CLI_ROOT, "src/services/contracts.ts"), "utf8");
const cliProofs = readFileSync(resolve(CLI_ROOT, "src/services/proofs.ts"), "utf8");
const cliWallet = readFileSync(resolve(CLI_ROOT, "src/services/wallet.ts"), "utf8");
const cliAccount = readFileSync(resolve(CLI_ROOT, "src/services/account.ts"), "utf8");
const cliUnsignedFlows = readFileSync(resolve(CLI_ROOT, "src/utils/unsigned-flows.ts"), "utf8");

let fetchFailed = false;

describe("protocol conformance: CLI ↔ upstream", () => {
  beforeAll(async () => {
    try {
      [
        upstreamDeployments,
        upstreamSdkRef,
        upstreamContractsRef,
        upstreamIPrivacyPool,
        upstreamIEntrypoint,
        upstreamCircuitsIndex,
        upstreamCopyScript,
        upstreamAspClient,
        upstreamRelayerClient,
        upstreamSdkIndex,
        upstreamSdkCrypto,
        upstreamAccountService,
        upstreamIState,
      ] = await Promise.all([
        fetchGitHubFile(CORE_REPO, "docs/docs/deployments.md"),
        fetchGitHubFile(CORE_REPO, "docs/docs/reference/sdk.md"),
        fetchGitHubFile(CORE_REPO, "docs/docs/reference/contracts.md"),
        fetchGitHubFile(CORE_REPO, "packages/contracts/src/interfaces/IPrivacyPool.sol"),
        fetchGitHubFile(CORE_REPO, "packages/contracts/src/interfaces/IEntrypoint.sol"),
        fetchGitHubFile(CORE_REPO, "packages/circuits/src/index.ts"),
        fetchGitHubFile(CORE_REPO, "packages/sdk/scripts/copy_circuits.sh"),
        fetchGitHubFile(FRONTEND_REPO, "src/utils/aspClient.ts"),
        fetchGitHubFile(FRONTEND_REPO, "src/utils/relayerClient.ts"),
        fetchGitHubFile(CORE_REPO, "packages/sdk/src/index.ts"),
        fetchGitHubFile(CORE_REPO, "packages/sdk/src/crypto.ts"),
        fetchGitHubFile(CORE_REPO, "packages/sdk/src/core/account.service.ts"),
        fetchGitHubFile(CORE_REPO, "packages/contracts/src/interfaces/IState.sol"),
      ]);

      const rawInput = await fetchGitHubFile(
        CORE_REPO,
        "packages/circuits/inputs/withdraw/default.json",
      );
      upstreamWithdrawInput = JSON.parse(rawInput);
    } catch (err) {
      console.warn("Skipping protocol conformance — could not fetch upstream files:", err);
      fetchFailed = true;
    }
  });

  test("upstream fetch succeeded (canary — all protocol tests below are skipped if this fails)", () => {
    if (fetchFailed) {
      console.warn("WARN: upstream GitHub fetch failed — protocol conformance tests are NOT running");
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
  // 1. Deployment addresses: upstream docs → CLI chain config
  // ---------------------------------------------------------------

  run("CLI chain config includes entrypoint address from upstream deployments", () => {
    const entrypointProxy = "0x6818809eefce719e480a7526d76bd3e561526b46";
    expect(upstreamDeployments.toLowerCase()).toContain(entrypointProxy);
    expect(cliChains.toLowerCase()).toContain(entrypointProxy);
  });

  // ---------------------------------------------------------------
  // 2. SDK documented methods: CLI calls → upstream SDK reference
  //    Checks against the docs (sdk.md). Section 8 checks against
  //    the actual source code for functions not in the docs.
  // ---------------------------------------------------------------

  for (const method of ["proveWithdrawal", "proveCommitment"]) {
    run(`CLI proof helper "${method}" exists in upstream SDK reference`, () => {
      const cliAll = cliWithdraw + cliRagequit + cliProofs;
      expect(cliAll).toContain(method);
      expect(upstreamSdkRef).toContain(method);
    });
  }

  // ---------------------------------------------------------------
  // 3. Contract read-only ABI: CLI pools.ts ↔ upstream Solidity
  // ---------------------------------------------------------------

  run("CLI assetConfig ABI field names match upstream IEntrypoint.sol", () => {
    for (const field of ["assetConfig", "minimumDepositAmount", "vettingFeeBPS", "maxRelayFeeBPS"]) {
      expect(cliPools).toContain(field);
      expect(upstreamIEntrypoint).toContain(field);
    }
  });

  run("CLI SCOPE() call matches upstream contract docs", () => {
    expect(cliPools).toContain("SCOPE()");
    expect(upstreamContractsRef).toContain("SCOPE()");
  });

  // ---------------------------------------------------------------
  // 4. Tree depth: upstream circuits ↔ CLI hardcoded values
  // ---------------------------------------------------------------

  run("CLI tree depth (32) matches upstream circuit config", () => {
    expect(upstreamCircuitsIndex).toContain("params: [32]");
    expect(cliWithdraw).toContain("stateTreeDepth: 32n");
    expect(cliWithdraw).toContain("aspTreeDepth: 32n");
    expect(upstreamWithdrawInput.stateSiblings.length).toBe(32);
    expect(upstreamWithdrawInput.ASPSiblings.length).toBe(32);
  });

  // ---------------------------------------------------------------
  // 5. API endpoints: CLI ↔ upstream frontend
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
  // 6. Circuit artifacts: upstream internal consistency
  //    (Not a CLI check — catches upstream inconsistency that would
  //     break our SDK dependency.)
  // ---------------------------------------------------------------

  run("upstream circuit compile config and copy script are consistent", () => {
    expect(upstreamCircuitsIndex).toContain('compile("commitment"');
    expect(upstreamCircuitsIndex).toContain('compile("withdraw"');
    expect(upstreamCopyScript).toContain('CIRCUITS=("commitment" "withdraw")');
  });

  // ---------------------------------------------------------------
  // 7. SDK class exports: upstream barrel → CLI imports
  // ---------------------------------------------------------------

  for (const name of ["AccountService", "DataService"]) {
    run(`SDK class "${name}" exported by upstream and imported by CLI`, () => {
      const cliAll = cliSdk + cliAccount;
      expect(cliAll).toContain(name);
      expect(upstreamSdkIndex).toContain(name);
    });
  }

  // ---------------------------------------------------------------
  // 8. SDK crypto functions: upstream source → CLI imports
  //    These functions are not in sdk.md but the CLI depends on
  //    them. Checked against actual source code (crypto.ts).
  // ---------------------------------------------------------------

  for (const { fn, cli } of [
    { fn: "generateMasterKeys", cli: cliWallet },
    { fn: "calculateContext", cli: cliWithdraw },
    { fn: "generateMerkleProof", cli: cliWithdraw },
  ]) {
    run(`SDK function "${fn}" exists in upstream crypto module and CLI`, () => {
      expect(cli).toContain(fn);
      expect(upstreamSdkCrypto).toContain(fn);
    });
  }

  // ---------------------------------------------------------------
  // 9. [Removed] Unsigned ABI signature checks — superseded by
  //    semantic 4-byte selector parity in abi-selector-parity.conformance.test.ts
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // 10. IPrivacyPool.sol: events and structs ↔ CLI decoding
  // ---------------------------------------------------------------

  run("CLI Deposited event parameter names match upstream IPrivacyPool.sol", () => {
    for (const param of ["_depositor", "_commitment", "_label", "_value", "_precommitmentHash"]) {
      expect(cliDeposit).toContain(param);
      expect(upstreamIPrivacyPool).toContain(param);
    }
  });

  run("CLI Deposited event signature shape matches upstream IPrivacyPool.sol", () => {
    // The CLI hardcodes a parseAbi for the Deposited event in deposit.ts.
    // If the upstream changes parameter types or indexed modifiers, the
    // CLI would silently decode events incorrectly, producing wrong account
    // state.  This checks the full signature, not just parameter names.
    const cliEventSig =
      "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)";
    expect(cliDeposit).toContain(cliEventSig);

    // Upstream must define the same event shape (whitespace may differ)
    expect(upstreamIPrivacyPool).toContain("event Deposited(");
    expect(upstreamIPrivacyPool).toContain("address indexed _depositor");
    // Non-indexed params: verify types are uint256
    for (const field of ["uint256 _commitment", "uint256 _label", "uint256 _value", "uint256 _precommitmentHash"]) {
      expect(upstreamIPrivacyPool).toContain(field);
    }
  });

  run("upstream IPrivacyPool.sol defines Withdrawn and Ragequit events the CLI rebuild path depends on", () => {
    expect(cliAccount).toContain("initializeWithEvents");
    expect(upstreamIPrivacyPool).toContain("event Withdrawn");
    expect(upstreamIPrivacyPool).toContain("event Ragequit");
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

  run("upstream IState.sol defines currentRoot the CLI reads for stale-state checks", () => {
    // CLI reads currentRoot from the pool contract (distinct from entrypoint latestRoot)
    expect(cliWithdraw).toContain("currentRoot");

    // currentRoot is defined in IState.sol (inherited by IPrivacyPool)
    expect(upstreamIState).toContain("currentRoot");

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
      expect(upstreamAccountService).toContain(method);
    });
  }

  run("AccountService.initializeWithEvents() exists upstream and is used by CLI init and sync paths", () => {
    expect(cliAccount).toContain("initializeWithEvents");
    expect(upstreamAccountService).toContain("initializeWithEvents");
  });

  // ---------------------------------------------------------------
  // 13. SDK types: upstream crypto module → CLI type imports
  // ---------------------------------------------------------------

  run("CLI uses SDK Hash type from upstream crypto module", () => {
    expect(cliWithdraw).toContain("type Hash as SDKHash");
    expect(upstreamSdkCrypto).toContain("Hash");
  });

  // ---------------------------------------------------------------
  // 14. DataService + Circuits: upstream SDK → CLI initialization
  // ---------------------------------------------------------------

  run("CLI DataService constructor args match upstream SDK export", () => {
    // CLI passes these config fields when constructing DataService
    expect(cliSdk).toContain("privacyPoolAddress");
    expect(cliSdk).toContain("startBlock");
    expect(upstreamSdkIndex).toContain("DataService");
  });

  run("CLI-managed circuit artifacts match upstream circuit names and files", () => {
    for (const circuit of ["commitment", "withdraw"]) {
      expect(cliCircuits).toContain(`${circuit}.wasm`);
      expect(cliCircuits).toContain(`${circuit}.zkey`);
      expect(cliCircuits).toContain(`${circuit}.vkey`);
      expect(upstreamCopyScript).toContain(circuit);
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
    expect(upstreamAccountService).toContain("createDepositSecrets");
    expect(upstreamIEntrypoint).toContain("function deposit(");
  });
});
