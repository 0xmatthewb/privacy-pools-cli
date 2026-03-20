function silenceConsole(): () => void {
  const original = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    warn: console.warn,
    error: console.error,
  };

  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
  console.error = () => {};

  return () => {
    console.log = original.log;
    console.info = original.info;
    console.debug = original.debug;
    console.warn = original.warn;
    console.error = original.error;
  };
}

export async function withSuppressedConsole<T>(
  fn: () => Promise<T>,
): Promise<T> {
  const restore = silenceConsole();
  try {
    return await fn();
  } finally {
    restore();
  }
}

export function withSuppressedConsoleSync<T>(fn: () => T): T {
  const restore = silenceConsole();
  try {
    return fn();
  } finally {
    restore();
  }
}

let guardInstalled = false;

export function installConsoleGuard(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
  console.error = () => {};
}
