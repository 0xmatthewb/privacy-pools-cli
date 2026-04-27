import { CLIError } from "../errors.js";

export type InputErrorCode =
  | "INPUT_ADDRESS_CHECKSUM_INVALID"
  | "INPUT_BAD_ADDRESS"
  | "INPUT_BELOW_MINIMUM_DEPOSIT"
  | "INPUT_FLAG_CONFLICT"
  | "INPUT_INVALID_AMOUNT"
  | "INPUT_INVALID_ASSET"
  | "INPUT_INVALID_VALUE"
  | "INPUT_MISSING_AMOUNT"
  | "INPUT_MISSING_ARGUMENT"
  | "INPUT_MISSING_ASSET"
  | "INPUT_MISSING_RECIPIENT"
  | "INPUT_MUTUALLY_EXCLUSIVE"
  | "INPUT_RECIPIENT_BURN_ADDRESS"
  | "INPUT_UNKNOWN_ASSET"
  | "INPUT_UNKNOWN_CHAIN"
  | "INPUT_UNKNOWN_COMMAND"
  | "INPUT_UNKNOWN_OPTION";

export type SetupErrorCode =
  | "SETUP_REQUIRED"
  | "SETUP_RECOVERY_PHRASE_MISSING";

export type RpcErrorCode =
  | "RPC_ERROR"
  | "RPC_NETWORK_ERROR"
  | "RPC_POOL_RESOLUTION_FAILED"
  | "RPC_RATE_LIMITED";

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
