# Privacy Pools CLI Copy Style Guide

This guide defines the copy rules for command help, guides, JSON envelopes,
errors, warnings, and generated reference docs. Treat it as a contract for
future edits: new wording should fit these rules before it lands.

The goals are simple:

- keep terms stable across human and agent surfaces
- keep privacy and safety copy precise without sounding theatrical
- keep JSON and CLI text from drifting apart
- make future edits additive and boring

## 1. Meta Rules

### 1.1 Centralize Before You Inline

If a sentence appears in more than one command, put it behind a shared helper
or shared constant. Do this before adding a second copy variant.

Shared copy belongs in one of these places:

- `src/output/copy.ts` for repeated human-facing safety or result text
- `src/output/*` helpers for command-specific renderers
- `src/utils/command-catalog.ts` for generated discovery and reference text
- `src/utils/error-code-registry.ts` and `docs/errors.md` for error code docs
- `AGENTS.md` for agent-facing behavior contracts

Do not add command-local wording when an equivalent shared phrase already
exists.

### 1.2 Lock The Vocabulary

Use the canonical term from this guide even when another term feels natural.
Privacy Pools copy is read by humans, agents, docs generators, shell manifests,
and native routing tests; synonyms become behavior risk.

### 1.3 Prefer Closed Sets To Free Text

Any value agents may branch on must be a closed set in code and documented from
that source of truth.

Closed sets include:

- error codes
- exit categories
- `NextActionWhen`
- workflow phases
- status/recommended modes
- warning codes
- deprecation states

Never introduce an undocumented string state in a JSON envelope.

## 2. Casing Matrix

| Surface | Style | Example |
| --- | --- | --- |
| CLI commands | kebab-case words | `flow status` |
| CLI flags | kebab-case | `--pool-account` |
| JSON keys | camelCase | `nextActions` |
| JSON enum values | snake_case | `approved_ready_to_withdraw` |
| Error codes | SCREAMING_SNAKE_CASE | `INPUT_FLAG_CONFLICT` |
| `NextActionWhen` | snake_case | `after_submit` |
| Workflow phases | snake_case | `awaiting_asp` |
| Human headings | Title Case | `Safety Notes` |
| Human sentences | sentence case | `Run privacy-pools status.` |
| Environment variables | SCREAMING_SNAKE_CASE | `PRIVACY_POOLS_HOME` |
| Public docs paths | kebab-case | `runtime-upgrades.md` |

### 2.1 Known v2 Exception

`StatusRecommendedMode` currently uses kebab-case values:

- `setup-required`
- `read-only`
- `unsigned-only`
- `ready`

These are legacy v2 JSON values. Do not add new kebab-case state enums. If this
field changes in the next breaking JSON contract, migrate it to snake_case and
document the compatibility window explicitly.

## 3. Vocabulary

Use these terms exactly.

| Canonical term | Rule |
| --- | --- |
| onchain | Use as one word. |
| Pool Account | Capitalize when referring to the user's tracked deposit. |
| pool | Lowercase when referring to the protocol pool itself. |
| ASP | Use for the service after the first expanded mention. |
| Association Set Provider | First-use expansion for ASP. |
| ASP vetting fee | Use for the fee retained during deposit review. |
| recovery phrase | Use for the mnemonic. Do not use seed phrase in CLI copy. |
| signer key | Use for the transaction-paying private key. |
| ragequit | Use for public self-custody recovery. |
| public recovery | Use as the explanatory phrase for ragequit. |
| withdraw | Use for private withdrawals. |
| direct withdrawal | Use for non-private direct withdrawal mode. |
| saved flow | Use for stored `flow start` workflows. |
| workflow | Use when referring to the broader flow mechanism or file. |
| pending ASP review | Use for deposits waiting on ASP status. |
| approved | Use when private withdrawal is available. |
| declined | Use when private withdrawal is unavailable and public recovery remains. |
| needs reconciliation | Use when local state must be refreshed after tx confirmation. |

Avoid these substitutions:

- Do not use the legacy approval-provider phrase; use `ASP` or `Association Set Provider`.
- Do not use `exit` as the primary CLI verb for ragequit.
- Do not use `recover` when the user can still withdraw privately.
- Do not use `easy path` in JSON contracts; use `saved flow`.
- Do not lowercase the user-facing `Pool Account` entity name.

## 4. Punctuation And Formatting

