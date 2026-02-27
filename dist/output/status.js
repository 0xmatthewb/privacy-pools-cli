/**
 * Output renderer for the `status` command.
 *
 * `src/commands/status.ts` delegates final output here.
 * Health-check execution and config loading remain in the command handler.
 */
import chalk from "chalk";
import { printJsonSuccess, success, warn, info, isSilent } from "./common.js";
/**
 * Render the status command output.
 */
export function renderStatus(ctx, result) {
    if (ctx.mode.isJson) {
        const status = {
            configExists: result.configExists,
            defaultChain: result.defaultChain,
            selectedChain: result.selectedChain,
            rpcUrl: result.rpcUrl,
            mnemonicSet: result.mnemonicSet,
            signerKeySet: result.signerKeySet,
            signerKeyValid: result.signerKeyValid,
            signerAddress: result.signerAddress,
        };
        if (result.aspLive !== undefined)
            status.aspLive = result.aspLive;
        if (result.rpcLive !== undefined)
            status.rpcLive = result.rpcLive;
        printJsonSuccess(status);
        return;
    }
    const silent = isSilent(ctx);
    process.stderr.write(chalk.bold("\nPrivacy Pools CLI Status\n") + "\n");
    // Config
    if (result.configExists) {
        success(`Config: ${result.configDir}/config.json`, silent);
    }
    else {
        warn("Config not found. Run 'privacy-pools init'.", silent);
    }
    // Mnemonic
    if (result.mnemonicSet) {
        success("Recovery phrase: set", silent);
    }
    else {
        warn("Recovery phrase: not set", silent);
    }
    // Signer
    if (result.signerAddress && result.signerKeyValid) {
        success(`Signer: ${result.signerAddress}`, silent);
    }
    else if (result.signerKeySet && !result.signerKeyValid) {
        warn("Signer key is set but invalid. Re-run 'privacy-pools init --private-key ...'.", silent);
    }
    else {
        warn("Signer: not set", silent);
    }
    // Default chain
    const defaultChain = result.defaultChain ?? "none";
    info(`Default chain: ${defaultChain}`, silent);
    if (result.selectedChain) {
        info(`Selected chain: ${result.selectedChain}`, silent);
    }
    // Chain details
    if (result.selectedChain) {
        info(`Contract: ${result.entrypoint}`, silent);
        info(`RPC: ${result.rpcUrl}`, silent);
        const checks = result.healthChecksEnabled;
        if (ctx.isVerbose && checks) {
            info(`Health checks: rpc=${checks.rpc ? "enabled" : "disabled"}, asp=${checks.asp ? "enabled" : "disabled"}`, silent);
        }
        if (result.aspLive !== undefined) {
            if (result.aspLive) {
                success(`ASP (${result.aspHost}): healthy`, silent);
            }
            else {
                warn(`ASP (${result.aspHost}): unreachable`, silent);
            }
        }
        if (result.rpcLive !== undefined) {
            if (result.rpcLive) {
                success(`RPC: connected (block ${result.rpcBlockNumber})`, silent);
            }
            else {
                warn("RPC: unreachable", silent);
            }
        }
        if (result.aspLive === undefined && result.rpcLive === undefined) {
            info("Health checks skipped. Use --check-rpc and/or --check-asp.", silent);
        }
    }
    // Account files
    process.stderr.write("\n");
    info("Account files:", silent);
    for (const [name, _chainId] of result.accountFiles) {
        process.stderr.write(`  ${chalk.green("●")} ${name} (chain ${_chainId})\n`);
    }
    process.stderr.write("\n");
}
