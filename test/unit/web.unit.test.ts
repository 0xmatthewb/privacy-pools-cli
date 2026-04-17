import { describe, expect, mock, test } from "bun:test";
import { makeMode } from "../helpers/output.ts";
import {
  getBrowserLaunchCommand,
  maybeLaunchBrowser,
  shouldLaunchBrowser,
} from "../../src/utils/web.ts";

describe("web launcher helpers", () => {
  test("selects the correct browser command per platform", () => {
    expect(getBrowserLaunchCommand("https://example.com", "darwin")).toEqual({
      command: "open",
      args: ["https://example.com"],
    });
    expect(getBrowserLaunchCommand("https://example.com", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "https://example.com"],
    });
    expect(getBrowserLaunchCommand("https://example.com", "linux")).toEqual({
      command: "xdg-open",
      args: ["https://example.com"],
    });
  });

  test("opens only when --web is enabled in human mode", () => {
    const onMock = mock(() => undefined);
    const unrefMock = mock(() => undefined);
    const spawnImpl = mock(() => ({
      on: onMock,
      unref: unrefMock,
    }));

    const opened = maybeLaunchBrowser({
      globalOpts: { web: true },
      mode: makeMode(),
      url: "https://example.com",
      platform: "linux",
      spawnImpl,
    });

    expect(opened).toBe(true);
    expect(spawnImpl).toHaveBeenCalledWith("xdg-open", ["https://example.com"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    expect(onMock).toHaveBeenCalledWith("error", expect.any(Function));
    expect(unrefMock).toHaveBeenCalledTimes(1);
  });

  test("skips machine-readable modes even when --web is present", () => {
    const spawnImpl = mock(() => ({
      on: mock(() => undefined),
      unref: mock(() => undefined),
    }));

    expect(shouldLaunchBrowser({ web: true }, makeMode({ isJson: true }), "https://example.com")).toBe(false);
    expect(
      maybeLaunchBrowser({
        globalOpts: { web: true },
        mode: makeMode({ isJson: true }),
        url: "https://example.com",
        spawnImpl,
      }),
    ).toBe(false);
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});
