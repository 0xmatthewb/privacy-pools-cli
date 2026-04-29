import { CLIError } from "../errors.js";
import type { RegisteredErrorCode } from "../error-code-registry.js";

export type InputErrorCode = Extract<RegisteredErrorCode, `INPUT_${string}`>;

export type SetupErrorCode = Extract<RegisteredErrorCode, `SETUP_${string}`>;

export type RpcErrorCode = Extract<RegisteredErrorCode, `RPC_${string}`>;

export type ProofErrorCode = Extract<RegisteredErrorCode, `PROOF_${string}`>;

export type ContractErrorCode = Extract<RegisteredErrorCode, `CONTRACT_${string}`>;

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

export function proofError(
  code: ProofErrorCode,
  message: string,
  hint: string,
): CLIError {
  return new CLIError(message, "PROOF", hint, code);
}

export function contractError(
  code: ContractErrorCode,
  message: string,
  hint: string,
): CLIError {
  return new CLIError(message, "CONTRACT", hint, code);
}
