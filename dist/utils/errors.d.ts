export type ErrorCategory = "INPUT" | "RPC" | "ASP" | "RELAYER" | "PROOF" | "CONTRACT" | "UNKNOWN";
export declare const EXIT_CODES: Record<ErrorCategory, number>;
export declare function exitCodeForCategory(category: ErrorCategory): number;
export declare function defaultErrorCode(category: ErrorCategory): string;
export declare class CLIError extends Error {
    readonly category: ErrorCategory;
    readonly hint?: string | undefined;
    readonly code: string;
    readonly retryable: boolean;
    constructor(message: string, category: ErrorCategory, hint?: string | undefined, code?: string, retryable?: boolean);
}
export declare function classifyError(error: unknown): CLIError;
export declare function printError(error: unknown, json?: boolean): void;
