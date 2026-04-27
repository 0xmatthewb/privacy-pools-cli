export const AGENT_ENV_VAR_NAMES = [
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "CODEX_SANDBOX",
  "CODEX_AGENT",
  "GEMINI_CLI",
  "OPENCODE",
  "AIDER_AGENT",
] as const;

const TRUEISH_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthyEnvValue(value: string | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  if (TRUEISH_VALUES.has(normalized)) {
    return true;
  }

  return normalized !== "0" && normalized !== "false" && normalized !== "off";
}

export function detectAgentEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return AGENT_ENV_VAR_NAMES.some((name) => isTruthyEnvValue(env[name]));
}
