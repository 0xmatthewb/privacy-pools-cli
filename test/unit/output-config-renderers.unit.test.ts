import { afterEach, describe, expect, test } from "bun:test";
import {
  createOutputContext,
} from "../../src/output/common.ts";
import {
  renderConfigGet,
  renderConfigList,
  renderConfigPath,
  renderConfigProfileActive,
  renderConfigProfileCreate,
  renderConfigProfileList,
  renderConfigProfileUse,
  renderConfigSet,
} from "../../src/output/config.ts";
import {
  captureJsonOutput,
  captureOutput,
  expectSilentOutput,
  makeMode,
} from "../helpers/output.ts";

const originalStderrIsTTY = process.stderr.isTTY;

function context(overrides: Parameters<typeof makeMode>[0] = {}) {
  return createOutputContext(makeMode(overrides));
}

describe("config renderers", () => {
  afterEach(() => {
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: originalStderrIsTTY,
    });
  });

  test("renders human-readable config output", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });

    const list = captureOutput(() =>
      renderConfigList(context(), {
        defaultChain: "mainnet",
        recoveryPhraseSet: true,
        signerKeySet: false,
        rpcOverrides: { 1: "https://rpc.example.test" },
        configDir: "/tmp/privacy-pools",
      }),
    );
    expect(list.stdout).toBe("");
    expect(list.stderr).toContain("Configuration");
    expect(list.stderr).toContain("mainnet");
    expect(list.stderr).toContain("[set]");
    expect(list.stderr).toContain("[not set]");

    const get = captureOutput(() =>
      renderConfigGet(context(), {
        key: "signer-key",
        value: "0xsecret",
        sensitive: true,
        redacted: true,
      }),
    );
    expect(get.stdout).toBe("");
    expect(get.stderr).toContain("signer-key");
    expect(get.stderr).toContain("[set]");

    const set = captureOutput(() =>
      renderConfigSet(context(), {
        key: "default-chain",
        newValueSummary: "set to sepolia",
      }),
    );
    expect(set.stdout).toBe("");
    expect(set.stderr).toContain("Configuration updated");
    expect(set.stderr).toContain("set to sepolia");

    const path = captureOutput(() =>
      renderConfigPath(context(), "/tmp/privacy-pools"),
    );
    expect(path.stdout).toBe("/tmp/privacy-pools\n");
    expect(path.stderr).toContain("Config directory");

    const profiles = captureOutput(() =>
      renderConfigProfileList(context(), ["work"], "work"),
    );
    expect(profiles.stdout).toBe("");
    expect(profiles.stderr).toContain("Profiles");
    expect(profiles.stderr).toContain("default");
    expect(profiles.stderr).toContain("work");

    const created = captureOutput(() =>
      renderConfigProfileCreate(context(), "work", "/tmp/privacy-pools/profiles/work"),
    );
    expect(created.stderr).toContain("Profile");
    expect(created.stderr).toContain("Directory");

    const active = captureOutput(() =>
      renderConfigProfileActive(context(), "work", "/tmp/privacy-pools/profiles/work"),
    );
    expect(active.stderr).toContain("Active profile");
    expect(active.stderr).toContain("work");

    const used = captureOutput(() =>
      renderConfigProfileUse(context(), "work", "/tmp/privacy-pools/profiles/work"),
    );
    expect(used.stderr).toContain("Active profile set to work.");
    expect(used.stderr).toContain("/tmp/privacy-pools/profiles/work");
  });

  test("renders config payloads in json mode", () => {
    const list = captureJsonOutput(() =>
      renderConfigList(context({ isJson: true, format: "json" }), {
        defaultChain: "op-sepolia",
        recoveryPhraseSet: false,
        signerKeySet: true,
        rpcOverrides: {},
        configDir: "/tmp/privacy-pools",
      }),
    );
    expect(list.stderr).toBe("");
    expect(list.json.success).toBe(true);
    expect(list.json.defaultChain).toBe("op-sepolia");
    expect(list.json.nextActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "status", when: "after_config_list" }),
      ]),
    );

    const get = captureJsonOutput(() =>
      renderConfigGet(context({ isJson: true, format: "json" }), {
        key: "recovery-phrase",
        value: "secret phrase",
        sensitive: true,
        redacted: true,
      }),
    );
    expect(get.json.success).toBe(true);
    expect(get.json.key).toBe("recovery-phrase");
    expect(get.json.set).toBe(true);
    expect(get.json.redacted).toBe(true);
    expect(get.json.value).toBeUndefined();

    const set = captureJsonOutput(() =>
      renderConfigSet(context({ isJson: true, format: "json" }), {
        key: "rpc-override.sepolia",
        newValueSummary: "set to https://rpc.sepolia.example.test",
      }),
    );
    expect(set.json.success).toBe(true);
    expect(set.json.key).toBe("rpc-override.sepolia");
    expect(set.json.updated).toBe(true);

    const path = captureJsonOutput(() =>
      renderConfigPath(context({ isJson: true, format: "json" }), "/tmp/privacy-pools"),
    );
    expect(path.json.success).toBe(true);
    expect(path.json.configDir).toBe("/tmp/privacy-pools");

    const profiles = captureJsonOutput(() =>
      renderConfigProfileList(context({ isJson: true, format: "json" }), ["work"], "default"),
    );
    expect(profiles.json.success).toBe(true);
    expect(profiles.json.profiles).toEqual(["default", "work"]);
    expect(profiles.json.active).toBe("default");

    const created = captureJsonOutput(() =>
      renderConfigProfileCreate(context({ isJson: true, format: "json" }), "work", "/tmp/privacy-pools/profiles/work"),
    );
    expect(created.json.success).toBe(true);
    expect(created.json.profile).toBe("work");
    expect(created.json.created).toBe(true);

    const active = captureJsonOutput(() =>
      renderConfigProfileActive(context({ isJson: true, format: "json" }), "work", "/tmp/privacy-pools/profiles/work"),
    );
    expect(active.json.success).toBe(true);
    expect(active.json.profile).toBe("work");

    const used = captureJsonOutput(() =>
      renderConfigProfileUse(context({ isJson: true, format: "json" }), "work", "/tmp/privacy-pools/profiles/work"),
    );
    expect(used.json.success).toBe(true);
    expect(used.json.active).toBe(true);
  });

  test("stays silent in quiet mode", () => {
    expectSilentOutput(
      captureOutput(() =>
        renderConfigList(context({ isQuiet: true }), {
          defaultChain: null,
          recoveryPhraseSet: false,
          signerKeySet: false,
          rpcOverrides: {},
          configDir: "/tmp/privacy-pools",
        }),
      ),
    );

    expectSilentOutput(
      captureOutput(() =>
        renderConfigGet(context({ isQuiet: true }), {
          key: "default-chain",
          value: null,
          sensitive: false,
          redacted: false,
        }),
      ),
    );

    expectSilentOutput(
      captureOutput(() =>
        renderConfigSet(context({ isQuiet: true }), {
          key: "default-chain",
          newValueSummary: "set to mainnet",
        }),
      ),
    );

    expectSilentOutput(
      captureOutput(() =>
        renderConfigProfileList(context({ isQuiet: true }), ["work"], "default"),
      ),
    );

    expectSilentOutput(
      captureOutput(() =>
        renderConfigProfileCreate(context({ isQuiet: true }), "work", "/tmp/privacy-pools/profiles/work"),
      ),
    );

    expectSilentOutput(
      captureOutput(() =>
        renderConfigProfileActive(context({ isQuiet: true }), "work", "/tmp/privacy-pools/profiles/work"),
      ),
    );

    expectSilentOutput(
      captureOutput(() =>
        renderConfigProfileUse(context({ isQuiet: true }), "work", "/tmp/privacy-pools/profiles/work"),
      ),
    );
  });
});
