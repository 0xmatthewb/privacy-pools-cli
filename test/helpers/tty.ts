// CI runner env keys that the global-mode resolver and the upgrade-service
// install-context detection short-circuit on. Tests that mock prompts and
// assert on the non-CI branches must run with these stripped; we co-locate
// the strip with setTestTty/restoreTestTty so every prompt-driven test file
// inherits the deterministic env without per-file boilerplate.
const STRIPPED_CI_ENV_KEYS = ["CI", "GITHUB_ACTIONS", "BUILDKITE"] as const;

export const ORIGINAL_TTY_STATE: {
  stdin: boolean | undefined;
  stdout: boolean | undefined;
  stderr: boolean | undefined;
  ciEnv: Record<(typeof STRIPPED_CI_ENV_KEYS)[number], string | undefined>;
} = {
  stdin: process.stdin.isTTY,
  stdout: process.stdout.isTTY,
  stderr: process.stderr.isTTY,
  ciEnv: STRIPPED_CI_ENV_KEYS.reduce(
    (acc, key) => {
      acc[key] = process.env[key];
      return acc;
    },
    {} as Record<(typeof STRIPPED_CI_ENV_KEYS)[number], string | undefined>,
  ),
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

  for (const key of STRIPPED_CI_ENV_KEYS) {
    delete process.env[key];
  }
}

export function restoreTestTty(): void {
  setTestTty({
    stdin: Boolean(ORIGINAL_TTY_STATE.stdin),
    stdout: Boolean(ORIGINAL_TTY_STATE.stdout),
    stderr: Boolean(ORIGINAL_TTY_STATE.stderr),
  });

  for (const key of STRIPPED_CI_ENV_KEYS) {
    const original = ORIGINAL_TTY_STATE.ciEnv[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}
