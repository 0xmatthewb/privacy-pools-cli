import type { Ora } from "ora";
/**
 * Wraps an async proof-generation call with a spinner that shows elapsed time.
 * Prevents the "frozen spinner" effect during 10-30+ second ZK proof generation.
 */
export declare function withProofProgress<T>(spin: Ora, label: string, fn: () => Promise<T>): Promise<T>;
