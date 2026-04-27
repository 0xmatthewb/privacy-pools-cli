let webRequestedThisRun = false;
let webOpenedThisRun = false;

export function markWebRequested(): void {
  webRequestedThisRun = true;
}

export function markWebOpened(): void {
  webRequestedThisRun = true;
  webOpenedThisRun = true;
}

export function peekWebOutputStatus(): {
  requested: boolean;
  opened: boolean;
} {
  return {
    requested: webRequestedThisRun,
    opened: webOpenedThisRun,
  };
}

export function resetWebOutputStatus(): void {
  webRequestedThisRun = false;
  webOpenedThisRun = false;
}
