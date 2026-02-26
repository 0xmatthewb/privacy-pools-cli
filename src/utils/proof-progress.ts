import type { Ora } from "ora";

/**
 * Wraps an async proof-generation call with a spinner that shows elapsed time.
 * Prevents the "frozen spinner" effect during 10-30+ second ZK proof generation.
 */
export async function withProofProgress<T>(
  spin: Ora,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  spin.text = `${label}...`;

  const interval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    if (elapsed < 10) {
      spin.text = `${label}... (${elapsed}s)`;
    } else if (elapsed < 30) {
      spin.text = `${label}... (${elapsed}s) - this may take a moment`;
    } else {
      spin.text = `${label}... (${elapsed}s) - almost there`;
    }
  }, 1000);

  try {
    const result = await fn();
    clearInterval(interval);
    return result;
  } catch (error) {
    clearInterval(interval);
    throw error;
  }
}
