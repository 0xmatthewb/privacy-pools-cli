import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { getAccountsDir, ensureConfigDir } from "./config.js";
import { CLIError } from "../utils/errors.js";
// BigInt + Map aware JSON serializer
function serialize(value) {
    return JSON.stringify(value, (_key, val) => {
        if (typeof val === "bigint") {
            return { __type: "bigint", value: val.toString() };
        }
        if (val instanceof Map) {
            return { __type: "map", value: Array.from(val.entries()) };
        }
        return val;
    }, 2);
}
// BigInt + Map aware JSON deserializer
function deserialize(raw) {
    return JSON.parse(raw, (_key, val) => {
        if (val?.__type === "bigint")
            return BigInt(val.value);
        if (val?.__type === "map")
            return new Map(val.value);
        return val;
    });
}
function getAccountFilePath(chainId) {
    return join(getAccountsDir(), `${chainId}.json`);
}
export function accountExists(chainId) {
    return existsSync(getAccountFilePath(chainId));
}
export function loadAccount(chainId) {
    const path = getAccountFilePath(chainId);
    if (!existsSync(path))
        return null;
    try {
        const raw = readFileSync(path, "utf-8");
        return deserialize(raw);
    }
    catch {
        return null;
    }
}
export function saveAccount(chainId, account) {
    ensureConfigDir();
    const path = getAccountFilePath(chainId);
    const tmpPath = path + ".tmp";
    writeFileSync(tmpPath, serialize(account), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmpPath, path);
}
/**
 * Cast raw pool data to SDK PoolInfo (handles branded Hash type for scope)
 */
export function toPoolInfo(pool) {
    return pool;
}
/**
 * The SDK emits info logs with console.log in some account paths.
 * Suppress stdout temporarily so machine-mode JSON contracts remain parseable.
 */
export async function withSuppressedSdkStdout(fn) {
    const originalLog = console.log;
    console.log = () => { };
    try {
        return await fn();
    }
    finally {
        console.log = originalLog;
    }
}
export async function initializeAccountService(dataService, mnemonic, pools, chainId, 
/** When true, sync events even for saved accounts to catch external changes */
forceSync = false, 
/** When true, suppress best-effort sync warnings to keep machine stderr clean */
suppressWarnings = false, 
/** When true, treat sync/initialization failures as hard errors (fail-closed). */
strictSync = false) {
    // Try to load existing account state
    const savedAccount = loadAccount(chainId);
    if (savedAccount) {
        const service = await withSuppressedSdkStdout(async () => new AccountService(dataService, { account: savedAccount }));
        // Sync to pick up any events that happened since last save
        if (forceSync && pools.length > 0) {
            let syncFailures = 0;
            for (const pool of pools) {
                const poolInfo = toPoolInfo(pool);
                try {
                    await withSuppressedSdkStdout(async () => {
                        await service.getDepositEvents(poolInfo);
                        await service.getWithdrawalEvents(poolInfo);
                        await service.getRagequitEvents(poolInfo);
                    });
                }
                catch (err) {
                    syncFailures++;
                    if (!suppressWarnings) {
                        process.stderr.write(`Warning: sync failed for pool ${pool.address}: ${err instanceof Error ? err.message : String(err)}\n`);
                    }
                }
            }
            if (strictSync && syncFailures > 0) {
                throw new CLIError(`Failed to sync account state for ${syncFailures} pool(s).`, "RPC", "Check your RPC connectivity and retry.");
            }
            // Caller is responsible for saving within a critical section guard.
        }
        return service;
    }
    // Fresh initialization
    const accountService = await withSuppressedSdkStdout(async () => new AccountService(dataService, { mnemonic }));
    // Initialize with events if pools are provided
    if (pools.length > 0) {
        try {
            const poolInfos = pools.map(toPoolInfo);
            const result = await withSuppressedSdkStdout(async () => AccountService.initializeWithEvents(dataService, { mnemonic }, poolInfos));
            const initErrors = result.errors ?? [];
            if (initErrors.length > 0) {
                const details = initErrors
                    .slice(0, 3)
                    .map((e) => `scope ${e.scope.toString()}: ${e.reason}`)
                    .join("; ");
                if (strictSync) {
                    throw new CLIError(`Failed to initialize account from on-chain events for ${initErrors.length} pool(s). ${details}`, "RPC", "Check your RPC connectivity and retry.");
                }
                if (!suppressWarnings) {
                    process.stderr.write(`Warning: account initialization had partial failures for ${initErrors.length} pool(s): ${details}\n`);
                }
            }
            // Save the initialized account
            saveAccount(chainId, result.account.account);
            return result.account;
        }
        catch (err) {
            if (strictSync) {
                throw new CLIError(`Failed to initialize account from on-chain events: ${err instanceof Error ? err.message : String(err)}`, "RPC", "Check your RPC connectivity and retry.");
            }
            if (!suppressWarnings) {
                process.stderr.write(`Warning: fresh account initialization failed, using empty account: ${err instanceof Error ? err.message : String(err)}\n`);
            }
        }
    }
    return accountService;
}
