export const JSON_SCHEMA_VERSION = "1.1.0";
export function printJsonSuccess(payload, pretty = false) {
    const output = {
        schemaVersion: JSON_SCHEMA_VERSION,
        success: true,
        ...payload,
    };
    console.log(JSON.stringify(output, null, pretty ? 2 : 0));
}
export function printJsonError(payload, pretty = false) {
    const output = {
        schemaVersion: JSON_SCHEMA_VERSION,
        success: false,
        error: payload,
    };
    // Errors go to stderr so stdout remains a clean success-only channel
    process.stderr.write(JSON.stringify(output, null, pretty ? 2 : 0) + "\n");
}
