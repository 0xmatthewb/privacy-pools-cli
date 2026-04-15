export const FLOW_PRIVACY_DELAY_PROFILES = [
  "off",
  "balanced",
  "aggressive",
] as const;

export type FlowPrivacyDelayProfile =
  (typeof FLOW_PRIVACY_DELAY_PROFILES)[number];

export function flowPrivacyDelayRangeSeconds(
  profile: FlowPrivacyDelayProfile,
): [number, number] {
  switch (profile) {
    case "balanced":
      return [15 * 60, 90 * 60];
    case "aggressive":
      return [2 * 60 * 60, 12 * 60 * 60];
    case "off":
      return [0, 0];
  }
}

export function isFlowPrivacyDelayRandom(
  profile: FlowPrivacyDelayProfile,
): boolean {
  return profile !== "off";
}

function pluralize(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function formatApproxRemainingDuration(ms: number): string {
  if (ms <= 0) {
    return "ready now";
  }

  const totalMinutes = Math.ceil(ms / 60_000);
  if (totalMinutes < 60) {
    return `~${pluralize(totalMinutes, "minute")} remaining`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    if (remainingMinutes === 0) {
      return `~${pluralize(totalHours, "hour")} remaining`;
    }
    return `~${pluralize(totalHours, "hour")} ${pluralize(remainingMinutes, "minute")} remaining`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  if (remainingHours === 0) {
    return `~${pluralize(totalDays, "day")} remaining`;
  }
  return `~${pluralize(totalDays, "day")} ${pluralize(remainingHours, "hour")} remaining`;
}

export function describeFlowPrivacyDelayDeadline(
  deadlineIso: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!deadlineIso) {
    return null;
  }

  const deadlineMs = Date.parse(deadlineIso);
  if (!Number.isFinite(deadlineMs)) {
    return null;
  }

  const localTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(deadlineMs));

  return `${localTime} local time (${formatApproxRemainingDuration(deadlineMs - nowMs)})`;
}
