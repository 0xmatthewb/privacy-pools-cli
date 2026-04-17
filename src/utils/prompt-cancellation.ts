export const PROMPT_CANCELLATION_MESSAGE = "Operation cancelled.";

const PROMPT_CANCELLATION_ERROR_NAMES = new Set([
  "ExitPromptError",
  "CancelPromptError",
  "AbortPromptError",
]);

export function isPromptCancellationError(error: unknown): boolean {
  if (typeof error === "string") {
    const normalized = error.trim().toLowerCase();
    return (
      normalized === PROMPT_CANCELLATION_MESSAGE.toLowerCase() ||
      normalized === "cancelled" ||
      normalized === "canceled"
    );
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const name = "name" in error && typeof (error as { name?: unknown }).name === "string"
    ? (error as { name: string }).name
    : null;
  if (name && PROMPT_CANCELLATION_ERROR_NAMES.has(name)) {
    return true;
  }

  const message = "message" in error && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message.trim().toLowerCase()
    : null;
  return (
    message === PROMPT_CANCELLATION_MESSAGE.toLowerCase() ||
    message === "cancelled" ||
    message === "canceled"
  );
}

export function canPrompt(): boolean {
  if (process.env.PP_FORCE_TTY === "1" || process.env.PP_FORCE_TTY === "true") {
    return true;
  }
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function ensurePromptInteractionAvailable(): void {
  if (canPrompt()) return;
  const error = new Error(PROMPT_CANCELLATION_MESSAGE) as Error & { name: string };
  error.name = "AbortPromptError";
  throw error;
}
