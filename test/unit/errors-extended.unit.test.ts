import { describe, expect, test } from "bun:test";
import {
  classifyError,
  CLIError,
  accountMigrationReviewIncompleteError,
  accountWebsiteRecoveryRequiredError,
  defaultErrorCode,
  printError,
} from "../../src/utils/errors.ts";

function captureStdout(run: () => void): string {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}

describe("classifyError - contract revert completeness", () => {
  const contractReverts = [
    {
      name: "NullifierAlreadySpent",
      code: "CONTRACT_NULLIFIER_ALREADY_SPENT",
      retryable: false,
    },
    {
      name: "IncorrectASPRoot",
      code: "CONTRACT_INCORRECT_ASP_ROOT",
      retryable: true,
    },
    {
      name: "UnknownStateRoot",
      code: "CONTRACT_UNKNOWN_STATE_ROOT",
      retryable: true,
    },
    {
      name: "ContextMismatch",
      code: "CONTRACT_CONTEXT_MISMATCH",
      retryable: false,
    },
    {
      name: "InvalidProcessooor",
      code: "CONTRACT_INVALID_PROCESSOOOR",
      retryable: false,
    },
    {
      name: "InvalidProof",
      code: "CONTRACT_INVALID_PROOF",
      retryable: false,
    },
    {
      name: "PrecommitmentAlreadyUsed",
      code: "CONTRACT_PRECOMMITMENT_ALREADY_USED",
      retryable: false,
    },
    {
      name: "InvalidCommitment",
      code: "CONTRACT_INVALID_COMMITMENT",
      retryable: false,
    },
    {
      name: "OnlyOriginalDepositor",
      code: "CONTRACT_ONLY_ORIGINAL_DEPOSITOR",
      retryable: false,
    },
    {
      name: "NotYetRagequitteable",
      code: "CONTRACT_NOT_YET_RAGEQUITTEABLE",
      retryable: true,
    },
    {
      name: "NoRootsAvailable",
      code: "CONTRACT_NO_ROOTS_AVAILABLE",
      retryable: true,
    },
    {
      name: "MinimumDepositAmount",
      code: "CONTRACT_MINIMUM_DEPOSIT_AMOUNT",
      retryable: false,
    },
    {
      name: "InvalidWithdrawalAmount",
      code: "CONTRACT_INVALID_WITHDRAWAL_AMOUNT",
      retryable: false,
    },
    {
      name: "PoolNotFound",
      code: "CONTRACT_POOL_NOT_FOUND",
      retryable: false,
    },
    {
      name: "PoolIsDead",
      code: "CONTRACT_POOL_IS_DEAD",
      retryable: false,
    },
    {
      name: "RelayFeeGreaterThanMax",
      code: "CONTRACT_RELAY_FEE_GREATER_THAN_MAX",
      retryable: true,
    },
    {
      name: "InvalidTreeDepth",
      code: "CONTRACT_INVALID_TREE_DEPTH",
      retryable: false,
    },
  ];

  for (const { name, code, retryable } of contractReverts) {
    test(`classifies "${name}" revert correctly`, () => {
      const err = classifyError(new Error(`execution reverted: ${name}`));
      expect(err.category).toBe("CONTRACT");
      expect(err.code).toBe(code);
      expect(err.retryable).toBe(retryable);
      expect(err.hint).toBeTruthy();
    });
  }
});

