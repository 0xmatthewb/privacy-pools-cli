import type { Address, Hex } from "viem";
type BigNumberish = bigint | number | string;
interface Groth16Like {
    proof: {
        pi_a: [BigNumberish, BigNumberish, ...BigNumberish[]];
        pi_b: [[BigNumberish, BigNumberish], [BigNumberish, BigNumberish], ...Array<[BigNumberish, BigNumberish]>];
        pi_c: [BigNumberish, BigNumberish, ...BigNumberish[]];
    };
    publicSignals: BigNumberish[];
}
export interface SolidityProof {
    pA: [bigint, bigint];
    pB: [[bigint, bigint], [bigint, bigint]];
    pC: [bigint, bigint];
    pubSignals: bigint[];
}
export interface UnsignedTransactionPayload {
    chainId: number;
    from: Address | null;
    to: Address;
    value: string;
    data: Hex;
    description: string;
}
export declare function printRawTransactions(transactions: UnsignedTransactionPayload[]): void;
export declare function toSolidityProof(raw: Groth16Like): SolidityProof;
export declare function stringifyBigInts(value: unknown): unknown;
export {};
