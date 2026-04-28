export const PROMPT_CANCELLATION_MESSAGE = "Operation cancelled.";
export const PROMPT_INTERACTION_UNAVAILABLE_MESSAGE =
  "Interactive input is required, but no terminal is available.";
export const PROMPT_INTERACTION_UNAVAILABLE_HINT =
  "Provide the required arguments or flags, or re-run from an interactive terminal.";

const PROMPT_INTERACTION_UNAVAILABLE_ERROR_NAME =
  "PromptInteractionUnavailableError";

const PROMPT_CANCELLATION_ERROR_NAMES = new Set([
  "ExitPromptError",
  "CancelPromptError",
  "AbortPromptError",
]);

export class PromptInteractionUnavailableError extends Error {
  readonly code = "PROMPT_REQUIRED_NOT_INTERACTIVE";
  readonly hint: string;

  constructor(
    message: string = PROMPT_INTERACTION_UNAVAILABLE_MESSAGE,
    hint: string = PROMPT_INTERACTION_UNAVAILABLE_HINT,
  ) {
    super(message);
    this.name = PROMPT_INTERACTION_UNAVAILABLE_ERROR_NAME;
    this.hint = hint;
  }
}

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

export function isPromptInteractionUnavailableError(
  error: unknown,
): error is PromptInteractionUnavailableError {
  return (
    error instanceof PromptInteractionUnavailableError ||
    (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name ===
        PROMPT_INTERACTION_UNAVAILABLE_ERROR_NAME
    )
  );
}

export function canPrompt(): boolean {
  const forceTty =
    process.env.PRIVACY_POOLS_FORCE_TTY === "1" ||
    process.env.PRIVACY_POOLS_FORCE_TTY === "true" ||
    process.env.PP_FORCE_TTY === "1" ||
    process.env.PP_FORCE_TTY === "true";
  if (forceTty) {
    return true;
  }
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY);
}

export function ensurePromptInteractionAvailable(): void {
  if (canPrompt()) return;
  throw new PromptInteractionUnavailableError();
}
