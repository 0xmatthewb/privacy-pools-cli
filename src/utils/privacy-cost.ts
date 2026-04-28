export function buildRagequitPrivacyCostManifest(data: {
  poolAccountId: string | null;
  amount: bigint | string;
  asset: string;
  chain: string;
  destinationAddress: string | null;
}): Record<string, unknown> {
  return {
    action: "ragequit",
    framing: "public_self_custody_recovery",
    poolAccountId: data.poolAccountId,
    amount: data.amount.toString(),
    asset: data.asset,
    chain: data.chain,
    destinationAddress: data.destinationAddress,
    privacyCost: "funds return publicly to the original depositing address",
    privacyPreserved: false,
    recommendation:
      "Prefer a relayed private withdrawal when the Pool Account is approved and above the relayer minimum.",
  };
}
