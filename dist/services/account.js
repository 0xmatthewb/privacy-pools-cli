import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { AccountService } from "@0xbow/privacy-pools-core-sdk";
import { getAccountsDir, ensureConfigDir } from "./config.js";
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
    writeFileSync(path, serialize(account), { encoding: "utf-8", mode: 0o600 });
}
/**
 * Cast raw pool data to SDK PoolInfo (handles branded Hash type for scope)
 */
export function toPoolInfo(pool) {
    return pool;
}
export async function syncAccount(chainConfig, accountService, pools) {
    for (const pool of pools) {
        const poolInfo = toPoolInfo({
            chainId: chainConfig.id,
            address: pool.address,
            scope: pool.scope,
            deploymentBlock: pool.deploymentBlock,
        });
        try {
            await accountService.getDepositEvents(poolInfo);
            await accountService.getWithdrawalEvents(poolInfo);
            await accountService.getRagequitEvents(poolInfo);
        }
        catch (err) {
            // Log to stderr so callers are aware sync failed for this pool
            process.stderr.write(`Warning: sync failed for pool ${pool.address}: ${err instanceof Error ? err.message : String(err)}\n`);
        }
    }
    // Persist updated state
    saveAccount(chainConfig.id, accountService.account);
}
export async function initializeAccountService(dataService, mnemonic, pools, chainId, 
/** When true, sync events even for saved accounts to catch external changes */
forceSync = false) {
    // Try to load existing account state
    const savedAccount = loadAccount(chainId);
    if (savedAccount) {
        const service = new AccountService(dataService, { account: savedAccount });
        // Sync to pick up any events that happened since last save
        if (forceSync && pools.length > 0) {
            for (const pool of pools) {
                const poolInfo = toPoolInfo(pool);
                try {
                    await service.getDepositEvents(poolInfo);
                    await service.getWithdrawalEvents(poolInfo);
                    await service.getRagequitEvents(poolInfo);
                }
                catch (err) {
                    process.stderr.write(`Warning: sync failed for pool ${pool.address}: ${err instanceof Error ? err.message : String(err)}\n`);
                }
            }
            saveAccount(chainId, service.account);
        }
        return service;
    }
    // Fresh initialization
    const accountService = new AccountService(dataService, { mnemonic });
    // Initialize with events if pools are provided
    if (pools.length > 0) {
        try {
            const poolInfos = pools.map(toPoolInfo);
            const result = await AccountService.initializeWithEvents(dataService, { mnemonic }, poolInfos);
            // Save the initialized account
            saveAccount(chainId, result.account.account);
            return result.account;
        }
        catch (err) {
            process.stderr.write(`Warning: fresh account initialization failed, using empty account: ${err instanceof Error ? err.message : String(err)}\n`);
        }
    }
    return accountService;
}
