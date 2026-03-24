import type { CommandHelpConfig } from "./help.js";
import {
  COMMAND_PATHS,
  getCommandMetadata as getDiscoveryMetadata,
  type CommandMetadata as CommandDiscoveryMetadata,
  type CommandPath,
} from "./command-discovery-metadata.js";

export {
  buildCapabilitiesPayload,
  buildCommandDescriptor,
  CAPABILITIES_COMMAND_ORDER,
  CAPABILITIES_SCHEMAS,
  COMMAND_PATHS,
  getDocumentedAgentMarkers,
  GLOBAL_FLAG_METADATA,
  listCommandPaths,
  resolveCommandPath,
  type CommandPath,
  type GlobalFlagMetadata,
} from "./command-discovery-metadata.js";

export interface CommandMetadata
  extends Omit<CommandDiscoveryMetadata, "help"> {
  help?: CommandHelpConfig;
}

const COMMAND_HELP_OVERVIEWS: Partial<Record<CommandPath, string[]>> = {
  init: [
    "Generates a BIP-39 mnemonic (used to derive deposit commitments) and a signer key (your onchain identity). Run once.",
    "",
    "Privacy Pools uses two keys:",
    "  Recovery phrase: keeps your deposits private (generated during init)",
    "  Signer key:     pays gas and sends transactions (can be set later)",
    "  These are independent. Set the signer key via PRIVACY_POOLS_PRIVATE_KEY env var.",
    "",
    "During interactive setup, init offers to write a recovery backup to ~/privacy-pools-recovery.txt. Use only one stdin secret source per invocation: either --mnemonic-stdin or --private-key-stdin.",
    "Imported recovery phrases reconstruct both current and legacy account derivations during sync so older Pool Accounts remain discoverable.",
    "Circuit artifacts are provisioned automatically on first proof, cached under ~/.privacy-pools/circuits/v<sdk-version>/, and verified against the shipped checksum manifest.",
  ],
  pools: [
    "When no --chain is specified, shows all mainnet chains. Use --all-chains to include testnets. Pools are sorted by pool balance (highest first) by default. Pass a single asset symbol (e.g. 'pools ETH') for a detail view with your funds, recent activity, and pool stats.",
  ],
  describe: [
    "Useful when a human or agent wants the runtime contract for one command without parsing long-form docs. Accepts spaced command paths like 'withdraw quote' and 'stats global'.",
  ],
  deposit: [
    "Deposits funds (ETH or ERC-20 tokens) into a Privacy Pool, creating a private commitment. A ZK proof is generated locally and the transaction is submitted onchain. The first run may provision checksum-verified circuit artifacts (~60s). Subsequent runs typically complete in 10-30s.",
    "",
    "Non-round deposit amounts can fingerprint your deposit in the anonymity set. The CLI warns and blocks deposits with excessive decimal precision (e.g. 1.276848 ETH), suggesting nearby round alternatives. Use --ignore-unique-amount to override.",
  ],
  withdraw: [
    "Withdraws funds from a Privacy Pool via a relayer (default, recommended) for enhanced privacy. The relayer pays gas on your behalf and takes a small fee, keeping your withdrawal address unlinkable to your deposit. ASP approval is required before withdrawal. If a deposit is poi_required, complete Proof of Association at tornado.0xbow.io first. If it is declined, the recovery path is ragequit. Proof generation may take 10-30s. Use 'withdraw quote' to check relayer fees first.",
    "",
    "A --direct mode exists but is not recommended: it interacts with the pool contract directly, publicly linking your deposit and withdrawal addresses onchain. Prefer relayed withdrawals for privacy.",
    "",
    "Non-round withdrawal amounts may reduce privacy. The CLI suggests round alternatives.",
  ],
  ragequit: [
    "Emergency withdrawal without ASP approval. The original depositor can publicly reclaim funds when the deposit label is not approved. Use 'withdraw' to withdraw privately once your deposit is ASP-approved. Use 'ragequit' at any time to recover funds publicly to your deposit address. Declined deposits must use this path; pending and poi_required deposits can also use it. Falls back to a built-in pool registry when public pool discovery is unavailable. 'exit' is an alias.",
  ],
  accounts: [
    "Without --chain, accounts acts like a dashboard and aggregates your holdings across all mainnet chains. Use --all-chains to include testnets or --chain <name> to focus on one chain.",
    "",
    "Pool Account statuses: approved, pending, poi_required, declined, unknown, spent (fully withdrawn), exited (exit/ragequit).",
    "",
    "ASP statuses: approved (eligible for withdraw), pending (waiting for ASP), poi_required (complete Proof of Association at tornado.0xbow.io before withdraw), declined (cannot use withdraw; use ragequit), unknown.",
    "",
    "Compact modes --summary and --pending-only are intended for polling loops and do not support --details. When polling with --pending-only, Pool Accounts disappear from results when ASP review finishes. Re-run accounts without --pending-only to confirm whether the final status is approved, declined, or poi_required.",
  ],
  sync: [
    "Most commands auto-sync with a 2-minute freshness window. Use sync to force a refresh when you need the latest state immediately.",
  ],
  completion: [
    "Generated scripts register the privacy-pools command.",
    "",
    "Setup (add to your shell profile):",
    "  bash:  privacy-pools completion bash > ~/.local/share/bash-completion/completions/privacy-pools",
    "  zsh:   privacy-pools completion zsh > ~/.zsh/completions/_privacy-pools",
    "  fish:  privacy-pools completion fish > ~/.config/fish/completions/privacy-pools.fish",
    "  pwsh:  privacy-pools completion powershell >> $PROFILE",
  ],
};

function mergedHelp(path: CommandPath): CommandHelpConfig | undefined {
  const metadata = getDiscoveryMetadata(path);
  const overview = COMMAND_HELP_OVERVIEWS[path];

  if (!overview && !metadata.help) {
    return undefined;
  }

  return {
    overview,
    ...(metadata.help ?? {}),
  };
}

export function getCommandMetadata(path: CommandPath): CommandMetadata {
  const metadata = getDiscoveryMetadata(path);
  const help = mergedHelp(path);

  if (!help) {
    return { ...metadata };
  }

  return {
    ...metadata,
    help,
  };
}

export const COMMAND_METADATA: Record<CommandPath, CommandMetadata> =
  Object.fromEntries(
    COMMAND_PATHS.map((path) => [path, getCommandMetadata(path)]),
  ) as Record<CommandPath, CommandMetadata>;