Use sentence-final periods in prose, warnings, hints, and safety notes.

Do not add periods to:

- CLI examples
- table cells that are fragments
- placeholders
- headings
- JSON enum values

Use ASCII quotes and apostrophes in source files unless a file already uses a
different character set for a deliberate reason.

Use backticks for literal commands, flags, JSON keys, environment variables, and
file paths in Markdown. Do not use backticks in terminal output unless the
surrounding renderer already uses them consistently.

Use `privacy-pools` in examples, not `npm run dev --`, unless the surrounding
doc is specifically for source checkout development.

## 5. Help Text

### 5.1 Command Descriptions

Command descriptions should answer what the command does, not how the whole
protocol works.

Preferred shape:

```text
List your own Pool Accounts (deposits, balances, statuses).
Browse the public activity feed (deposits, withdrawals, ragequits) across the protocol.
```

Descriptions should be one sentence. Put background, examples, and safety notes
in `--help-full`.

### 5.2 Argument Descriptions

Keep short argument descriptions short. Move optional examples and edge cases to
examples or safety notes.

Use:

```text
<amount>  Amount to deposit or withdraw.
```

Avoid adding long parentheticals to the argument itself.

### 5.3 Option Descriptions

Flag descriptions should be imperative or declarative, not narrative.

Use:

```text
--agent  Machine-friendly mode (alias for --json --yes --quiet)
```

If a flag has high-stakes semantics, say so directly:

```text
--confirm-ragequit  Required in non-interactive mode. Acknowledges public recovery to the original deposit address.
```

### 5.4 Placeholders

Use stable placeholder names:

- `<amount>`
- `<asset>`
- `<address>`
- `<workflowId>`
- `<submissionId>`
- `<path>`
- `<profile>`

Use `<address>` for examples unless the field can explicitly accept ENS. Use
`<address-or-ens>` only when the parser supports both and the copy is about the
input format.

### 5.5 Flag Groups

Use these group names consistently:

- `Setup`
- `Safety`
- `Transaction`
- `Output & Defaults`
- `Workflow`
- `Advanced`

Put `--yes`, `--agent`, `--json`, `--quiet`, `--no-progress`, `--no-banner`, and
`--no-color` under `Output & Defaults` unless a command has a stronger local
reason to duplicate the flag under `Safety`.

### 5.6 Deprecation Copy

Deprecation copy must include:

- the replacement command or flag
- whether the old command still runs
- the earliest removal window, if known

Use `deprecated: true` in command discovery for deprecated commands. Do not add
top-level `meta.deprecated` to JSON envelopes.

## 6. Errors And Hints

### 6.1 Error Shape

Structured errors expose `error.docUrl` as the canonical documentation pointer.
Do not serialize `error.docsSlug` in JSON envelopes.

Internal code may keep a docs slug for human rendering, but the public JSON
field is `docUrl`.

Error envelopes keep these compatibility aliases:

- `errorCode`
- `errorMessage`

Do not add new top-level mirrors of fields that already belong under
`error.details`.

### 6.2 Hint Verbs

Use one verb based on the action:

| User action | Verb |
| --- | --- |
| Execute another command | Run |
| Choose a different flag/mode | Use |
| Retry after external state changes | Wait |
| Correct invalid input | Try |
| Provide missing local setup | Set |

Examples:

```text
Run privacy-pools accounts --refresh --chain mainnet.
Use --all to withdraw the full balance.
Try a checksummed Ethereum address.
Set PRIVACY_POOLS_PRIVATE_KEY before retrying.
```

### 6.3 Error Codes

Prefer one parametric error code with `details` over multiple near-identical
codes. Add a new code only when an agent should branch differently.

Every new error code must be registered in `src/utils/error-code-registry.ts`
and appear in generated `docs/errors.md`.

### 6.4 Details

Put sensitive or verbose values under `error.details`, not in the human hint.

Use placeholders in hints when the actual value could leak into logs:

```text
Top up <configured wallet> before retrying.
```

Then include the concrete value under `details.walletAddress` when needed.

## 7. JSON Contracts

### 7.1 Schema Version

Do not bump `schemaVersion` for copy-only changes or additive optional fields.
Bump only for breaking structural changes.

### 7.2 nextActions

`nextActions[]` is the canonical machine follow-up field. Each action must have:

