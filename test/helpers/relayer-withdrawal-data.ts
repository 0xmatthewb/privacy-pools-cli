import { encodeAbiParameters, type Address, type Hex } from "viem";

export function encodeRelayerWithdrawalData(params: {
  recipient: Address;
  feeRecipient: Address;
  relayFeeBPS: bigint;
}): Hex {
  return encodeAbiParameters(
    [
      { name: "recipient", type: "address" },
      { name: "feeRecipient", type: "address" },
      { name: "relayFeeBPS", type: "uint256" },
    ],
    [params.recipient, params.feeRecipient, params.relayFeeBPS],
  );
}
