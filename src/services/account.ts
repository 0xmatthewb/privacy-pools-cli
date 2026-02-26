import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { AccountService, DataService, type PoolInfo } from "@0xbow/privacy-pools-core-sdk";
import type { Address } from "viem";
import { getAccountsDir, ensureConfigDir } from "./config.js";
import type { ChainConfig } from "../types.js";
import { CLIError } from "../utils/errors.js";

// BigInt + Map aware JSON serializer
function serialize(value: unknown): string {
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
function deserialize(raw: string): unknown {
  return JSON.parse(raw, (_key, val) => {
    if (val?.__type === "bigint") return BigInt(val.value);
    if (val?.__type === "map") return new Map(val.value);
    return val;
  });
}

function getAccountFilePath(chainId: number): string {
  return join(getAccountsDir(), `${chainId}.json`);
}

export function accountExists(chainId: number): boolean {
  return existsSync(getAccountFilePath(chainId));
}

export function loadAccount(chainId: number): any | null {
  const path = getAccountFilePath(chainId);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function saveAccount(chainId: number, account: any): void {
  ensureConfigDir();
  const path = getAccountFilePath(chainId);
  writeFileSync(path, serialize(account), { encoding: "utf-8", mode: 0o600 });
}

/**
 * Cast raw pool data to SDK PoolInfo (handles branded Hash type for scope)
 */
export function toPoolInfo(pool: {
  chainId: number;
  address: Address;
  scope: bigint;
  deploymentBlock: bigint;
}): PoolInfo {
  return pool as unknown as PoolInfo;
}

export async function syncAccount(
  chainConfig: ChainConfig,
  accountService: AccountService,
  pools: Array<{ address: Address; scope: bigint; deploymentBlock: bigint }>
): Promise<void> {
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
    } catch (err) {
      // Log to stderr so callers are aware sync failed for this pool
      process.stderr.write(
        `Warning: sync failed for pool ${pool.address}: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  // Persist updated state
  saveAccount(chainConfig.id, accountService.account);
}

export async function initializeAccountService(
  dataService: DataService,
  mnemonic: string,
  pools: Array<{
    chainId: number;
    address: Address;
    scope: bigint;
    deploymentBlock: bigint;
  }>,
  chainId: number,
  /** When true, sync events even for saved accounts to catch external changes */
  forceSync: boolean = false,
  /** When true, suppress best-effort sync warnings to keep machine stderr clean */
  suppressWarnings: boolean = false,
  /** When true, treat sync/initialization failures as hard errors (fail-closed). */
  strictSync: boolean = false
): Promise<AccountService> {
  // Try to load existing account state
  const savedAccount = loadAccount(chainId);

  if (savedAccount) {
    const service = new AccountService(dataService, { account: savedAccount });

    // Sync to pick up any events that happened since last save
    if (forceSync && pools.length > 0) {
      let syncFailures = 0;
      for (const pool of pools) {
        const poolInfo = toPoolInfo(pool);
        try {
          await service.getDepositEvents(poolInfo);
          await service.getWithdrawalEvents(poolInfo);
          await service.getRagequitEvents(poolInfo);
        } catch (err) {
          syncFailures++;
          if (!suppressWarnings) {
            process.stderr.write(
              `Warning: sync failed for pool ${pool.address}: ${err instanceof Error ? err.message : String(err)}\n`
            );
          }
        }
      }
      if (strictSync && syncFailures > 0) {
        throw new CLIError(
          `Failed to sync account state for ${syncFailures} pool(s).`,
          "RPC",
          "Check your RPC connectivity and retry."
        );
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
      const result = await AccountService.initializeWithEvents(
        dataService,
        { mnemonic },
        poolInfos
      );

      const initErrors = result.errors ?? [];
      if (initErrors.length > 0) {
        const details = initErrors
          .slice(0, 3)
          .map((e) => `scope ${e.scope.toString()}: ${e.reason}`)
          .join("; ");

        if (strictSync) {
          throw new CLIError(
            `Failed to initialize account from on-chain events for ${initErrors.length} pool(s). ${details}`,
            "RPC",
            "Check your RPC connectivity and retry."
          );
        }

        if (!suppressWarnings) {
          process.stderr.write(
            `Warning: account initialization had partial failures for ${initErrors.length} pool(s): ${details}\n`
          );
        }
      }

      // Save the initialized account
      saveAccount(chainId, result.account.account);
      return result.account;
    } catch (err) {
      if (strictSync) {
        throw new CLIError(
          `Failed to initialize account from on-chain events: ${err instanceof Error ? err.message : String(err)}`,
          "RPC",
          "Check your RPC connectivity and retry."
        );
      }
      if (!suppressWarnings) {
        process.stderr.write(
          `Warning: fresh account initialization failed, using empty account: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }

  return accountService;
}
