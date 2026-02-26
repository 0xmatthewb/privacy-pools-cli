import chalk from "chalk";
import { printJsonError } from "./json.js";
export const EXIT_CODES = {
    UNKNOWN: 1,
    INPUT: 2,
    RPC: 3,
    ASP: 4,
    RELAYER: 5,
    PROOF: 6,
    CONTRACT: 7,
};
export function exitCodeForCategory(category) {
    return EXIT_CODES[category];
}
const DEFAULT_CODE_BY_CATEGORY = {
    INPUT: "INPUT_ERROR",
    RPC: "RPC_ERROR",
    ASP: "ASP_ERROR",
    RELAYER: "RELAYER_ERROR",
    PROOF: "PROOF_ERROR",
    CONTRACT: "CONTRACT_ERROR",
    UNKNOWN: "UNKNOWN_ERROR",
};
export function defaultErrorCode(category) {
    return DEFAULT_CODE_BY_CATEGORY[category];
}
export class CLIError extends Error {
    category;
    hint;
    code;
    retryable;
    constructor(message, category, hint, code = defaultErrorCode(category), retryable = false) {
        super(message);
        this.category = category;
        this.hint = hint;
        this.code = code;
        this.retryable = retryable;
        this.name = "CLIError";
    }
}
const CONTRACT_ERROR_MAP = {
    NullifierAlreadySpent: {
        message: "This commitment has already been withdrawn.",
        hint: "Each commitment can only be spent once. Check your balance for other spendable commitments.",
        code: "CONTRACT_NULLIFIER_ALREADY_SPENT",
    },
    IncorrectASPRoot: {
        message: "ASP root mismatch - the on-chain root has changed since proof generation.",
        hint: "Re-fetch ASP data and regenerate the proof. The ASP root is baked into the proof.",
        code: "CONTRACT_INCORRECT_ASP_ROOT",
        retryable: true,
    },
    InvalidProcessooor: {
        message: "Withdrawal type mismatch.",
        hint: "For direct withdrawal, processooor must be your signer address. For relayed, it must be the entrypoint address.",
        code: "CONTRACT_INVALID_PROCESSOOOR",
    },
    InvalidProof: {
        message: "ZK proof verification failed on-chain.",
        hint: "Check that circuit inputs (value, label, nullifier, secret) match the original deposit.",
        code: "CONTRACT_INVALID_PROOF",
    },
    PrecommitmentAlreadyUsed: {
        message: "This precommitment hash was already used in a previous deposit.",
        hint: "Generate a new deposit with a fresh index.",
        code: "CONTRACT_PRECOMMITMENT_ALREADY_USED",
    },
    OnlyOriginalDepositor: {
        message: "Only the original depositor can ragequit.",
        hint: "Ragequit must be called from the same address that made the deposit.",
        code: "CONTRACT_ONLY_ORIGINAL_DEPOSITOR",
    },
    NoRootsAvailable: {
        message: "No ASP roots have been pushed on-chain yet.",
        hint: "Wait for the ASP to publish the first root, then retry.",
        code: "CONTRACT_NO_ROOTS_AVAILABLE",
        retryable: true,
    },
};
export function classifyError(error) {
    if (error instanceof CLIError)
        return error;
    const message = error instanceof Error ? error.message : String(error);
    // Check for known contract revert reasons
    for (const [key, mapped] of Object.entries(CONTRACT_ERROR_MAP)) {
        if (message.includes(key)) {
            return new CLIError(mapped.message, "CONTRACT", mapped.hint, mapped.code, mapped.retryable ?? false);
        }
    }
    // Check for SDK error codes
    if (hasCode(error)) {
        const code = error.code;
        if (code === "MERKLE_ERROR") {
            return new CLIError("Commitment not found in the Merkle tree.", "PROOF", "The commitment may not be indexed yet, or you're using stale tree data. Re-sync and retry.", "PROOF_MERKLE_ERROR", true);
        }
        if (code === "PROOF_GENERATION_FAILED") {
            return new CLIError("Proof generation failed.", "PROOF", "Check that value, label, nullifier, and secret match the original deposit.", "PROOF_GENERATION_FAILED");
        }
    }
    // Network/RPC errors
    if (message.includes("fetch") ||
        message.includes("ECONNREFUSED") ||
        message.includes("timeout")) {
        return new CLIError(`Network error: ${message}`, "RPC", "Check your RPC URL and network connectivity.", "RPC_NETWORK_ERROR", true);
    }
    return new CLIError(message, "UNKNOWN");
}
function hasCode(error) {
    return (typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string");
}
export function printError(error, json = false) {
    const classified = classifyError(error);
    if (json) {
        printJsonError({
            code: classified.code,
            category: classified.category,
            message: classified.message,
            hint: classified.hint,
            retryable: classified.retryable,
        }, false);
    }
    else {
        console.error(chalk.red(`Error [${classified.category}]: ${classified.message}`));
        if (classified.hint) {
            console.error(chalk.yellow(`Hint: ${classified.hint}`));
        }
    }
    process.exit(EXIT_CODES[classified.category]);
}
