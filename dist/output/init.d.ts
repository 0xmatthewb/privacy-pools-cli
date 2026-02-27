/**
 * Output renderer for the `init` command.
 *
 * Phase 4 – handles the final result output only.
 * Interactive flow messages (mnemonic display, verification, inline warnings)
 * remain in the command handler.
 */
import type { OutputContext } from "./common.js";
export interface InitRenderResult {
    defaultChain: string;
    signerKeySet: boolean;
    /** True when mnemonic was imported (not generated). */
    mnemonicImported: boolean;
    /** True when --show-mnemonic was passed. */
    showMnemonic: boolean;
    /** The mnemonic phrase (included only when showMnemonic && !mnemonicImported). */
    mnemonic?: string;
}
/**
 * Render the init command final output.
 */
export declare function renderInitResult(ctx: OutputContext, result: InitRenderResult): void;
