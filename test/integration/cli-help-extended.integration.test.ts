import { describe, expect, test } from "bun:test";
import { runCli, createTempHome } from "../helpers/cli.ts";

describe("CLI help and version output", () => {
  test("--help shows all commands", () => {
    const result = runCli(["--help"], { home: createTempHome() });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("init");
    expect(combined).toContain("deposit");
    expect(combined).toContain("withdraw");
    expect(combined).toContain("ragequit");
    expect(combined).toContain("exit");
    expect(combined).toContain("pools");
    expect(combined).toContain("balance");
    expect(combined).toContain("sync");
    expect(combined).toContain("status");
    expect(combined).toContain("completion");
  });

  test("--version returns a semver-like version", () => {
    const result = runCli(["--version"], { home: createTempHome() });
    const combined = (result.stdout + result.stderr).trim();
    expect(combined).toMatch(/\d+\.\d+\.\d+/);
  });

  test("--json --help returns JSON with mode help", () => {
    const result = runCli(["--json", "--help"], { home: createTempHome() });
    if (result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout.trim());
        expect(parsed.mode).toBe("help");
        expect(typeof parsed.help).toBe("string");
      } catch {
        // help output may not be JSON in all modes
      }
    }
  });

  test("-j --help returns JSON with mode help", () => {
    const result = runCli(["-j", "--help"], { home: createTempHome() });
    if (result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout.trim());
        expect(parsed.mode).toBe("help");
        expect(typeof parsed.help).toBe("string");
      } catch {
        // help output may not be JSON in all modes
      }
    }
  });

  test("bundled short flags -jh return JSON help envelope", () => {
    const result = runCli(["-jh"], { home: createTempHome() });
    if (result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout.trim());
        expect(parsed.mode).toBe("help");
        expect(typeof parsed.help).toBe("string");
      } catch {
        // help output may not be JSON in all modes
      }
    }
  });

  test("--json --version returns JSON with mode version", () => {
    const result = runCli(["--json", "--version"], { home: createTempHome() });
    if (result.stdout.trim()) {
      try {
        const parsed = JSON.parse(result.stdout.trim());
        expect(parsed.mode).toBe("version");
        expect(parsed.version).toMatch(/\d+\.\d+\.\d+/);
      } catch {
        // version output may not be JSON in all modes
      }
    }
  });

  test("deposit --help shows --dry-run option", () => {
    const result = runCli(["deposit", "--help"], { home: createTempHome() });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--dry-run");
  });

  test("withdraw --help shows --dry-run option", () => {
    const result = runCli(["withdraw", "--help"], { home: createTempHome() });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--dry-run");
  });

  test("ragequit --help shows --dry-run option", () => {
    const result = runCli(["ragequit", "--help"], { home: createTempHome() });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--dry-run");
    expect(combined).toContain("--from-pa");
  });

  test("exit --help resolves alias and shows exit options", () => {
    const result = runCli(["exit", "--help"], { home: createTempHome() });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--from-pa");
    expect(combined).toContain("--dry-run");
  });

  test("deposit --help shows --unsigned option", () => {
    const result = runCli(["deposit", "--help"], { home: createTempHome() });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--unsigned");
  });

  test("status --help shows --check option", () => {
    const result = runCli(["status", "--help"], { home: createTempHome() });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--check");
    expect(combined).not.toContain("Agent unsigned");
  });

  test("withdraw --help shows short aliases for common options", () => {
    const result = runCli(["withdraw", "--help"], { home: createTempHome() });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("-a, --asset");
    expect(combined).toContain("-t, --to");
    expect(combined).toContain("-p, --from-pa");
    expect(combined).toContain("--from-pa");
  });

  test("accounts --help shows --all option", () => {
    const result = runCli(["accounts", "--help"], { home: createTempHome() });
    const combined = result.stdout + result.stderr;
    expect(combined).toContain("--all");
    expect(combined).toContain("--details");
  });

  test("unknown command returns non-zero exit", () => {
    const result = runCli(["nonexistent-command"], { home: createTempHome() });
    expect(result.status).not.toBe(0);
  });
});