describe("classifyError - network error variants", () => {
  test("ECONNREFUSED → RPC", () => {
    const err = classifyError(new Error("connect ECONNREFUSED 127.0.0.1:8545"));
    expect(err.category).toBe("RPC");
    expect(err.retryable).toBe(true);
  });

  test("ENOTFOUND → RPC", () => {
    const err = classifyError(new Error("getaddrinfo ENOTFOUND rpc.example.com"));
    expect(err.category).toBe("RPC");
    expect(err.code).toBe("RPC_NETWORK_ERROR");
    expect(err.retryable).toBe(true);
    expect(err.hint).toContain("--rpc-url");
  });

  test("ENETUNREACH → RPC", () => {
    const err = classifyError(new Error("connect ENETUNREACH"));
    expect(err.category).toBe("RPC");
    expect(err.retryable).toBe(true);
  });

  test("EAI_AGAIN (DNS) → RPC", () => {
    const err = classifyError(new Error("getaddrinfo EAI_AGAIN rpc.example.com"));
    expect(err.category).toBe("RPC");
    expect(err.retryable).toBe(true);
  });

  test("timeout → RPC", () => {
    const err = classifyError(new Error("request timeout after 30000ms"));
    expect(err.category).toBe("RPC");
    expect(err.retryable).toBe(true);
    expect(err.hint).toContain("--timeout");
  });

  test("429 rate limit → RPC_RATE_LIMITED", () => {
    const err = classifyError(new Error("HTTP 429: Too Many Requests"));
    expect(err.category).toBe("RPC");
    expect(err.code).toBe("RPC_RATE_LIMITED");
    expect(err.retryable).toBe(true);
    expect(err.hint).toContain("--rpc-url");
  });

  test("rate limit text → RPC_RATE_LIMITED", () => {
    const err = classifyError(new Error("rate limit exceeded for this endpoint"));
    expect(err.category).toBe("RPC");
    expect(err.code).toBe("RPC_RATE_LIMITED");
    expect(err.retryable).toBe(true);
  });

  test("non-Error objects with message string → classified", () => {
    const err = classifyError("fetch failed: network error");
    expect(err.category).toBe("RPC");
  });
});

describe("classifyError - transaction error variants", () => {
  test("insufficient funds → CONTRACT_INSUFFICIENT_FUNDS", () => {
    const err = classifyError(new Error("insufficient funds for gas * price + value"));
    expect(err.category).toBe("CONTRACT");
    expect(err.code).toBe("CONTRACT_INSUFFICIENT_FUNDS");
    expect(err.hint).toContain("ETH");
  });

  test("exceeds the balance → CONTRACT_INSUFFICIENT_FUNDS", () => {
    const err = classifyError(new Error("transaction value exceeds the balance of the account"));
    expect(err.category).toBe("CONTRACT");
    expect(err.code).toBe("CONTRACT_INSUFFICIENT_FUNDS");
  });

  test("nonce too low → CONTRACT_NONCE_ERROR", () => {
    const err = classifyError(new Error("nonce too low: next nonce 5, tx nonce 3"));
    expect(err.category).toBe("CONTRACT");
    expect(err.code).toBe("CONTRACT_NONCE_ERROR");
    expect(err.retryable).toBe(true);
  });

  test("nonce already known → CONTRACT_NONCE_ERROR", () => {
    const err = classifyError(new Error("nonce already known for this sender"));
    expect(err.category).toBe("CONTRACT");
    expect(err.code).toBe("CONTRACT_NONCE_ERROR");
    expect(err.retryable).toBe(true);
  });
});

describe("classifyError - edge cases", () => {
  test("null input → UNKNOWN", () => {
    const err = classifyError(null);
    expect(err.category).toBe("UNKNOWN");
  });

  test("undefined input → UNKNOWN", () => {
    const err = classifyError(undefined);
    expect(err.category).toBe("UNKNOWN");
  });

  test("number input → UNKNOWN", () => {
    const err = classifyError(42);
    expect(err.category).toBe("UNKNOWN");
  });

  test("object without code property → UNKNOWN", () => {
    const err = classifyError({ something: "else" });
    expect(err.category).toBe("UNKNOWN");
  });

  test("object with non-string code → UNKNOWN", () => {
    const err = classifyError({ code: 42 });
    expect(err.category).toBe("UNKNOWN");
  });
});

