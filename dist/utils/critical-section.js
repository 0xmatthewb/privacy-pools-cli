/**
 * Defers SIGINT/SIGTERM during critical transaction windows
 * (between on-chain confirmation and local state persistence).
 *
 * If a signal arrives while the guard is active, it is held until
 * `release()` is called, then re-emitted so the process exits cleanly.
 */
let _pending = null;
let _depth = 0;
function onSignal(sig) {
    _pending = sig;
}
export function guardCriticalSection() {
    if (_depth === 0) {
        _pending = null;
        process.on("SIGINT", onSignal);
        process.on("SIGTERM", onSignal);
    }
    _depth += 1;
}
export function releaseCriticalSection() {
    if (_depth === 0)
        return;
    _depth -= 1;
    if (_depth > 0)
        return;
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    const pending = _pending;
    _pending = null;
    if (pending) {
        process.kill(process.pid, pending);
    }
}
