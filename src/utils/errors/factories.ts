import { CLIError } from "../errors.js";
import type { RegisteredErrorCode } from "../error-code-registry.js";

export type InputErrorCode = Extract<RegisteredErrorCode, `INPUT_${string}`>;

export type SetupErrorCode = Extract<RegisteredErrorCode, `SETUP_${string}`>;

export type RpcErrorCode = Extract<RegisteredErrorCode, `RPC_${string}`>;

export type CatchAllInputError = "INPUT_ERROR";

export function inputError(
  code: InputErrorCode,
  message: string,
  hint: string,
): CLIError {
  return new CLIError(message, "INPUT", hint, code);
}

export function setupError(
  code: SetupErrorCode,
  message: string,
  hint: string,
): CLIError {
  return new CLIError(message, "SETUP", hint, code);
}

export function rpcError(
  code: RpcErrorCode,
  message: string,
  hint: string,
): CLIError {
  return new CLIError(message, "RPC", hint, code);
}
