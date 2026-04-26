/**
 * Output renderer for the `config` command.
 */

import type { OutputContext } from "./common.js";
import {
  guardCsvUnsupported,
  isSilent,
  printJsonSuccess,
  success,
  createNextAction,
  appendNextActions,
} from "./common.js";
import {
  formatKeyValueRows,
  formatSectionHeading,
  type KeyValueRow,
} from "./layout.js";
import { accentBold, muted } from "../utils/theme.js";

// ── config list ──────────────────────────────────────────────────────────────

export interface ConfigListResult {
  defaultChain: string | null;
  recoveryPhraseSet: boolean;
  signerKeySet: boolean;
  rpcOverrides: Record<number, string>;
  configDir: string;
}

export function renderConfigList(ctx: OutputContext, result: ConfigListResult): void {
  guardCsvUnsupported(ctx, "config list");

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      defaultChain: result.defaultChain,
      recoveryPhraseSet: result.recoveryPhraseSet,
      signerKeySet: result.signerKeySet,
      rpcOverrides: result.rpcOverrides,
      configDir: result.configDir,
    }, [
      createNextAction("status", "Check CLI and chain connectivity.", "after_config_list", { options: { agent: true } }),
    ]));
    return;
  }

  if (isSilent(ctx)) return;

  process.stderr.write(`\n${accentBold("Configuration")}\n`);

  const rows: KeyValueRow[] = [
    { label: "Config directory", value: result.configDir },
    { label: "default-chain", value: result.defaultChain ?? "(not set)" },
    {
      label: "recovery-phrase",
      value: result.recoveryPhraseSet ? "[set]" : "[not set]",
      valueTone: result.recoveryPhraseSet ? "success" as const : "muted" as const,
    },
    {
      label: "signer-key",
      value: result.signerKeySet ? "[set]" : "[not set]",
      valueTone: result.signerKeySet ? "success" as const : "muted" as const,
    },
  ];

  const overrideEntries = Object.entries(result.rpcOverrides);
  if (overrideEntries.length > 0) {
    for (const [chainId, url] of overrideEntries) {
      rows.push({ label: `rpc-override (chain ${chainId})`, value: url });
    }
  } else {
    rows.push({ label: "rpc-overrides", value: "(none)", valueTone: "muted" as const });
  }

  process.stderr.write(formatKeyValueRows(rows));
  process.stderr.write("\n");
}

// ── config get ───────────────────────────────────────────────────────────────

export interface ConfigGetResult {
  key: string;
  value: string | null;
  sensitive: boolean;
  redacted: boolean;
}

export function renderConfigGet(ctx: OutputContext, result: ConfigGetResult): void {
  guardCsvUnsupported(ctx, "config get");

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      key: result.key,
      value: result.redacted ? undefined : result.value,
      set: result.value !== null,
      ...(result.redacted ? { redacted: true } : {}),
    }, [
      createNextAction("config list", "Review the broader local configuration state.", "after_config_list", { options: { agent: true } }),
    ]));
    return;
  }

  if (isSilent(ctx)) return;

  const displayValue = result.redacted
    ? (result.value !== null ? "[set]" : "[not set]")
    : (result.value ?? "(not set)");

  process.stderr.write(
    formatKeyValueRows([{ label: result.key, value: displayValue }]),
  );
}

// ── config set ───────────────────────────────────────────────────────────────

export interface ConfigSetResult {
  key: string;
  previousValue?: string | null;
  newValueSummary: string;
  action?: "set" | "unset";
  changed?: boolean;
}

export function renderConfigSet(ctx: OutputContext, result: ConfigSetResult): void {
  guardCsvUnsupported(ctx, "config set");

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      key: result.key,
      updated: result.changed ?? true,
      changed: result.changed ?? true,
      removed: result.action === "unset",
      summary: result.newValueSummary,
    }, [
      createNextAction("status", "Verify updated configuration.", "after_config_set", { options: { agent: true } }),
    ]));
    return;
  }

  if (isSilent(ctx)) return;

  success(
    result.action === "unset"
      ? `Configuration cleared: ${result.key} (${result.newValueSummary})`
      : `Configuration updated: ${result.key} = ${result.newValueSummary}`,
    false,
  );
  process.stderr.write(
    formatKeyValueRows([
      {
        label: result.key,
        value: result.newValueSummary,
        valueTone: result.changed === false ? "muted" as const : "success" as const,
      },
    ]),
  );
}

