import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { CLI_CWD } from "../helpers/cli.ts";
import { buildChildProcessEnv } from "../helpers/child-env.ts";
import { createTrackedTempDir } from "../helpers/temp.ts";

const python3Available =
  process.platform !== "win32" &&
  spawnSync("python3", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    env: buildChildProcessEnv(),
  }).status === 0;

const ptyTest = python3Available ? test : test.skip;

const BANNER_START_PATTERN = /^,---\./m;
const GOAL_SENTINEL = "[pp-init:goal]";
const LOAD_RECOVERY_SENTINEL = "[pp-init:load-recovery]";

const PYTHON_PTY_SCRIPT = `
import json
import fcntl
import os
import pty
import select
import signal
import struct
import termios
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

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

output = ""
selected_replace_path = False
sent_cancel = False
timed_out = False
deadline = time.time() + 25
status = None

def saw_sentinel(value, sentinel):
    index = 0
    for char in value:
        if char == sentinel[index]:
            index += 1
            if index == len(sentinel):
                return True
    return False

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
        done_pid, done_status = os.waitpid(pid, os.WNOHANG)
        if done_pid == pid:
            status = done_status
            break
        continue

    if not chunk:
        done_pid, done_status = os.waitpid(pid, os.WNOHANG)
        if done_pid == pid:
            status = done_status
            break
        continue

    text = chunk.decode(errors="replace")
    output += text

    if not selected_replace_path and saw_sentinel(output, "${GOAL_SENTINEL}"):
        os.write(fd, b"\\x1b[B\\r")
        selected_replace_path = True

    if selected_replace_path and not sent_cancel and saw_sentinel(output, "${LOAD_RECOVERY_SENTINEL}"):
        os.write(fd, b"\\x03")
        sent_cancel = True

if status is None:
    timed_out = True
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    _, status = os.waitpid(pid, 0)

print(json.dumps({
    "code": os.waitstatus_to_exitcode(status),
    "sentCancel": sent_cancel,
    "timedOut": timed_out,
    "output": output,
}))
`;

describe("interactive pty flows", () => {
  ptyTest("human init can open the load-account prompt and cancel cleanly through a real terminal prompt", () => {
    const home = createTrackedTempDir("pp-pty-home-");
    const result = spawnSync("python3", ["-c", PYTHON_PTY_SCRIPT], {
      cwd: CLI_CWD,
      encoding: "utf8",
      timeout: 45_000,
      env: buildChildProcessEnv({
        PRIVACY_POOLS_HOME: join(home, ".privacy-pools"),
        PRIVACY_POOLS_TEST_INIT_SENTINELS: "1",
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
      sentCancel: boolean;
      timedOut: boolean;
      output: string;
    };

    expect(payload.code).toBe(0);
    expect(payload.timedOut).toBe(false);
    expect(payload.sentCancel).toBe(true);
    expect(payload.output).toContain(GOAL_SENTINEL);
    expect(payload.output).toContain(LOAD_RECOVERY_SENTINEL);
    expect(payload.output).not.toMatch(BANNER_START_PATTERN);
  }, 45_000);
});
