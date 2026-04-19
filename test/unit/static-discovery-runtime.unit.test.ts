import { afterEach, describe, expect, test } from "bun:test";
import {
  runStaticCompletionQuery,
  runStaticDiscoveryCommand,
  runStaticRootHelp,
  staticDiscoveryTestInternals,
} from "../../src/static-discovery.ts";
import { parseRootArgv } from "../../src/utils/root-argv.ts";
import {
  captureAsyncJsonOutput,
  captureAsyncJsonOutputAllowExit,
  captureAsyncOutput,
  captureAsyncOutputAllowExit,
} from "../helpers/output.ts";

const ORIGINAL_SHELL = process.env.SHELL;

afterEach(() => {
  if (ORIGINAL_SHELL === undefined) {
    delete process.env.SHELL;
  } else {
    process.env.SHELL = ORIGINAL_SHELL;
  }
});

describe("static discovery runtime", () => {
  test("static discovery parser helpers cover fallback json and invalid option branches", () => {
    expect(staticDiscoveryTestInternals.isKnownCompletionShell("bash")).toBe(
      true,
    );
    expect(
      staticDiscoveryTestInternals.isKnownCompletionShell("powershell"),
    ).toBe(true);
    expect(staticDiscoveryTestInternals.isKnownCompletionShell("elvish")).toBe(
      false,
    );
    expect(
      staticDiscoveryTestInternals.detectStaticCompletionShell("/bin/zsh"),
    ).toBe("zsh");
    expect(
      staticDiscoveryTestInternals.detectStaticCompletionShell(
        "/usr/local/bin/fish",
      ),
    ).toBe("fish");
    expect(
      staticDiscoveryTestInternals.detectStaticCompletionShell(
        "C:/Program Files/PowerShell/7/pwsh.exe",
      ),
    ).toBe("powershell");
    const originalShell = process.env.SHELL;
    delete process.env.SHELL;
    expect(staticDiscoveryTestInternals.detectStaticCompletionShell()).toBe(
      "bash",
    );
    expect(
      staticDiscoveryTestInternals.detectStaticCompletionShell("", "win32"),
    ).toBe("powershell");
    if (originalShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalShell;
    }

    expect(
      staticDiscoveryTestInternals.fallbackJsonModeFromArgv([
        "--output",
        "json",
      ]),
    ).toBe(true);
    expect(
      staticDiscoveryTestInternals.fallbackJsonModeFromArgv(["--output=json"]),
    ).toBe(true);
    expect(
      staticDiscoveryTestInternals.fallbackJsonModeFromArgv(["-qj"]),
    ).toBe(true);
    expect(
      staticDiscoveryTestInternals.fallbackJsonModeFromArgv(["--output", "csv"]),
    ).toBe(false);
    expect(
      staticDiscoveryTestInternals.fallbackJsonModeFromArgv([
        "--agent",
        "--output",
        "csv",
      ]),
    ).toBe(true);
    expect(
      staticDiscoveryTestInternals.fallbackJsonModeFromArgv(["--verbose"]),
    ).toBe(false);

    expect(
      staticDiscoveryTestInternals.parseLongOption("--bogus", undefined, {}),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseShortOption("-z", undefined, {}),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseShortFlagBundle("-qj", {}),
    ).toEqual({
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseShortFlagBundle("-cz", {}),
    ).toBeNull();
  });

  test("static discovery parser helpers cover remaining global option branches", () => {
    const longOpts: Record<string, string | boolean | undefined> = {};
    expect(
      staticDiscoveryTestInternals.parseLongOption("--agent", undefined, longOpts),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption("--quiet", undefined, longOpts),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption("--yes", undefined, longOpts),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--verbose",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--no-banner",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--no-color",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption("--help", undefined, longOpts),
    ).toEqual({
      consumedNext: false,
      helpLike: true,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--version",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: true,
    });
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--chain=mainnet",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(longOpts.chain).toBe("mainnet");
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--rpc-url=http://127.0.0.1:8545",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(longOpts.rpcUrl).toBe("http://127.0.0.1:8545");
    expect(
      staticDiscoveryTestInternals.parseLongOption(
        "--timeout=9",
        undefined,
        longOpts,
      ),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: false,
    });
    expect(longOpts.timeout).toBe("9");
    expect(
      staticDiscoveryTestInternals.parseLongOption("--chain", undefined, {}),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseLongOption("--rpc-url", undefined, {}),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseLongOption("--timeout", undefined, {}),
    ).toBeNull();

    const shortOpts: Record<string, string | boolean | undefined> = {};
    expect(
      staticDiscoveryTestInternals.parseShortOption("-c", "mainnet", shortOpts),
    ).toEqual({
      consumedNext: true,
      helpLike: false,
      versionLike: false,
    });
    expect(shortOpts.chain).toBe("mainnet");
    expect(
      staticDiscoveryTestInternals.parseShortOption(
        "-r",
        "http://127.0.0.1:8545",
        shortOpts,
      ),
    ).toEqual({
      consumedNext: true,
      helpLike: false,
      versionLike: false,
    });
    expect(shortOpts.rpcUrl).toBe("http://127.0.0.1:8545");
    expect(
      staticDiscoveryTestInternals.parseShortOption("-h", undefined, shortOpts),
    ).toEqual({
      consumedNext: false,
      helpLike: true,
      versionLike: false,
    });
    expect(
      staticDiscoveryTestInternals.parseShortOption("-V", undefined, shortOpts),
    ).toEqual({
      consumedNext: false,
      helpLike: false,
      versionLike: true,
    });
    expect(
      staticDiscoveryTestInternals.parseShortOption("-c", undefined, {}),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseShortOption("-r", undefined, {}),
    ).toBeNull();
  });

  test("static discovery parsers reject malformed static and completion argv shapes", () => {
    expect(staticDiscoveryTestInternals.parseStaticCommand(["--", "guide"])).toBe(
      null,
    );
    expect(staticDiscoveryTestInternals.parseStaticCommand(["guide", "extra"])).toBe(
      null,
    );
    expect(staticDiscoveryTestInternals.parseStaticCommand(["describe"])).toEqual({
      command: "describe",
      commandTokens: [],
      globalOpts: {
        json: undefined,
        agent: undefined,
        quiet: undefined,
        format: undefined,
      },
    });
    expect(staticDiscoveryTestInternals.parseStaticCommand(["help", "guide"])).toBe(
      null,
    );
    expect(
      staticDiscoveryTestInternals.parseStaticCommandFromRootArgv(
        parseRootArgv(["help", "guide"]),
      ),
    ).toBeNull();

    expect(
      staticDiscoveryTestInternals.parseCompletionQuery(["completion"]),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseCompletionQuery([
        "completion",
        "--query",
        "--shell",
        "bash",
        "fish",
        "--",
        "privacy-pools",
      ]),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseCompletionQuery([
        "completion",
        "--query",
        "bash",
        "extra",
        "--",
        "privacy-pools",
      ]),
    ).toBeNull();
    expect(
      staticDiscoveryTestInternals.parseCompletionQuery([
        "prelude",
        "completion",
        "--query",
        "--",
        "privacy-pools",
      ]),
    ).toBeNull();
  });

  test("renders capabilities in human mode", async () => {
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["capabilities"]);
      expect(handled).toBe(true);
    });

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools CLI: Agent Capabilities");
    expect(stderr).toContain("Commands:");
    expect(stderr).toContain("Global flags:");
    expect(stderr).toContain("Typical agent workflow:");
  });

  test("can reuse parsed root argv for static discovery commands", async () => {
    const parsed = parseRootArgv(["--json", "describe", "withdraw", "quote"]);
    expect(
      staticDiscoveryTestInternals.staticGlobalOptsFromParsedRootArgv(parsed),
    ).toEqual({
      json: true,
      agent: undefined,
      quiet: undefined,
      format: undefined,
    });
    expect(
      staticDiscoveryTestInternals.parseStaticCommandFromRootArgv(parsed),
    ).toEqual({
      command: "describe",
      commandTokens: ["withdraw", "quote"],
      globalOpts: {
        json: true,
        agent: undefined,
        quiet: undefined,
        format: undefined,
      },
    });

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand(
        ["--json", "describe", "withdraw", "quote"],
        parsed,
      ),
    );
    expect(json.success).toBe(true);
    expect(json.command).toBe("withdraw quote");
    expect(stderr).toBe("");
  });

  test("renders capabilities in agent mode", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand(["capabilities", "--agent"]),
    );

    expect(json.success).toBe(true);
    expect(json.commands.some((entry: { name: string }) => entry.name === "flow")).toBe(true);
    expect(stderr).toBe("");
  });

  test("renders the guide in human mode", async () => {
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["guide"]);
      expect(handled).toBe(true);
    });

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools: Quick Guide");
    expect(stderr).toContain("migrate status");
  });

  test("renders the guide in JSON mode and stays quiet when requested", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand(["--json", "guide"]),
    );
    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Privacy Pools: Quick Guide");
    expect(stderr).toBe("");

    const quietOutput = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["--quiet", "guide"]);
      expect(handled).toBe(true);
    });
    expect(quietOutput.stdout).toBe("");
    expect(quietOutput.stderr).toBe("");
  });

  test("renders describe output in human mode", async () => {
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["describe", "withdraw", "quote"]);
      expect(handled).toBe(true);
    });

    expect(stdout).toBe("");
    expect(stderr).toContain("Command: withdraw quote");
    expect(stderr).toContain("JSON fields:");
  });

  test("static describe resolves envelope schema paths in both JSON and human modes", async () => {
    const human = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand([
        "describe",
        "envelope.shared.nextAction",
      ]);
      expect(handled).toBe(true);
    });
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("Schema: envelope.shared.nextAction");
    expect(human.stderr).toContain("cliCommand");

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand([
        "--json",
        "describe",
        "envelope.shared.nextAction",
      ]),
    );
    expect(json.success).toBe(true);
    expect(json.path).toBe("envelope.shared.nextAction");
    expect(json.schema.cliCommand).toContain("omitted when runnable = false");
    expect(stderr).toBe("");
  });

  test("static describe resolves bare nextActions to the envelope alias", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand([
        "--json",
        "describe",
        "nextActions",
      ]),
    );

    expect(json.success).toBe(true);
    expect(json.path).toBe("envelope.nextActions");
    expect(json.schema.cliCommand).toContain("omitted when runnable = false");
    expect(stderr).toBe("");
  });

  test("renders aliased describe output with modes and supports JSON/quiet", async () => {
    const human = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["describe", "ragequit"]);
      expect(handled).toBe(true);
    });
    expect(human.stdout).toContain("Privacy Pools: ragequit");
    expect(human.stdout).toContain("Ragequit / Public Recovery");
    expect(human.stdout).toContain("privacy-pools ragequit ETH --pool-account PA-1");
    expect(human.stderr).toBe("");

    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand(["--json", "describe", "withdraw"]),
    );
    expect(json.success).toBe(true);
    expect(json.command).toBe("withdraw");
    expect(stderr).toBe("");

    const quiet = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["--quiet", "describe", "withdraw"]);
      expect(handled).toBe(true);
    });
    expect(quiet.stdout).toBe("");
    expect(quiet.stderr).toBe("");
  });

  test("returns structured errors for invalid describe paths", async () => {
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(async () => {
      const handled = await runStaticDiscoveryCommand([
        "--json",
        "describe",
        "not-a-command",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message).toContain("Unknown command path");
    expect(stderr).toBe("");
  });

  test("returns a describe index for describe without a command path", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(
      async () => {
        const handled = await runStaticDiscoveryCommand([
          "--json",
          "describe",
        ]);
        expect(handled).toBe(true);
      },
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("describe-index");
    expect(json.commands).toEqual(expect.any(Array));
    expect(
      json.commands.some((entry: { command: string }) => entry.command === "status"),
    ).toBe(true);
    expect(stderr).toBe("");
  });

  test("rejects csv mode for static discovery commands", async () => {
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(async () => {
      const handled = await runStaticDiscoveryCommand([
        "--output",
        "csv",
        "guide",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--output csv is not supported for 'guide'");
  });

  test("machine flags keep static discovery structured even when csv is also requested", async () => {
    const guide = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand(["--agent", "--output", "csv", "guide"]),
    );
    expect(guide.json.success).toBe(true);
    expect(guide.json.mode).toBe("help");
    expect(guide.stderr).toBe("");

    const capabilities = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand([
        "--json",
        "--output",
        "csv",
        "capabilities",
      ]),
    );
    expect(capabilities.json.success).toBe(true);
    expect(Array.isArray(capabilities.json.commands)).toBe(true);
    expect(capabilities.stderr).toBe("");
  });

  test("invalid output formats fail cleanly for static discovery and completion", async () => {
    const discovery = await captureAsyncJsonOutputAllowExit(() =>
      runStaticDiscoveryCommand(["--json", "--output", "toml", "guide"]),
    );
    expect(discovery.exitCode).toBe(2);
    expect(discovery.stderr).toBe("");
    expect(discovery.json.success).toBe(false);
    expect(discovery.json.errorCode).toBe("INPUT_ERROR");
    expect(discovery.json.errorMessage).toContain("argument 'toml' is invalid");

    const completion = await captureAsyncJsonOutputAllowExit(() =>
      runStaticCompletionQuery([
        "--json",
        "--output",
        "toml",
        "completion",
        "--query",
        "--shell",
        "bash",
        "--",
        "privacy-pools",
      ]),
    );
    expect(completion.exitCode).toBe(2);
    expect(completion.stderr).toBe("");
    expect(completion.json.success).toBe(false);
    expect(completion.json.errorCode).toBe("INPUT_ERROR");
    expect(completion.json.errorMessage).toContain("argument 'toml' is invalid");
  });

  test("returns false for malformed static discovery invocations", async () => {
    const cases = [
      ["--help"],
      ["--version"],
      ["guide", "extra"],
      ["capabilities", "extra"],
      ["--chain"],
      ["-c"],
      ["-ch", "guide"],
      ["--unknown", "guide"],
      ["-z", "guide"],
    ];

    for (const argv of cases) {
      const { stdout, stderr } = await captureAsyncOutput(async () => {
        const handled = await runStaticDiscoveryCommand(argv);
        expect(handled).toBe(false);
      });
      expect(stdout).toBe("");
      expect(stderr).toBe("");
    }
  });

  test("returns false for non-static commands", async () => {
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["status"]);
      expect(handled).toBe(false);
    });

    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });

  test("accepts long and short global flags when parsing static commands", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand([
        "-j",
        "--chain=mainnet",
        "--rpc-url=http://127.0.0.1:8545",
        "--timeout=9",
        "capabilities",
      ]),
    );

    expect(json.success).toBe(true);
    expect(json.commands.some((entry: { name: string }) => entry.name === "migrate")).toBe(true);
    expect(stderr).toBe("");
  });

  test("accepts split-value and quiet boolean root flags for static discovery commands", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand([
        "--json",
        "--yes",
        "--verbose",
        "--no-banner",
        "--no-color",
        "--chain",
        "mainnet",
        "--rpc-url",
        "http://127.0.0.1:8545",
        "--timeout",
        "9",
        "capabilities",
      ]),
    );

    expect(json.success).toBe(true);
    expect(json.commands.some((entry: { name: string }) => entry.name === "capabilities")).toBe(
      true,
    );
    expect(stderr).toBe("");
  });

  test("accepts exact short flags and rejects short help/version probes as non-static discovery", async () => {
    const jsonResult = await captureAsyncJsonOutput(() =>
      runStaticDiscoveryCommand(["-j", "-v", "-y", "capabilities"]),
    );
    expect(jsonResult.json.success).toBe(true);
    expect(jsonResult.stderr).toBe("");

    for (const argv of [["-h"], ["-V"]] as const) {
      const { stdout, stderr } = await captureAsyncOutput(async () => {
        const handled = await runStaticDiscoveryCommand([...argv]);
        expect(handled).toBe(false);
      });
      expect(stdout).toBe("");
      expect(stderr).toBe("");
    }
  });

  test("returns completion candidates in JSON mode", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "privacy-pools",
        "flo",
      ]),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("completion-query");
    expect(json.candidates).toContain("flow");
    expect(stderr).toBe("");
  });

  test("infers completion shells from the environment and accepts positional shell args", async () => {
    process.env.SHELL = "/bin/zsh";
    let zshJson = await captureAsyncJsonOutput(() =>
      runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--",
        "privacy-pools",
        "flo",
      ]),
    );
    expect(zshJson.json.success).toBe(true);
    expect(zshJson.json.shell).toBe("zsh");

    process.env.SHELL = "/usr/local/bin/fish";
    const fishJson = await captureAsyncJsonOutput(() =>
      runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--",
        "privacy-pools",
        "flo",
      ]),
    );
    expect(fishJson.json.success).toBe(true);
    expect(fishJson.json.shell).toBe("fish");

    delete process.env.SHELL;
    const bashJson = await captureAsyncJsonOutput(() =>
      runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--",
        "privacy-pools",
        "flo",
      ]),
    );
    expect(bashJson.json.success).toBe(true);
    expect(bashJson.json.shell).toBe("bash");

    const positionalShell = await captureAsyncOutput(async () => {
      const handled = await runStaticCompletionQuery([
        "completion",
        "--query",
        "bash",
        "--",
        "privacy-pools",
        "flo",
      ]);
      expect(handled).toBe(true);
    });
    expect(positionalShell.stdout.trim().split("\n")).toContain("flow");
    expect(positionalShell.stderr).toBe("");
  });

  test("accepts completion shell and cword inline values and short global flags", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticCompletionQuery([
        "-j",
        "-c",
        "mainnet",
        "-r",
        "http://127.0.0.1:8545",
        "completion",
        "--query",
        "--shell=bash",
        "--cword=1",
        "--",
        "privacy-pools",
        "flo",
      ]),
    );

    expect(json.success).toBe(true);
    expect(json.shell).toBe("bash");
    expect(json.cword).toBe(1);
    expect(json.candidates).toContain("flow");
    expect(stderr).toBe("");
  });

  test("renders human completion candidates", async () => {
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticCompletionQuery([
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "privacy-pools",
        "flo",
      ]);
      expect(handled).toBe(true);
    });

    expect(stdout.trim().split("\n")).toContain("flow");
    expect(stderr).toBe("");
  });

  test("reports invalid completion shell requests in JSON mode", async () => {
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(async () => {
      const handled = await runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--shell",
        "elvish",
        "--",
        "privacy-pools",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message).toContain("Unsupported shell");
    expect(stderr).toBe("");
  });

  test("preserves JSON fallback for invalid completion parse inputs across machine flags", async () => {
    const cases = [
      ["-j", "completion", "--query", "--shell", "elvish", "--", "privacy-pools"],
      ["-qj", "completion", "--query", "--shell", "elvish", "--", "privacy-pools"],
      ["--agent", "completion", "--query", "--shell", "elvish", "--", "privacy-pools"],
      ["--output", "json", "completion", "--query", "--shell", "elvish", "--", "privacy-pools"],
      ["--output=json", "completion", "--query", "--shell", "elvish", "--", "privacy-pools"],
    ];

    for (const argv of cases) {
      const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(async () => {
        const handled = await runStaticCompletionQuery(argv);
        expect(handled).toBe(true);
      });

      expect(exitCode).toBe(2);
      expect(json.success).toBe(false);
      expect(json.errorCode).toBe("INPUT_ERROR");
      expect(json.error.message).toContain("Unsupported shell");
      expect(stderr).toBe("");
    }
  });

  test("falls back to human error rendering when short bundles do not request JSON", async () => {
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(async () => {
      const handled = await runStaticCompletionQuery([
        "-qy",
        "completion",
        "--query",
        "--shell",
        "elvish",
        "--",
        "privacy-pools",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("Unsupported shell 'elvish'");
  });

  test("reports invalid completion cword values in JSON mode", async () => {
    const { json, stderr, exitCode } = await captureAsyncJsonOutputAllowExit(async () => {
      const handled = await runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "-1",
        "--",
        "privacy-pools",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe("INPUT_ERROR");
    expect(json.error.message).toContain("Invalid --cword value");
    expect(stderr).toBe("");
  });

  test("returns false for malformed completion invocations and reports csv errors in machine mode", async () => {
    const falseCases = [
      ["--help", "completion", "--query", "--", "privacy-pools"],
      ["prelude", "completion", "--query", "--", "privacy-pools"],
      ["completion", "--query", "--shell"],
      ["completion", "--query", "--cword"],
      ["completion", "--query", "--shell", "bash", "fish", "--", "privacy-pools"],
      ["completion", "--query", "--shell", "bash", "fish", "extra", "--", "privacy-pools"],
      ["completion", "--query", "--bogus", "--", "privacy-pools"],
    ];

    for (const argv of falseCases) {
      const { stdout, stderr } = await captureAsyncOutput(async () => {
        const handled = await runStaticCompletionQuery(argv);
        expect(handled).toBe(false);
      });
      expect(stdout).toBe("");
      expect(stderr).toBe("");
    }

    const { json, stderr } = await captureAsyncJsonOutput(async () => {
      const handled = await runStaticCompletionQuery([
        "--json",
        "--output",
        "csv",
        "completion",
        "--query",
        "bash",
        "--",
        "privacy-pools",
      ]);
      expect(handled).toBe(true);
    });

    expect(json.success).toBe(true);
    expect(Array.isArray(json.candidates)).toBe(true);
    expect(stderr).toBe("");
  });

  test("rejects csv mode for completion queries in human mode", async () => {
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(
      async () => {
        const handled = await runStaticCompletionQuery([
          "--output",
          "csv",
          "completion",
          "--query",
          "--shell",
          "bash",
          "--",
          "privacy-pools",
          "flo",
        ]);
        expect(handled).toBe(true);
      },
    );

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--output csv is not supported for 'completion'");
  });

  test("rejects conflicting completion shell declarations and keeps empty human completions silent", async () => {
    const mismatch = await captureAsyncOutputAllowExit(async () => {
      const handled = await runStaticCompletionQuery([
        "--json",
        "completion",
        "--query",
        "--shell",
        "bash",
        "zsh",
        "--",
        "privacy-pools",
      ]);
      expect(handled).toBe(false);
    });
    expect(mismatch.exitCode).toBe(0);
    expect(mismatch.stdout).toBe("");
    expect(mismatch.stderr).toBe("");

    const noCandidates = await captureAsyncOutput(async () => {
      const handled = await runStaticCompletionQuery([
        "completion",
        "--query",
        "--shell",
        "bash",
        "--cword",
        "1",
        "--",
        "privacy-pools",
        "zzzz",
      ]);
      expect(handled).toBe(true);
    });
    expect(noCandidates.stdout).toBe("");
    expect(noCandidates.stderr).toBe("");
  });

  test("renders styled human root help", async () => {
    const { stdout, stderr } = await captureAsyncOutput(() =>
      runStaticRootHelp(false),
    );

    expect(stdout).toContain("Usage: privacy-pools");
    expect(stdout).toContain("Get started:");
    expect(stderr).toBe("");
  });

  test("renders machine root help", async () => {
    const { json, stderr } = await captureAsyncJsonOutput(() =>
      runStaticRootHelp(true),
    );

    expect(json.success).toBe(true);
    expect(json.mode).toBe("help");
    expect(json.help).toContain("Usage: privacy-pools");
    expect(stderr).toBe("");
  });
});
