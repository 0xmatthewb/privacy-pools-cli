import { CLIError } from "./errors.js";
function toBigIntValue(value, label) {
    try {
        return BigInt(value);
    }
    catch {
        throw new CLIError(`Malformed proof field: ${label}.`, "PROOF", "Regenerate the proof and retry.", "PROOF_MALFORMED");
    }
}
export function printRawTransactions(transactions) {
    const toHexQuantity = (value) => {
        const asBigInt = BigInt(value);
        return `0x${asBigInt.toString(16)}`;
    };
    const payload = transactions.map((tx) => ({
        to: tx.to,
        data: tx.data,
        value: tx.value,
        valueHex: toHexQuantity(tx.value),
        chainId: tx.chainId,
        description: tx.description,
    }));
    // Always emit as array for consistent agent parsing
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}
export function toSolidityProof(raw) {
    return {
        pA: [
            toBigIntValue(raw.proof.pi_a[0], "proof.pi_a[0]"),
            toBigIntValue(raw.proof.pi_a[1], "proof.pi_a[1]"),
        ],
        // Solidity verifier layout expects each pair reversed.
        pB: [
            [
                toBigIntValue(raw.proof.pi_b[0][1], "proof.pi_b[0][1]"),
                toBigIntValue(raw.proof.pi_b[0][0], "proof.pi_b[0][0]"),
            ],
            [
                toBigIntValue(raw.proof.pi_b[1][1], "proof.pi_b[1][1]"),
                toBigIntValue(raw.proof.pi_b[1][0], "proof.pi_b[1][0]"),
            ],
        ],
        pC: [
            toBigIntValue(raw.proof.pi_c[0], "proof.pi_c[0]"),
            toBigIntValue(raw.proof.pi_c[1], "proof.pi_c[1]"),
        ],
        pubSignals: raw.publicSignals.map((value, idx) => toBigIntValue(value, `publicSignals[${idx}]`)),
    };
}
export function stringifyBigInts(value) {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (Array.isArray(value)) {
        return value.map((item) => stringifyBigInts(item));
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value).map(([key, item]) => [key, stringifyBigInts(item)]);
        return Object.fromEntries(entries);
    }
    return value;
}
