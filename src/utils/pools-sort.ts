export const SUPPORTED_SORT_MODES = [
  "default",
  "asset-asc",
  "asset-desc",
  "tvl-desc",
  "tvl-asc",
  "deposits-desc",
  "deposits-asc",
  "chain-asset",
] as const;

export type PoolsSortMode = (typeof SUPPORTED_SORT_MODES)[number];
