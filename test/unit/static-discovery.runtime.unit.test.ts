import { afterEach, describe, expect, test } from "bun:test";
import {
  runStaticCompletionQuery,
  runStaticDiscoveryCommand,
  runStaticRootHelp,
} from "../../src/static-discovery.ts";
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
  test("renders capabilities in human mode", async () => {
    const { stdout, stderr } = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["capabilities"]);
      expect(handled).toBe(true);
    });

    expect(stdout).toBe("");
    expect(stderr).toContain("Privacy Pools CLI: Agent Capabilities");
    expect(stderr).toContain("Commands:");
    expect(stderr).toContain("Global Flags:");
    expect(stderr).toContain("Typical Agent Workflow:");
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

  test("renders aliased describe output with additional modes and supports JSON/quiet", async () => {
    const human = await captureAsyncOutput(async () => {
      const handled = await runStaticDiscoveryCommand(["describe", "ragequit"]);
      expect(handled).toBe(true);
    });
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("Command: ragequit");
    expect(human.stderr).toContain("Aliases:");
    expect(human.stderr).toContain("Additional modes:");

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

  test("rejects csv mode for static discovery commands", async () => {
    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(async () => {
      const handled = await runStaticDiscoveryCommand([
        "--format",
        "csv",
        "guide",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--format csv is not supported for 'guide'");
  });

  test("returns false for malformed static discovery invocations", async () => {
    const cases = [
      ["--help"],
      ["--version"],
      ["guide", "extra"],
      ["capabilities", "extra"],
      ["describe"],
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
      ["--format", "json", "completion", "--query", "--shell", "elvish", "--", "privacy-pools"],
      ["--format=json", "completion", "--query", "--shell", "elvish", "--", "privacy-pools"],
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

    const { stdout, stderr, exitCode } = await captureAsyncOutputAllowExit(async () => {
      const handled = await runStaticCompletionQuery([
        "--json",
        "--format",
        "csv",
        "completion",
        "--query",
        "bash",
        "--",
        "privacy-pools",
      ]);
      expect(handled).toBe(true);
    });

    expect(exitCode).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("--format csv is not supported for 'completion'");
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
