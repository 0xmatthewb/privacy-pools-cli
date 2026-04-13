import {
  configExists,
  loadSignerKey,
  mnemonicExists,
} from "../services/config.js";

export function getWelcomeReadinessLabel(): string {
  try {
    const hasRecoveryPhrase = mnemonicExists();
    const hasConfig = configExists();
    const hasSignerKey =
      loadSignerKey() !== null ||
      (process.env.PRIVACY_POOLS_PRIVATE_KEY?.trim().length ?? 0) > 0;

    if (!hasRecoveryPhrase && !hasConfig) {
      return "setup: run init";
    }

    if (hasRecoveryPhrase && hasSignerKey) {
      return "setup: ready";
    }

    if (hasRecoveryPhrase) {
      return "setup: read-only";
    }

    return "setup: check status";
  } catch {
    return "setup: check status";
  }
}
