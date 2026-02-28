import { Command } from "commander";
/** @internal Exported for unit testing. */
export declare function parsePositiveInt(raw: string | undefined, fieldName: string): number;
/** @internal Exported for unit testing. */
export declare function parseNumberish(value: unknown): number | null;
export declare function createActivityCommand(): Command;