- `command`
- `reason`
- `when`
- `cliCommand` when runnable
- `runnable` when the action is a template or needs clarification

The first matching action is highest priority.

### 7.3 Workflow Phases

Workflow phases are locked in `FLOW_PHASE_VALUES` in `src/types.ts` and re-
exported by `src/services/workflow.ts`.

When adding or renaming a phase, update all of these surfaces in the same
change:

- `FLOW_PHASE_VALUES`
- `AGENTS.md`
- `privacy-pools guide flow-states`
- generated capabilities/describe schemas
- native manifest, if the phase appears in generated metadata
- conformance tests

### 7.4 Deprecated Metadata

Do not emit `meta.deprecated` in success or error envelopes. It is not the
canonical soft-deprecation channel.

Use these channels instead:

- `deprecated: true` in command discovery for deprecated commands
- command help and reference docs for migration wording
- a human deprecation callout when the user invokes a deprecated command
- `deprecationWarning` only for command-specific payloads that already own that
  field

## 8. Known Legacy Contracts

### 8.1 StatusRecommendedMode

The v2 values are kebab-case for compatibility. Keep the closed set in
`STATUS_RECOMMENDED_MODE_VALUES`. New state enums should use snake_case. A v3
migration may rename this field's values to snake_case if the migration is
documented in `AGENTS.md`, the JSON contract, and release notes.

### 8.2 CONTRACT_INVALID_PROCESSOOOR

`CONTRACT_INVALID_PROCESSOOOR` is a shipped public error code. The spelling is
part of the v2 contract and must not be corrected in place.

Rules:

- keep the public code exactly as shipped
- keep docs anchors aligned to the shipped spelling
- do not introduce a second public code as a spelling-only alias
- if internal spelling helpers are added, keep them private to the classifier

## 9. Human Output

### 9.1 Tables

Data rows should contain data only. Do not add decorative glyphs to table cells.
Use glyphs only in progress, system, or section context where they do not become
machine-copied data.

Human table headers and CSV headers must be separate constants. CSV headers
should carry unit metadata when needed.

### 9.2 CSV

CSV values should be import-friendly:

- raw integer amounts stay raw
- decimals go in adjacent `decimals` columns
- assets go in adjacent `asset` columns
- USD values use integer cents when the source is currency-like
- no `$`, commas, unit suffixes, or decorated numbers in CSV cells

### 9.3 Result Sentences

Transaction result copy should follow one of three shapes:

```text
Submitted. Track it with privacy-pools tx-status <submissionId>.
Confirmed onchain. Local state is up to date.
Confirmed onchain. Local state needs reconciliation.
```

Keep async, confirmed, and reconciliation states parallel across deposit,
withdraw, ragequit, and broadcast surfaces.

## 10. Privacy And Safety Copy

High-stakes copy should include four pieces in this order:

1. the action and scope
2. the destination or affected account
3. the privacy mechanism or privacy loss
4. whether the action is irreversible

Use calm, concrete wording. Do not intensify copy with dramatic adjectives.

### 10.1 Direct Withdrawal

Direct withdrawal copy must say that it links the deposit and withdrawal
onchain. It must name the recipient when known.

### 10.2 Ragequit

Ragequit copy must say that it publicly recovers a Pool Account to the original
deposit address and does not provide privacy for that Pool Account.

### 10.3 Recovery Phrase

Recovery phrase copy must put the most actionable sentence first:

```text
Save this recovery phrase now. This is the only time the CLI will display it.
```

Follow with storage guidance and irreversibility.

## 11. Generated Docs

Generated files should reflect source copy, not patch over it.

When changing help text or command metadata, run:

```bash
npm run discovery:generate
npm run docs:generate
```

When changing JSON envelope structure, also run:

```bash
npm run schemas:generate
```

Do not hand-edit generated command reference pages unless the generator itself
is wrong.

## 12. Review Checklist

Before shipping copy or contract changes, check:

- Does the wording use the canonical vocabulary?
- Is any repeated sentence centralized?
- Does every agent-branchable string come from an `as const` set?
- Are human help, generated docs, native manifest, and capabilities aligned?
- Does JSON expose `docUrl` only, not `docsSlug`?
- Is `meta.deprecated` absent from public envelopes?
- Are CSV headers separate from human table headers?
- Are sensitive values kept out of hints and placed in `details`?
- Does any legacy spelling remain intentionally stable?
