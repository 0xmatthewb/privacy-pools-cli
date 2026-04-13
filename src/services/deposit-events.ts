import { decodeEventLog, parseAbiItem } from "viem";
import type { Address, Hex } from "viem";

export const CANONICAL_DEPOSIT_EVENT_SIGNATURE =
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitmentHash)";
export const SDK_COMPAT_DEPOSIT_EVENT_SIGNATURE =
  "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _merkleRoot)";

export const CANONICAL_DEPOSIT_EVENT = parseAbiItem(
  CANONICAL_DEPOSIT_EVENT_SIGNATURE,
);

const SDK_COMPAT_DEPOSIT_EVENT = parseAbiItem(
  SDK_COMPAT_DEPOSIT_EVENT_SIGNATURE,
);

type DepositEventArgs = {
  _depositor?: string;
  _commitment?: bigint;
  _label?: bigint;
  _value?: bigint;
  _precommitmentHash?: bigint;
  _merkleRoot?: bigint;
};

export interface NormalizedDepositEvent {
  depositor: Address;
  commitment: bigint;
  label: bigint;
  value: bigint;
  precommitment: bigint;
}

interface DepositReceiptLog {
  data: Hex;
  topics: readonly Hex[];
}

export function normalizeDepositEventArgs(
  args: DepositEventArgs | undefined,
): NormalizedDepositEvent {
  const precommitment = args?._precommitmentHash ?? args?._merkleRoot;

  if (
    !args?._depositor ||
    args._commitment === undefined ||
    args._commitment === null ||
    args._label === undefined ||
    args._label === null ||
    precommitment === undefined ||
    precommitment === null
  ) {
    throw new Error("Malformed deposit log");
  }

  return {
    depositor: args._depositor.toLowerCase() as Address,
    commitment: args._commitment,
    label: args._label,
    value: args._value ?? 0n,
    precommitment,
  };
}

function tryDecodeDepositEventArgs(log: DepositReceiptLog): DepositEventArgs {
  for (const abiItem of [CANONICAL_DEPOSIT_EVENT, SDK_COMPAT_DEPOSIT_EVENT]) {
    try {
      const decoded = decodeEventLog({
        abi: [abiItem],
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      return decoded.args as DepositEventArgs;
    } catch {
      // Try the next compatible ABI variant.
    }
  }

  throw new Error("Malformed deposit log");
}

export function decodeDepositReceiptLog(
  log: DepositReceiptLog,
): NormalizedDepositEvent {
  return normalizeDepositEventArgs(tryDecodeDepositEventArgs(log));
}
