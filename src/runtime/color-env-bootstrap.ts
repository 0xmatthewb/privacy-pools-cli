const COLOR_ENV_CONFLICT_FLAG = "PRIVACY_POOLS_COLOR_ENV_CONFLICT";

if (process.env.NO_COLOR && process.env.FORCE_COLOR) {
  process.env[COLOR_ENV_CONFLICT_FLAG] = "1";
  delete process.env.FORCE_COLOR;
}

export { COLOR_ENV_CONFLICT_FLAG };
