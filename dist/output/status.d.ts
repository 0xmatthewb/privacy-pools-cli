/**
 * Output renderer for the `status` command.
 *
 * Phase 3 – src/commands/status.ts delegates all final output here.
 * Health-check execution and config loading remain in the command handler.
 */
import type { OutputContext } from "./common.js";
export interface StatusCheckResult {
    configExists: boolean;
    configDir: string | null;
    defaultChain: string | null;
    selectedChain: string | null;
    rpcUrl: string | null;
    mnemonicSet: boolean;
    signerKeySet: boolean;
    signerKeyValid: boolean;
    signerAddress: string | null;
    entrypoint: string | null;
    aspHost: string | null;
    /** Health check results (only present when checks are run). */
    aspLive?: boolean;
    rpcLive?: boolean;
    rpcBlockNumber?: bigint;
    /** Whether each health check was enabled. */
    healthChecksEnabled?: {
        rpc: boolean;
        asp: boolean;
    };
    /** Account files that exist, as [chainName, chainId] tuples. */
    accountFiles: [string, number][];
}
/**
 * Render the status command output.
 */
export declare function renderStatus(ctx: OutputContext, result: StatusCheckResult): void;
