export const JSON_SCHEMA_VERSION = "1.3.0";
export function printJsonSuccess(payload, pretty = false) {
    const output = {
        schemaVersion: JSON_SCHEMA_VERSION,
        success: true,
        ...payload,
    };
    process.stdout.write(`${JSON.stringify(output, null, pretty ? 2 : 0)}\n`);
}
export function printJsonError(payload, pretty = false) {
    const output = {
        schemaVersion: JSON_SCHEMA_VERSION,
        success: false,
        errorCode: payload.code ?? "UNKNOWN_ERROR",
        errorMessage: payload.message,
        error: payload,
    };
    process.stdout.write(`${JSON.stringify(output, null, pretty ? 2 : 0)}\n`);
}
