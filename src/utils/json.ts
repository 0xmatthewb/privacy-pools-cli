export const JSON_SCHEMA_VERSION = "1.6.0";

export function jsonContractDocRelativePath(
  schemaVersion: string = JSON_SCHEMA_VERSION,
): string {
  return `docs/contracts/cli-json-contract.v${schemaVersion}.json`;
}

/** Safety-net replacer: converts any BigInt to string so JSON.stringify never throws. */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function printJsonSuccess(
  payload: object,
  pretty: boolean = false
): void {
  const output = {
    schemaVersion: JSON_SCHEMA_VERSION,
    success: true,
    ...payload,
  };
  process.stdout.write(`${JSON.stringify(output, bigintReplacer, pretty ? 2 : 0)}\n`);
}

export function printJsonError(
  payload: {
    code?: string;
    category: string;
    message: string;
    hint?: string;
    retryable?: boolean;
  },
  pretty: boolean = false
): void {
  const output: Record<string, unknown> = {
    schemaVersion: JSON_SCHEMA_VERSION,
    success: false,
    errorCode: payload.code ?? "UNKNOWN_ERROR",
    errorMessage: payload.message,
    error: payload,
  };
  process.stdout.write(`${JSON.stringify(output, bigintReplacer, pretty ? 2 : 0)}\n`);
}
