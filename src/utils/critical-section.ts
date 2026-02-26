/**
 * Defers SIGINT/SIGTERM during critical transaction windows
 * (between on-chain confirmation and local state persistence).
 *
 * If a signal arrives while the guard is active, it is held until
 * `release()` is called, then re-emitted so the process exits cleanly.
 */

let _pending: NodeJS.Signals | null = null;
let _active = false;

function onSignal(sig: NodeJS.Signals) {
  _pending = sig;
}

export function guardCriticalSection(): void {
  _pending = null;
  _active = true;
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}

export function releaseCriticalSection(): void {
  if (!_active) return;
  _active = false;
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);
  if (_pending) {
    process.kill(process.pid, _pending);
  }
}
