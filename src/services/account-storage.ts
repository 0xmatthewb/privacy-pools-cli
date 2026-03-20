import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { getAccountsDir, ensureConfigDir } from "./config.js";
import { CLIError } from "../utils/errors.js";

function getAccountFilePath(chainId: number): string {
  return join(getAccountsDir(), `${chainId}.json`);
}

// BigInt + Map aware JSON serializer
/** @internal Exported for testing only. */
export function serialize(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val === "bigint") {
        return { __type: "bigint", value: val.toString() };
      }
      if (val instanceof Map) {
        return { __type: "map", value: Array.from(val.entries()) };
      }
      return val;
    },
    2,
  );
}

// BigInt + Map aware JSON deserializer
/** @internal Exported for testing only. */
export function deserialize(raw: string): unknown {
  return JSON.parse(raw, (_key, val) => {
    if (val?.__type === "bigint") return BigInt(val.value);
    if (val?.__type === "map") return new Map(val.value);
    return val;
  });
}

export function accountExists(chainId: number): boolean {
  return existsSync(getAccountFilePath(chainId));
}

/** Check if a value is a non-empty Map (deserialized or raw serialized form). */
function mapHasEntries(value: unknown): boolean {
  if (value instanceof Map) return value.size > 0;
  if (
    typeof value === "object" &&
    value !== null &&
    (value as any).__type === "map" &&
    Array.isArray((value as any).value)
  ) {
    return (value as any).value.length > 0;
  }
  return false;
}

export function loadAccount(chainId: number): any | null {
  const path = getAccountFilePath(chainId);
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    return deserialize(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CLIError(
      `Account file is corrupt or unreadable: ${path}`,
      "INPUT",
      `Back up and remove the file, then run 'privacy-pools sync' to rebuild from onchain data. (${msg})`,
    );
  }
}

export function saveAccount(chainId: number, account: any): void {
  ensureConfigDir();
  const path = getAccountFilePath(chainId);
  const tmpPath = path + ".tmp";
  writeFileSync(tmpPath, serialize(account), {
    encoding: "utf-8",
    mode: 0o600,
  });
  renameSync(tmpPath, path);
}

/**
 * Check whether the account file for a chain contains any deposits.
 *
 * `accountExists()` only checks whether the file is present, but the SDK
 * creates empty account files during `initializeAccountService()` even when
 * no deposits exist. This function loads the file and inspects both the
 * `commitments` map (SDK runtime state) and the `poolAccounts` map (durable
 * historical source used by `history`, `pool-accounts`, and integration tests)
 * to determine if the user has actually deposited.
 *
 * Returns `false` when the file doesn't exist, is empty, or both maps have
 * zero entries.
 */
export function accountHasDeposits(chainId: number): boolean {
  const account = loadAccount(chainId);
  if (!account) return false;

  if (mapHasEntries(account.commitments)) return true;
  if (mapHasEntries(account.poolAccounts)) return true;

  return false;
}
