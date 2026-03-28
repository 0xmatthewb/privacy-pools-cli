export const FLOW_PRIVACY_DELAY_PROFILES = [
  "off",
  "balanced",
  "aggressive",
] as const;

export type FlowPrivacyDelayProfile =
  (typeof FLOW_PRIVACY_DELAY_PROFILES)[number];
