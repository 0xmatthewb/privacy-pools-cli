# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in this CLI, report it privately:

- **Email**: security@0xbow.io
- **Subject**: `[privacy-pools-cli] <brief description>`

Please include:

1. Reproduction steps
2. Expected vs actual behavior
3. Impact assessment
4. Suggested remediation (if available)

Please do **not** open a public issue for unpatched vulnerabilities.

## Security Scope

This CLI protects three primary asset classes:

| Asset | Threats | Primary controls |
| --- | --- | --- |
| **Secrets** (mnemonic, signer key) | Key exfiltration, malicious local `.env`, accidental logging | Home-scoped dotenv, strict file modes (best effort), non-interactive machine mode, signer-optional unsigned flows |
| **Local state integrity** (config + account DB) | Crash/power loss corruption, concurrent writes | Atomic write-then-rename persistence, advisory process lock, critical sections |
| **Transaction integrity** | Stale roots, quote expiry/drift, receipt ambiguity, endpoint failures | Root parity checks, quote lifecycle checks, receipt status checks, fail-closed machine sync |

## Security Controls

### 1. Secret Handling

- The CLI reads `.env` from `~/.privacy-pools/.env` (or configured home), **not** from the current working directory.
- Signer key precedence is environment variable first (`PRIVACY_POOLS_PRIVATE_KEY`), then on-disk `.signer`.
- Unsigned and dry-run transaction flows avoid loading signer keys unless required by the mode.

### 2. File Permissions and Atomic Persistence

- Config and accounts directories are created with mode `0700` (best effort on non-POSIX filesystems).
- Secret/state files are written with mode `0600` (best effort on non-POSIX filesystems).
- Config/account writes use a temp-file + atomic rename pattern to avoid partial-write corruption.

### 3. Process Locking and Critical Sections

- An advisory PID lock (`~/.privacy-pools/.lock`) prevents concurrent state mutation.
- Stale locks are auto-cleaned when the owner PID is no longer alive.
- Deposit/withdraw/ragequit use critical sections to defer `SIGINT`/`SIGTERM` during the onchain-confirmed-but-not-yet-persisted window.

### 4. Machine-Mode Sync Fail-Closed

- Query sync paths (`accounts`, `history`, `sync`) fail closed in JSON/machine mode when pool sync is partial.
- Sync freshness metadata is only stamped when all pools sync successfully.

### 5. Transaction Integrity Checks

- Transactional commands wait for receipts and require `receipt.status === "success"` before reporting success.
- Withdraw verifies ASP and onchain root parity before proving and again before submission.
- Withdraw checks pool state root parity (`currentRoot`) against proof inputs.
- Relayed withdraw enforces onchain `maxRelayFeeBPS`, quote expiry handling, and fee-drift invalidation.
- Relayer quote fee commitments are validated for structure **and** request binding (`asset`, `amount`, `extraGas`).
- Ragequit pre-checks original depositor (when available) to avoid wasting proof generation for invalid signers.

### 6. ASP-Offline Fallback Safety

- Symbol fallback (`KNOWN_POOLS`) is used only when ASP lookup fails.
- Fallback addresses are verified onchain via entrypoint/pool reads before use.

### 7. Preflight Checks

- Deposit: native/ERC20 balance checks plus gas availability checks (as applicable).
- Direct withdraw and ragequit: gas availability check before submission.
- Relayed withdraw does not require local gas balance for relay submission path.

## Operational Safety Guidance

- Treat the mnemonic as the highest-value secret. Loss means permanent loss of access.
- In agent mode, only use `--show-recovery-phrase` when immediately capturing to secure storage.
- After any crash or timeout during transactional operations, run `privacy-pools sync --agent` before retrying deposits.

## Known Limitations

- **Endpoint trust**: The CLI trusts configured RPC/ASP/relayer infrastructure.
- **Advisory lock model**: External processes ignoring the lock can still race state.
- **Windows permission semantics**: POSIX mode enforcement is best effort.
- **Resource usage**: Proof generation can be CPU/memory intensive in constrained environments.
- **Fallback registry freshness**: `KNOWN_POOLS` must be kept up to date as protocol assets evolve.
