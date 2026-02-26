export declare const JSON_SCHEMA_VERSION = "1.1.0";
export declare function printJsonSuccess(payload: object, pretty?: boolean): void;
export declare function printJsonError(payload: {
    code?: string;
    category: string;
    message: string;
    hint?: string;
    retryable?: boolean;
}, pretty?: boolean): void;
