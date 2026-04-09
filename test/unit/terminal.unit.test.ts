import { afterEach, describe, expect, test } from "bun:test";
import {
  getOutputWidthClass,
  getTerminalColumns,
} from "../../src/utils/terminal.ts";

const originalPreviewColumns = process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS;
const originalColumnsEnv = process.env.COLUMNS;
const originalStderrColumns = Object.getOwnPropertyDescriptor(
  process.stderr,
  "columns",
);
const originalStdoutColumns = Object.getOwnPropertyDescriptor(
  process.stdout,
  "columns",
);

function restoreColumnsProperty(
  target: NodeJS.WriteStream,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, "columns", descriptor);
  } else {
    Reflect.deleteProperty(target, "columns");
  }
}

function setStreamColumns(
  target: NodeJS.WriteStream,
  value: number | undefined,
): void {
  Object.defineProperty(target, "columns", {
    configurable: true,
    get: () => value,
  });
}

describe("terminal width resolution", () => {
  afterEach(() => {
    if (originalPreviewColumns === undefined) {
      delete process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS;
    } else {
      process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS = originalPreviewColumns;
    }

    if (originalColumnsEnv === undefined) {
      delete process.env.COLUMNS;
    } else {
      process.env.COLUMNS = originalColumnsEnv;
    }

    restoreColumnsProperty(process.stderr, originalStderrColumns);
    restoreColumnsProperty(process.stdout, originalStdoutColumns);
  });

  test("prefers the explicit argument over env and live stream widths", () => {
    process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS = "90";
    process.env.COLUMNS = "80";
    setStreamColumns(process.stderr, 70);
    setStreamColumns(process.stdout, 60);

    expect(getTerminalColumns(50)).toBe(50);
  });

  test("prefers preview columns over COLUMNS and live streams", () => {
    process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS = "72";
    process.env.COLUMNS = "90";
    setStreamColumns(process.stderr, 110);
    setStreamColumns(process.stdout, 100);

    expect(getTerminalColumns()).toBe(72);
    expect(getOutputWidthClass()).toBe("narrow");
  });

  test("uses COLUMNS when preview width is unset", () => {
    delete process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS;
    process.env.COLUMNS = "50";
    setStreamColumns(process.stderr, undefined);
    setStreamColumns(process.stdout, undefined);

    expect(getTerminalColumns()).toBe(50);
    expect(getOutputWidthClass()).toBe("narrow");
  });

  test("falls back from stderr columns to stdout columns", () => {
    delete process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS;
    delete process.env.COLUMNS;
    setStreamColumns(process.stderr, undefined);
    setStreamColumns(process.stdout, 88);

    expect(getTerminalColumns()).toBe(88);
    expect(getOutputWidthClass()).toBe("compact");
  });

  test("clamps resolved widths to the supported range", () => {
    delete process.env.PRIVACY_POOLS_CLI_PREVIEW_COLUMNS;
    process.env.COLUMNS = "20";
    setStreamColumns(process.stderr, undefined);
    setStreamColumns(process.stdout, undefined);
    expect(getTerminalColumns()).toBe(40);

    process.env.COLUMNS = "240";
    expect(getTerminalColumns()).toBe(120);
  });
});
