export const PROMPT_CANCELLATION_MESSAGE = "Operation cancelled.";

const PROMPT_CANCELLATION_ERROR_NAMES = new Set([
  "ExitPromptError",
  "CancelPromptError",
  "AbortPromptError",
]);

export function isPromptCancellationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if (!("name" in error) || typeof (error as { name?: unknown }).name !== "string") {
    return false;
  }

  return PROMPT_CANCELLATION_ERROR_NAMES.has((error as { name: string }).name);
}

export function ensurePromptInteractionAvailable(): void {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return;
  }

  const error = new Error(PROMPT_CANCELLATION_MESSAGE) as Error & { name: string };
  error.name = "AbortPromptError";
  throw error;
}
