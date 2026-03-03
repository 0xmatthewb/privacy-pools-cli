# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in this CLI, please report it
responsibly:

- **Email**: security@0xbow.io
- **Subject**: `[privacy-pools-cli] <brief description>`

Please include:

1. Steps to reproduce
2. Expected vs actual behavior
3. Impact assessment (what an attacker could achieve)
4. Your suggested fix, if any

We aim to acknowledge reports within 48 hours and provide a fix or
mitigation within 7 days for critical issues. Please do not open a public
issue for security vulnerabilities.

## Threat Model

The CLI protects three categories of assets:

| Asset | Threats | Mitigations |
|---|---|---|
| **Secrets** (mnemonic, signer key) | Disk theft, process snooping, env injection | File permissions, CWD-safe dotenv, env-var precedence |
| **State integrity** (account DB, config) | Corruption from crashes, concurrent access | Atomic writes, advisory process locks |
| **Transaction safety** | Interrupted confirmations, insufficient funds, malicious relayer/RPC | Critical sections, preflight balance checks, signal deferral |

## Security Mechanisms

### File Permissions

Sensitive files are created with strict POSIX permissions:

- **Config directory** (`~/.privacy-pools/`): mode `0o700` (owner only)
- **Secret files** (`.mnemonic`, `.signer`): mode `0o600` (owner read/write)
- Permissions are enforced via `chmodSync` with best-effort fallback for
  filesystems that do not support POSIX modes (e.g. FAT32, some Windows mounts).

### Atomic Writes

All config and account state files use a write-then-rename pattern:

1. Write to a `.tmp` sibling file
2. `renameSync()` to the final path (atomic on POSIX)

This prevents corruption if the process is killed or the system crashes
mid-write.

### Process Locks

An advisory PID-based lock file (`~/.privacy-pools/.lock`) prevents
concurrent CLI instances from corrupting shared state:

- Created atomically with `O_EXCL` (no TOCTOU race)
- Contains the owning PID; stale locks are auto-cleaned when the PID no
  longer exists
- Released on normal exit and on `SIGINT`/`SIGTERM`

### Critical Sections

Transaction commands (deposit, withdraw, exit/ragequit) guard the window
between on-chain confirmation and local state persistence:

- `SIGINT` and `SIGTERM` are deferred while a critical section is active
- Supports nested guards via a depth counter
- Pending signals are re-emitted once the critical section completes

This ensures that a Ctrl-C during confirmation does not leave local state
out of sync with on-chain reality.

### CWD-Safe Dotenv

The CLI loads `.env` exclusively from `~/.privacy-pools/.env`, **not**
from the current working directory. This prevents a malicious `.env` in a
cloned repository from silently redirecting RPC, ASP, or relayer endpoints
or swapping the signer key.

### Preflight Checks

Before submitting any transaction, the CLI runs preflight gates:

- Native balance check (with a 20% gas buffer)
- ERC-20 balance check (for token deposits)
- Lightweight gas-availability gate

These fail fast before expensive proof generation or on-chain submission.

## Known Limitations

- **Node.js memory**: Proof generation can consume significant memory.
  On constrained environments, the process may be OOM-killed.
- **Advisory locks**: The PID-based lock is advisory only. A process that
  ignores the lock or operates on the config directory directly can still
  cause state corruption.
- **File permissions on Windows**: `chmod` calls are best-effort on
  Windows. Secrets are still written to the user's home directory, which
  is typically ACL-protected, but the CLI cannot enforce POSIX-style
  owner-only permissions on all platforms.
- **Network trust**: The CLI trusts the configured RPC, ASP, and relayer
  endpoints. Ensure these are pointed at trusted infrastructure. Use
  `privacy-pools status` to verify connectivity.