describe("defaultErrorCode", () => {
  test("returns correct codes for all categories", () => {
    expect(defaultErrorCode("INPUT")).toBe("INPUT_ERROR");
    expect(defaultErrorCode("RPC")).toBe("RPC_ERROR");
    expect(defaultErrorCode("ASP")).toBe("ASP_ERROR");
    expect(defaultErrorCode("RELAYER")).toBe("RELAYER_ERROR");
    expect(defaultErrorCode("PROOF")).toBe("PROOF_ERROR");
    expect(defaultErrorCode("CONTRACT")).toBe("CONTRACT_ERROR");
    expect(defaultErrorCode("UNKNOWN")).toBe("UNKNOWN_ERROR");
  });
});

describe("CLIError constructor", () => {
  test("uses default code from category", () => {
    const err = new CLIError("msg", "INPUT");
    expect(err.code).toBe("INPUT_ERROR");
  });

  test("allows custom code override", () => {
    const err = new CLIError("msg", "INPUT", "hint", "CUSTOM_CODE");
    expect(err.code).toBe("CUSTOM_CODE");
  });

  test("retryable defaults to false", () => {
    const err = new CLIError("msg", "RPC");
    expect(err.retryable).toBe(false);
  });

  test("retryable can be set to true", () => {
    const err = new CLIError("msg", "RPC", "hint", "CODE", true);
    expect(err.retryable).toBe(true);
  });

  test("hint is optional", () => {
    const err = new CLIError("msg", "INPUT");
    expect(err.hint).toBeUndefined();
  });
});

describe("website recovery errors", () => {
  test("uses a distinct machine code for website-based recovery", () => {
    const err = accountWebsiteRecoveryRequiredError();
    expect(err.category).toBe("INPUT");
    expect(err.code).toBe("ACCOUNT_WEBSITE_RECOVERY_REQUIRED");
    expect(err.message).toContain("website-based recovery");
  });

  test("uses a retryable machine code for incomplete legacy review state", () => {
    const err = accountMigrationReviewIncompleteError();
    expect(err.category).toBe("ASP");
    expect(err.code).toBe("ACCOUNT_MIGRATION_REVIEW_INCOMPLETE");
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("could not safely determine");
  });
});

describe("printError", () => {
  test("JSON mode emits structured error to stdout", () => {
    const origExit = process.exit;
    let exitCode: number | undefined;

    process.exit = ((code: number) => { exitCode = code; }) as never;

    try {
      const output = captureStdout(() => {
        printError(new CLIError("test error", "INPUT", "try again"), true);
      });
      const parsed = JSON.parse(output.trim());
      expect(parsed.success).toBe(false);
      expect(parsed.errorCode).toBe("INPUT_ERROR");
      expect(parsed.errorMessage).toBe("test error");
      expect(parsed.error.hint).toBe("try again");
    } finally {
      process.exit = origExit;
    }
    expect(exitCode).toBe(2); // INPUT exit code
  });

  test("human mode writes to stderr via process.stderr.write", () => {
    const stderrOutput: string[] = [];
    const origWrite = process.stderr.write;
    const origExit = process.exit;
    let exitCode: number | undefined;

    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;
    process.exit = ((code: number) => { exitCode = code; }) as never;

    try {
      printError(new CLIError("test error", "ASP", "check ASP"), false);
    } finally {
      process.stderr.write = origWrite;
      process.exit = origExit;
    }

    const combined = stderrOutput.join("");
    expect(combined).toContain("test error");
    expect(combined).toContain("check ASP");
    expect(exitCode).toBe(4); // ASP exit code
  });

  test("classifies unknown errors before printing", () => {
    const origExit = process.exit;

    process.exit = (() => {}) as never;

    try {
      const output = captureStdout(() => {
        printError(new Error("fetch failed: timeout"), true);
      });
      const parsed = JSON.parse(output.trim());
      expect(parsed.error.category).toBe("RPC");
      expect(parsed.errorCode).toBe("RPC_NETWORK_ERROR");
    } finally {
      process.exit = origExit;
    }
  });
});