// ── config path ──────────────────────────────────────────────────────────────

export function renderConfigPath(ctx: OutputContext, configDir: string): void {
  guardCsvUnsupported(ctx, "config path");

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({ configDir }, [
      createNextAction("config list", "Inspect the active configuration that lives in this directory.", "after_config_list", { options: { agent: true } }),
    ]));
    return;
  }

  // Always write to stdout for scripting: `dir=$(privacy-pools config path)`
  // Context hint on stderr so interactive users understand the stdout output.
  if (process.stderr.isTTY && !isSilent(ctx)) {
    process.stderr.write(`${muted("# Config directory:")}\n`);
  }
  process.stdout.write(`${configDir}\n`);
}

// ── config profile list ─────────────────────────────────────────────────────

export function renderConfigProfileList(
  ctx: OutputContext,
  profiles: string[],
  active: string,
): void {
  guardCsvUnsupported(ctx, "config profile list");

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      profiles: ["default", ...profiles],
      active,
    }, [
      createNextAction("config profile use", "Switch profiles after reviewing the available options.", "after_config_list", {
        options: { agent: true },
        parameters: [{ name: "profile", type: "profile_name", required: true }],
        runnable: false,
      }),
    ]));
    return;
  }

  if (isSilent(ctx)) return;

  process.stderr.write(`\n${accentBold("Profiles")}\n`);

  const allProfiles = ["default", ...profiles];
  const rows: KeyValueRow[] = allProfiles.map((name) => ({
    label: name,
    value: name === active ? "(active)" : "",
    valueTone: name === active ? ("success" as const) : ("muted" as const),
  }));

  process.stderr.write(formatKeyValueRows(rows));
  process.stderr.write("\n");
}

// ── config profile create ───────────────────────────────────────────────────

export function renderConfigProfileCreate(
  ctx: OutputContext,
  name: string,
  profileDir: string,
): void {
  guardCsvUnsupported(ctx, "config profile create");

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      profile: name,
      created: true,
      profileDir,
    }, [
      createNextAction("config profile use", "Switch into the newly created profile.", "after_config_set", {
        options: { agent: true, profile: name },
      }),
    ]));
    return;
  }

  if (isSilent(ctx)) return;

  process.stderr.write(
    formatKeyValueRows([
      { label: "Profile", value: name, valueTone: "success" as const },
      { label: "Directory", value: profileDir },
    ]),
  );
  process.stderr.write("\n");
}

// ── config profile active ───────────────────────────────────────────────────

export function renderConfigProfileActive(
  ctx: OutputContext,
  active: string,
  configDir: string,
): void {
  guardCsvUnsupported(ctx, "config profile active");

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      profile: active,
      configDir,
    }, [
      createNextAction("config list", "Inspect the active profile configuration.", "after_config_list", { options: { agent: true } }),
    ]));
    return;
  }

  if (isSilent(ctx)) return;

  process.stderr.write(
    formatKeyValueRows([
      { label: "Active profile", value: active, valueTone: "success" as const },
      { label: "Config directory", value: configDir },
    ]),
  );
}

// ── config profile use ──────────────────────────────────────────────────────

export function renderConfigProfileUse(
  ctx: OutputContext,
  active: string,
  configDir: string,
): void {
  guardCsvUnsupported(ctx, "config profile use");

  if (ctx.mode.isJson) {
    printJsonSuccess(appendNextActions({
      profile: active,
      active: true,
      configDir,
    }, [
      createNextAction("status", "Verify CLI health after switching profiles.", "after_config_set", { options: { agent: true } }),
    ]));
    return;
  }

  if (isSilent(ctx)) return;

  success(`Active profile set to ${active}.`, false);
  process.stderr.write(
    formatKeyValueRows([
      { label: "Active profile", value: active, valueTone: "success" as const },
      { label: "Config directory", value: configDir },
    ]),
  );
}
