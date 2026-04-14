import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { CLI_CWD, createSeededHome } from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";

const python3Available =
  process.platform !== "win32" &&
  spawnSync("python3", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    env: buildChildProcessEnv(),
  }).status === 0;

const ptyTest = python3Available ? test : test.skip;

const BANNER_SENTINEL =
  ",---. ,---. ,-.-.   .-.--.   ,--.-.   .-.   ,---.  .---.  .---. ,-.     .---.";

const PYTHON_PTY_SCRIPT = `
import json
import os
import pty
import select
import sys
import time

workdir = os.environ["PP_TEST_PTY_CWD"]
argv = json.loads(os.environ["PP_TEST_PTY_ARGV"])
env = dict(os.environ)
env.pop("PP_TEST_PTY_CWD", None)
env.pop("PP_TEST_PTY_ARGV", None)

pid, fd = pty.fork()
if pid == 0:
    os.chdir(workdir)
    os.execvpe(argv[0], argv, env)

output = ""
selected_replace_path = False
sent_decline = False
deadline = time.time() + 15
status = None

while time.time() < deadline:
    done_pid, done_status = os.waitpid(pid, os.WNOHANG)
    if done_pid == pid:
        status = done_status
        break

    readable, _, _ = select.select([fd], [], [], 0.1)
    if fd not in readable:
        continue

    try:
        chunk = os.read(fd, 4096)
    except OSError:
        break

    if not chunk:
        break

    text = chunk.decode(errors="replace")
    output += text

    if "What would you like to do?" in output and not selected_replace_path:
        os.write(fd, b"\\x1b[B\\n")
        selected_replace_path = True

    if "Replace the current local setup by loading this account?" in output and not sent_decline:
        os.write(fd, b"n\\n")
        sent_decline = True

if status is None:
    _, status = os.waitpid(pid, 0)

print(json.dumps({
    "code": os.waitstatus_to_exitcode(status),
    "sentDecline": sent_decline,
    "output": output,
}))
`;

describe("interactive pty flows", () => {
  ptyTest("human init can decline overwrite through a real terminal prompt", () => {
    const home = createSeededHome("sepolia");
    const result = spawnSync("python3", ["-c", PYTHON_PTY_SCRIPT], {
      cwd: CLI_CWD,
      encoding: "utf8",
      timeout: 30_000,
      env: buildChildProcessEnv({
        PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
        PP_TEST_PTY_CWD: CLI_CWD,
        PP_TEST_PTY_ARGV: JSON.stringify([
          process.platform === "win32" ? "node.exe" : "node",
          "--import",
          "tsx",
          "src/index.ts",
          "--no-banner",
          "init",
        ]),
      }),
    });

    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const payload = JSON.parse(result.stdout.trim()) as {
      code: number;
      sentDecline: boolean;
      output: string;
    };

    expect(payload.code).toBe(0);
    expect(payload.sentDecline).toBe(true);
    expect(payload.output).toContain("What would you like to do?");
    expect(payload.output).toContain("Replace the current local setup by loading this account?");
    expect(payload.output).toContain("Init cancelled.");
    expect(payload.output).not.toContain(BANNER_SENTINEL);
  });
});
