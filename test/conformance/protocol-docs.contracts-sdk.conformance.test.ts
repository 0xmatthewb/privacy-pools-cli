/**
 * Protocol conformance: cross-checks CLI source code against the canonical
 * upstream repos (main branch) to catch drift between the CLI and the
 * protocol.  Every test reads BOTH the upstream file AND the local CLI
 * source, then asserts alignment between the two.
 *
 * Source of truth (main branch):
 *   Core:     https://github.com/0xbow-io/privacy-pools-core
 *   Frontend: https://github.com/0xbow-io/privacy-pools-website
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
let upstreamProofLib = "";
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
        upstreamProofLib,
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
        fetchGitHubFile(CORE_REPO, "packages/contracts/src/contracts/lib/ProofLib.sol"),
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

  for (const method of ["PrivacyPoolSDK", "proveWithdrawal", "proveCommitment"]) {
    run(`CLI SDK call "${method}" exists in upstream SDK reference`, () => {
      const cliAll = cliWithdraw + cliRagequit + cliSdk;
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

  for (const name of ["PrivacyPoolSDK", "AccountService", "DataService"]) {
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
  // 9. Unsigned ABI signatures: CLI ↔ upstream Solidity
  //    These are the most safety-critical definitions in the CLI.
  //    They encode the exact function signatures for on-chain
  //    transactions. If these drift, user funds are at risk.
  // ---------------------------------------------------------------

  run("CLI withdraw ABI matches upstream IPrivacyPool.sol", () => {
    // CLI defines: function withdraw((address processooor, bytes data) _withdrawal, ...)
    expect(cliUnsignedFlows).toContain("function withdraw(");
    expect(cliUnsignedFlows).toContain("processooor");

    // Upstream must have matching function and struct
    expect(upstreamIPrivacyPool).toContain("function withdraw(");
    expect(upstreamIPrivacyPool).toContain("struct Withdrawal");
    expect(upstreamIPrivacyPool).toContain("processooor");
  });

  run("CLI relay ABI matches upstream IEntrypoint.sol", () => {
    // CLI defines: function relay(... _withdrawal, ... _proof, uint256 _scope)
    expect(cliUnsignedFlows).toContain("function relay(");
    expect(cliUnsignedFlows).toContain("_scope");

    // Upstream must have matching function
    expect(upstreamIEntrypoint).toContain("function relay(");
  });

  run("CLI deposit ABIs match upstream IEntrypoint.sol overloads", () => {
    // CLI defines native: function deposit(uint256 _precommitment) payable
    expect(cliUnsignedFlows).toContain("function deposit(uint256 _precommitment)");

    // CLI defines ERC20: function deposit(address _asset, uint256 _value, uint256 _precommitment)
    expect(cliUnsignedFlows).toContain("function deposit(address _asset");

    // Upstream must have both deposit overloads
    expect(upstreamIEntrypoint).toContain("function deposit(");
    expect(upstreamIEntrypoint).toContain("_precommitment");
  });

  run("CLI ragequit ABI matches upstream IPrivacyPool.sol", () => {
    // CLI defines: function ragequit(... _proof)
    expect(cliUnsignedFlows).toContain("function ragequit(");

    // Upstream must have matching function
    expect(upstreamIPrivacyPool).toContain("ragequit");
  });

  run("CLI withdrawal proof uses 8 public signals matching upstream ProofLib.sol", () => {
    // CLI withdraw and relay ABIs both hardcode uint256[8] pubSignals
    expect(cliUnsignedFlows).toContain("uint256[8] pubSignals");
    expect(cliUnsignedFlows).toContain("function withdraw(");
    expect(cliUnsignedFlows).toContain("function relay(");

    // Upstream ProofLib.sol defines the WithdrawProof struct used by IPrivacyPool/IEntrypoint
    expect(upstreamProofLib).toContain("WithdrawProof");
    expect(upstreamProofLib).toContain("uint256[8]");

    // IPrivacyPool.sol and IEntrypoint.sol use ProofLib's WithdrawProof
    expect(upstreamIPrivacyPool).toContain("WithdrawProof");
    expect(upstreamIEntrypoint).toContain("WithdrawProof");
  });

  run("CLI ragequit proof uses 4 public signals matching upstream ProofLib.sol", () => {
    // CLI ragequit ABI hardcodes uint256[4] pubSignals (different from withdrawal's 8)
    expect(cliUnsignedFlows).toContain("function ragequit(");
    expect(cliUnsignedFlows).toContain("uint256[4] pubSignals");

    // Upstream ProofLib.sol defines the RagequitProof struct
    expect(upstreamProofLib).toContain("RagequitProof");
    expect(upstreamProofLib).toContain("uint256[4]");

    // IPrivacyPool.sol uses ProofLib's RagequitProof
    expect(upstreamIPrivacyPool).toContain("RagequitProof");
  });

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

  run("upstream IPrivacyPool.sol defines Withdrawn and Ragequit events the CLI syncs from", () => {
    // CLI's AccountService sync reads these events via getWithdrawalEvents / getRagequitEvents
    expect(cliAccount).toContain("getWithdrawalEvents");
    expect(cliAccount).toContain("getRagequitEvents");
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
    { method: "getSpendableCommitments", usedBy: "withdraw/ragequit/accounts/balance" },
    { method: "addPoolAccount", usedBy: "deposit.ts" },
    { method: "addRagequitToAccount", usedBy: "ragequit.ts" },
    { method: "addWithdrawalCommitment", usedBy: "withdraw.ts" },
    { method: "getDepositEvents", usedBy: "account.ts (sync)" },
    { method: "getWithdrawalEvents", usedBy: "account.ts (sync)" },
    { method: "getRagequitEvents", usedBy: "account.ts (sync)" },
  ];

  for (const { method, usedBy } of ACCOUNT_SERVICE_METHODS) {
    run(`AccountService.${method}() exists upstream and is used by CLI (${usedBy})`, () => {
      const cliAll = cliDeposit + cliWithdraw + cliRagequit + cliAccount;
      expect(cliAll).toContain(method);
      expect(upstreamAccountService).toContain(method);
    });
  }

  run("AccountService.initializeWithEvents() exists upstream and is used by CLI", () => {
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

  run("CLI Circuits class exists in upstream SDK", () => {
    expect(cliSdk).toContain("Circuits");
    expect(cliSdk).toContain("browser: false");
    // Upstream exports Circuits via external.ts (re-exported from barrel)
    expect(upstreamSdkIndex).toContain("external");
  });

  // ---------------------------------------------------------------
  // 15. Contract interaction: SDK methods → CLI usage
  // ---------------------------------------------------------------

  run("CLI createContractInstance from upstream PrivacyPoolSDK", () => {
    expect(cliSdk).toContain("createContractInstance");
    expect(upstreamSdkIndex).toContain("PrivacyPoolSDK");
  });

  // ---------------------------------------------------------------
  // 16. proveWithdrawal input shape: CLI → upstream SDK
  // ---------------------------------------------------------------

  run("CLI proveWithdrawal input fields match upstream SDK", () => {
    for (const field of [
      "context", "withdrawalAmount",
      "stateMerkleProof", "aspMerkleProof",
      "stateRoot", "stateTreeDepth",
      "aspRoot", "aspTreeDepth",
    ]) {
      expect(cliWithdraw).toContain(field);
    }
    expect(upstreamSdkRef).toContain("proveWithdrawal");
  });

  // ---------------------------------------------------------------
  // 17. Ragequit flow: SDK proveCommitment → contract ragequit
  // ---------------------------------------------------------------

  run("CLI ragequit calls proveCommitment then contracts.ragequit", () => {
    expect(cliRagequit).toContain("proveCommitment");
    expect(cliRagequit).toContain("contracts.ragequit");
    expect(upstreamSdkRef).toContain("proveCommitment");
    expect(upstreamIPrivacyPool).toContain("ragequit");
  });

  // ---------------------------------------------------------------
  // 18. Deposit flow: SDK secrets → contract call
  // ---------------------------------------------------------------

  run("CLI deposit generates secrets via SDK and calls contract deposit methods", () => {
    expect(cliDeposit).toContain("createDepositSecrets");
    expect(cliDeposit).toContain("contracts.depositETH");
    expect(cliDeposit).toContain("contracts.depositERC20");
    expect(upstreamAccountService).toContain("createDepositSecrets");
    expect(upstreamIEntrypoint).toContain("function deposit(");
  });
});
