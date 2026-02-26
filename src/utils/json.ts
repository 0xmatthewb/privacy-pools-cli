export const JSON_SCHEMA_VERSION = "1.1.0";

export function printJsonSuccess(
  payload: object,
  pretty: boolean = false
): void {
  const output = {
    schemaVersion: JSON_SCHEMA_VERSION,
    success: true,
    ...payload,
  };
  console.log(JSON.stringify(output, null, pretty ? 2 : 0));
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
    error: payload,
  };
  // Errors go to stderr so stdout remains a clean success-only channel
  process.stderr.write(JSON.stringify(output, null, pretty ? 2 : 0) + "\n");
}
