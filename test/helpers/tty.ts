export const ORIGINAL_TTY_STATE = {
  stdin: process.stdin.isTTY,
  stdout: process.stdout.isTTY,
  stderr: process.stderr.isTTY,
};

export function setTestTty(options: {
  stdin?: boolean;
  stdout?: boolean;
  stderr?: boolean;
} = {}): void {
  const stdin = options.stdin ?? true;
  const stdout = options.stdout ?? true;
  const stderr = options.stderr ?? stdout;

  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: stdin,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: stdout,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: stderr,
  });
}

export function restoreTestTty(): void {
  setTestTty({
    stdin: Boolean(ORIGINAL_TTY_STATE.stdin),
    stdout: Boolean(ORIGINAL_TTY_STATE.stdout),
    stderr: Boolean(ORIGINAL_TTY_STATE.stderr),
  });
}
