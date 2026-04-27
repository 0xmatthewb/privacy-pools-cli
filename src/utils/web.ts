import { spawn, type ChildProcess } from "node:child_process";
import { warn } from "./format.js";
import type { ResolvedGlobalMode } from "./mode.js";
import type { GlobalOptions } from "../types.js";

export interface BrowserLaunchCommand {
  command: string;
  args: string[];
}

interface BrowserLaunchParams {
  globalOpts?: GlobalOptions;
  mode: ResolvedGlobalMode;
  url?: string | null;
  label?: string;
  silent?: boolean;
  platform?: NodeJS.Platform;
  spawnImpl?: (
    command: string,
    args: readonly string[],
    options: {
      detached?: boolean;
      stdio?: "ignore";
      windowsHide?: boolean;
    },
  ) => Pick<ChildProcess, "on" | "unref">;
}

let webRequestedThisRun = false;
let browserLaunchAttemptedThisRun = false;

export function getBrowserLaunchCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): BrowserLaunchCommand {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  return { command: "xdg-open", args: [url] };
}

export function shouldLaunchBrowser(
  globalOpts: GlobalOptions | undefined,
  mode: ResolvedGlobalMode,
  url: string | null | undefined,
): url is string {
  return Boolean(globalOpts?.web) && !mode.isAgent && !mode.isJson && typeof url === "string" && url.length > 0;
}

export function maybeLaunchBrowser(params: BrowserLaunchParams): boolean {
  const {
    globalOpts,
    mode,
    url,
    label = "web link",
    silent = false,
    platform = process.platform,
    spawnImpl = spawn,
  } = params;
  if (globalOpts?.web && !mode.isAgent && !mode.isJson) {
    webRequestedThisRun = true;
  }
  if (!shouldLaunchBrowser(globalOpts, mode, url)) {
    return false;
  }
  browserLaunchAttemptedThisRun = true;

  const { command, args } = getBrowserLaunchCommand(url, platform);
  try {
    const child = spawnImpl(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (error) => {
      warn(
        `Unable to open ${label} automatically: ${error instanceof Error ? error.message : String(error)}`,
        silent,
      );
    });
    child.unref();
    return true;
  } catch (error) {
    warn(
      `Unable to open ${label} automatically: ${error instanceof Error ? error.message : String(error)}`,
      silent,
    );
    return false;
  }
}

export function consumeBrowserLaunchTracking(): {
  requested: boolean;
  attempted: boolean;
} {
  const state = {
    requested: webRequestedThisRun,
    attempted: browserLaunchAttemptedThisRun,
  };
  webRequestedThisRun = false;
  browserLaunchAttemptedThisRun = false;
  return state;
}
