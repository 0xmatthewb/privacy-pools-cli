#!/usr/bin/env python3

import json
import os
import pty
import selectors
import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("pty-proxy.py expects one JSON payload argument", file=sys.stderr)
        return 2

    payload = json.loads(sys.argv[1])
    command = payload["command"]
    args = payload.get("args", [])
    cwd = payload.get("cwd")

    master_fd, slave_fd = pty.openpty()
    proc = subprocess.Popen(
        [command, *args],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd=cwd,
        env=os.environ.copy(),
        close_fds=True,
    )
    os.close(slave_fd)

    selector = selectors.DefaultSelector()
    selector.register(master_fd, selectors.EVENT_READ, "pty")

    stdin_open = True
    stdin_fd = sys.stdin.fileno()
    try:
        selector.register(stdin_fd, selectors.EVENT_READ, "stdin")
    except OSError:
        stdin_open = False

    while True:
        for key, _ in selector.select(timeout=0.05):
            if key.data == "stdin":
                data = os.read(stdin_fd, 4096)
                if data:
                    os.write(master_fd, data)
                elif stdin_open:
                    stdin_open = False
                    selector.unregister(stdin_fd)
            else:
                try:
                    data = os.read(master_fd, 4096)
                except OSError:
                    data = b""
                if data:
                    os.write(sys.stdout.fileno(), data)
                    sys.stdout.flush()
                else:
                    selector.unregister(master_fd)
                    os.close(master_fd)
                    return proc.wait()

        if proc.poll() is not None:
            try:
                data = os.read(master_fd, 4096)
            except OSError:
                data = b""
            if data:
                os.write(sys.stdout.fileno(), data)
                sys.stdout.flush()
                continue

            selector.unregister(master_fd)
            os.close(master_fd)
            return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
