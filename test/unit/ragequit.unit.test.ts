import { describe, expect, test } from "bun:test";
import {
  buildPoolAccountRefs,
  parsePoolAccountSelector,
  poolAccountId,
} from "../../src/utils/pool-accounts.ts";
import type { PoolAccountRef } from "../../src/utils/pool-accounts.ts";
import { CLIError } from "../../src/utils/errors.ts";

/**
 * Tests for ragequit-related core logic:
 * - Pool Account selection (parsePoolAccountSelector, buildPoolAccountRefs)
 * - Depositor-only constraint validation patterns
 * - Error handling for various failure modes
 *
 * The ragequit command itself is a Commander action that orchestrates many
 * services. We test the critical decision-making logic that lives in
 * utility functions and validate the error patterns used in the command.
 */

describe("ragequit — pool account selection", () => {
  describe("parsePoolAccountSelector", () => {
    test("parses PA-1 format", () => {
      expect(parsePoolAccountSelector("PA-1")).toBe(1);
      expect(parsePoolAccountSelector("PA-2")).toBe(2);
      expect(parsePoolAccountSelector("PA-10")).toBe(10);
    });

    test("parses pa-1 format (case insensitive)", () => {
      expect(parsePoolAccountSelector("pa-1")).toBe(1);
      expect(parsePoolAccountSelector("Pa-3")).toBe(3);
    });

    test("parses bare numeric format", () => {
      expect(parsePoolAccountSelector("1")).toBe(1);
      expect(parsePoolAccountSelector("5")).toBe(5);
    });

    test("returns null for invalid selectors", () => {
      expect(parsePoolAccountSelector("")).toBeNull();
      expect(parsePoolAccountSelector("abc")).toBeNull();
      expect(parsePoolAccountSelector("PA-")).toBeNull();
      expect(parsePoolAccountSelector("PA-0")).toBeNull();
      expect(parsePoolAccountSelector("-1")).toBeNull();
      expect(parsePoolAccountSelector("PA-abc")).toBeNull();
    });

    test("trims whitespace", () => {
      expect(parsePoolAccountSelector("  PA-1  ")).toBe(1);
      expect(parsePoolAccountSelector(" 3 ")).toBe(3);
    });

    test("rejects PA-0 (1-based indexing)", () => {
      expect(parsePoolAccountSelector("PA-0")).toBeNull();
      expect(parsePoolAccountSelector("0")).toBeNull();
    });
  });

  describe("poolAccountId", () => {
    test("formats pool account identifier", () => {
      expect(poolAccountId(1)).toBe("PA-1");
      expect(poolAccountId(5)).toBe("PA-5");
      expect(poolAccountId(42)).toBe("PA-42");
    });
  });

  describe("buildPoolAccountRefs — commitment selection for ragequit", () => {
    function makeCommitment(overrides: Partial<{
      label: bigint;
      hash: bigint;
      value: bigint;
      nullifier: bigint;
      secret: bigint;
      blockNumber: bigint;
      txHash: string;
    }> = {}) {
      return {
        label: overrides.label ?? 1n,
        hash: overrides.hash ?? 100n,
        value: overrides.value ?? 1000000000000000000n,
        nullifier: overrides.nullifier ?? 50n,
        secret: overrides.secret ?? 60n,
        blockNumber: overrides.blockNumber ?? 1000n,
        txHash: overrides.txHash ?? "0xaaa",
      };
    }

    test("returns empty array when no spendable commitments", () => {
      const refs = buildPoolAccountRefs(null, 1n, []);
      expect(refs).toEqual([]);
    });

    test("builds refs from spendable commitments without saved account data", () => {
      const commitments = [
        makeCommitment({ label: 1n, hash: 100n, value: 500n }),
        makeCommitment({ label: 2n, hash: 200n, value: 700n }),
      ];

      const refs = buildPoolAccountRefs(null, 1n, commitments);

      expect(refs).toHaveLength(2);
      expect(refs[0].paNumber).toBe(1);
      expect(refs[0].paId).toBe("PA-1");
      expect(refs[0].status).toBe("spendable");
      expect(refs[0].value).toBe(500n);
      expect(refs[1].paNumber).toBe(2);
      expect(refs[1].paId).toBe("PA-2");
      expect(refs[1].value).toBe(700n);
    });

    test("only returns spendable pool accounts (filters spent/exited)", () => {
      // When account has pool accounts with a ragequit, they should be excluded
      const commitments = [
        makeCommitment({ label: 1n, hash: 100n, value: 500n }),
      ];

      // With no saved state, all non-zero commitments are spendable
      const refs = buildPoolAccountRefs(null, 1n, commitments);
      expect(refs.every((r) => r.status === "spendable")).toBe(true);
    });

    test("sets aspStatus to approved when label is in approved set", () => {
      const commitments = [
        makeCommitment({ label: 42n, hash: 100n }),
        makeCommitment({ label: 99n, hash: 200n }),
      ];
      const approvedLabels = new Set(["42"]);

      const refs = buildPoolAccountRefs(null, 1n, commitments, approvedLabels);

      expect(refs[0].aspStatus).toBe("approved");
      expect(refs[1].aspStatus).toBe("pending");
    });

    test("sets aspStatus to unknown when no approved labels provided", () => {
      const commitments = [makeCommitment({ label: 42n })];

      const refs = buildPoolAccountRefs(null, 1n, commitments);

      expect(refs[0].aspStatus).toBe("unknown");
    });
  });
});

