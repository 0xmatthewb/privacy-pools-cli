import { afterEach, describe, expect, test } from "bun:test";
import {
  captureAsyncJsonOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";
import {
  createWorkerRequestV1,
  encodeWorkerRequestV1,
  WORKER_REQUEST_ENV,
  WORKER_PROTOCOL_VERSION,
} from "../../src/runtime/v1/request.ts";

const ORIGINAL_REQUEST_ENV = process.env[WORKER_REQUEST_ENV];
const ORIGINAL_CONSOLE = {
  log: console.log,
  info: console.info,
  debug: console.debug,
  warn: console.warn,
  error: console.error,
};

function restoreWorkerEnv(): void {
  if (ORIGINAL_REQUEST_ENV === undefined) {
    delete process.env[WORKER_REQUEST_ENV];
  } else {
    process.env[WORKER_REQUEST_ENV] = ORIGINAL_REQUEST_ENV;
  }
}

function restoreConsole(): void {
  console.log = ORIGINAL_CONSOLE.log;
  console.info = ORIGINAL_CONSOLE.info;
  console.debug = ORIGINAL_CONSOLE.debug;
  console.warn = ORIGINAL_CONSOLE.warn;
  console.error = ORIGINAL_CONSOLE.error;
}

function installWorkerRequest(argv: string[]): void {
  process.env[WORKER_REQUEST_ENV] = encodeWorkerRequestV1(
    createWorkerRequestV1(argv),
  );
}

afterEach(() => {
  restoreWorkerEnv();
  restoreConsole();
});

describe("worker runtime", () => {
  test("runWorkerRequest executes CLI argv through the JS worker boundary", async () => {
    const { runWorkerRequest } = await import(
      `../../src/runtime/v1/worker.ts?worker-runtime-request=${Date.now()}`
    );

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runWorkerRequest({
        protocolVersion: WORKER_PROTOCOL_VERSION,
        argv: ["guide", "--agent"],
      }),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Privacy Pools: Quick Guide");
    expect(stderr).toBe("");
  });

  test("runWorkerFromEnv decodes the worker request from process.env", async () => {
    installWorkerRequest(["capabilities", "--agent"]);
    const { runWorkerFromEnv } = await import(
      `../../src/runtime/v1/worker.ts?worker-runtime-env=${Date.now()}`
    );

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runWorkerFromEnv(),
    );

    expect(json.success).toBe(true);
    expect(Array.isArray(json.commands)).toBe(true);
    expect(json.commands.length).toBeGreaterThan(0);
    expect(stderr).toBe("");
  });

  test("worker-main executes the encoded worker request entrypoint", async () => {
    installWorkerRequest(["guide", "--agent"]);

    const { json, stderr } = await captureAsyncJsonOutput(async () => {
      await import(
        `../../src/runtime/v1/worker-main.ts?worker-main-success=${Date.now()}`
      );
    });

    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Privacy Pools: Quick Guide");
    expect(stderr).toBe("");
  });

  test("worker-main reports bootstrap failures on stderr and exits 1", async () => {
    delete process.env[WORKER_REQUEST_ENV];

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(
      async () => {
        await import(
          `../../src/runtime/v1/worker-main.ts?worker-main-failure=${Date.now()}`
        );
      },
    );

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      `privacy-pools worker error: Missing ${WORKER_REQUEST_ENV}.`,
    );
  });
});
