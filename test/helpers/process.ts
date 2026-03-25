import type { ChildProcess } from "node:child_process";
import type { Signals } from "node:process";

export interface ChildProcessResult {
  code: number | null;
  signal: Signals | null;
  stdout: string;
  stderr: string;
}

export async function terminateChildProcess(
  proc: ChildProcess,
  timeoutMs: number = 2_000,
): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  const exited = new Promise<void>((resolve) => {
    proc.once("exit", () => {
      if (timeout) clearTimeout(timeout);
      resolve();
    });
  });

  proc.kill();
  timeout = setTimeout(() => {
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGKILL");
    }
  }, timeoutMs);
  timeout.unref?.();

  await exited;
}

export async function interruptChildProcess(
  proc: ChildProcess,
  timeoutMs: number = 2_000,
): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      proc.off("exit", onExit);
      proc.off("error", onError);
    };

    const onExit = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    proc.once("exit", onExit);
    proc.once("error", onError);
    proc.kill("SIGINT");

    timeout = setTimeout(() => {
      void terminateChildProcess(proc, timeoutMs)
        .then(() => {
          cleanup();
          resolve();
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    }, timeoutMs);
    timeout.unref?.();
  });
}

export async function waitForChildProcessResult(
  proc: ChildProcess,
  timeoutMs: number = 180_000,
): Promise<ChildProcessResult> {
  let stdout = "";
  let stderr = "";
  let timedOut = false;

  proc.stdout?.setEncoding("utf8");
  proc.stderr?.setEncoding("utf8");

  const onStdout = (chunk: string | Buffer) => {
    stdout += chunk.toString();
  };
  const onStderr = (chunk: string | Buffer) => {
    stderr += chunk.toString();
  };

  proc.stdout?.on("data", onStdout);
  proc.stderr?.on("data", onStderr);

  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<ChildProcessResult>((resolve, reject) => {
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        proc.off("exit", onExit);
        proc.off("error", onError);
        proc.stdout?.off("data", onStdout);
        proc.stderr?.off("data", onStderr);
      };

      const onExit = (code: number | null, signal: Signals | null) => {
        cleanup();
        if (timedOut) {
          reject(
            new Error(
              `Timed out waiting for child process to finish after ${timeoutMs}ms.`,
            ),
          );
          return;
        }
        resolve({ code, signal, stdout, stderr });
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      proc.once("exit", onExit);
      proc.once("error", onError);

      timeout = setTimeout(() => {
        timedOut = true;
        void terminateChildProcess(proc, timeoutMs)
          .then(() => undefined)
          .catch((error) => {
            cleanup();
            reject(error);
          });
      }, timeoutMs);
      timeout.unref?.();
    });
  } finally {
    proc.stdout?.off("data", onStdout);
    proc.stderr?.off("data", onStderr);
  }
}