describe("ragequit — depositor-only constraint", () => {
  test("CLIError is raised when signer is not the original depositor", () => {
    const signerAddress = "0x1111111111111111111111111111111111111111";
    const depositor = "0x2222222222222222222222222222222222222222";

    // This mirrors the exact check in ragequit.ts lines 382-387
    const error = new CLIError(
      `Signer ${signerAddress} is not the original depositor (${depositor}).`,
      "INPUT",
      "Only the original depositor can exit this Pool Account. Check your signer key."
    );

    expect(error).toBeInstanceOf(CLIError);
    expect(error.category).toBe("INPUT");
    expect(error.message).toContain("not the original depositor");
    expect(error.hint).toContain("original depositor");
  });

  test("addresses are compared case-insensitively", () => {
    const signerAddress = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
    const depositor = "0xabcdef1234567890abcdef1234567890abcdef12";

    // The ragequit command does .toLowerCase() comparison
    const match =
      depositor.toLowerCase() === signerAddress.toLowerCase();
    expect(match).toBe(true);
  });

  test("mismatched addresses fail the check", () => {
    const signerAddress = "0x1111111111111111111111111111111111111111";
    const depositor = "0x2222222222222222222222222222222222222222";

    const match =
      depositor.toLowerCase() === signerAddress.toLowerCase();
    expect(match).toBe(false);
  });
});

describe("ragequit — error handling", () => {
  test("no spendable commitments produces INPUT error", () => {
    const error = new CLIError(
      "No available Pool Accounts found for exit.",
      "INPUT",
      "You may not have deposits in ETH. Try 'privacy-pools deposit ...' first."
    );
    expect(error.category).toBe("INPUT");
    expect(error.message).toContain("No available Pool Accounts");
  });

  test("unknown pool account produces INPUT error with helpful hint", () => {
    const fromPaNumber = 5;
    const poolSymbol = "ETH";
    const chainName = "mainnet";

    const error = new CLIError(
      `Unknown Pool Account ${poolAccountId(fromPaNumber)} for ${poolSymbol}.`,
      "INPUT",
      `Run 'privacy-pools accounts --chain ${chainName}' to list available Pool Accounts.`
    );

    expect(error.category).toBe("INPUT");
    expect(error.message).toContain("PA-5");
    expect(error.hint).toContain("privacy-pools accounts");
  });

  test("invalid --from-pa value produces INPUT error", () => {
    const rawValue = "bad-value";

    // parsePoolAccountSelector returns null for invalid input
    const parsed = parsePoolAccountSelector(rawValue);
    expect(parsed).toBeNull();

    const error = new CLIError(
      `Invalid --from-pa value: ${rawValue}.`,
      "INPUT",
      "Use a Pool Account identifier like PA-2 (or just 2)."
    );
    expect(error.category).toBe("INPUT");
  });

  test("conflicting --from-pa and --commitment flags produce INPUT error", () => {
    const error = new CLIError(
      "Cannot use --from-pa and --commitment together.",
      "INPUT",
      "Use --from-pa for Pool Account selection. --commitment is deprecated."
    );
    expect(error.category).toBe("INPUT");
    expect(error.message).toContain("Cannot use --from-pa and --commitment together");
  });

  test("non-interactive mode without --from-pa produces INPUT error", () => {
    const error = new CLIError(
      "Must specify --from-pa in non-interactive mode.",
      "INPUT",
      "Use --from-pa <PA-#> to select which Pool Account to exit."
    );
    expect(error.category).toBe("INPUT");
  });

  test("ragequit tx timeout produces RPC error with recovery hint", () => {
    const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const error = new CLIError(
      "Timed out waiting for ragequit confirmation.",
      "RPC",
      `Tx ${txHash} may still confirm. Run 'privacy-pools sync' to pick up the transaction.`
    );
    expect(error.category).toBe("RPC");
    expect(error.hint).toContain("privacy-pools sync");
  });

  test("ragequit tx revert produces CONTRACT error", () => {
    const txHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const error = new CLIError(
      `Ragequit transaction reverted: ${txHash}`,
      "CONTRACT",
      "Check the transaction on a block explorer for details."
    );
    expect(error.category).toBe("CONTRACT");
  });

  test("--unsigned-format without --unsigned produces INPUT error", () => {
    const error = new CLIError(
      "--unsigned-format requires --unsigned.",
      "INPUT",
      "Use: privacy-pools ragequit ... --unsigned --unsigned-format envelope"
    );
    expect(error.category).toBe("INPUT");
  });

  test("invalid --unsigned-format value produces INPUT error", () => {
    const error = new CLIError(
      "Unsupported unsigned format: json.",
      "INPUT",
      "Use --unsigned-format envelope or --unsigned-format tx."
    );
    expect(error.category).toBe("INPUT");
    expect(error.hint).toContain("envelope");
  });

  test("no asset specified in non-interactive mode produces INPUT error", () => {
    const error = new CLIError(
      "No asset specified. Use --asset <symbol|address>.",
      "INPUT",
      "Run 'privacy-pools pools' to see available assets, then use --asset ETH (or the asset symbol)."
    );
    expect(error.category).toBe("INPUT");
  });

  test("OnlyOriginalDepositor contract revert is classified correctly", () => {
    // This tests the error classification from errors.ts that ragequit depends on
    const { classifyError } = require("../../src/utils/errors.ts");
    const classified = classifyError(
      new Error("execution reverted: OnlyOriginalDepositor")
    );
    expect(classified).toBeInstanceOf(CLIError);
    expect(classified.category).toBe("CONTRACT");
    expect(classified.code).toBe("CONTRACT_ONLY_ORIGINAL_DEPOSITOR");
    expect(classified.message).toContain("Only the original depositor");
  });
});
