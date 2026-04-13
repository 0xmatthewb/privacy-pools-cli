/**
 * Output renderer for the `config` command.
 */

import type { OutputContext } from "./common.js";
import {
  guardCsvUnsupported,
  isSilent,
  printJsonSuccess,
} from "./common.js";
import {
  formatKeyValueRows,
  formatSectionHeading,
  type KeyValueRow,
} from "./layout.js";
import { accentBold } from "../utils/theme.js";

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
    printJsonSuccess({
      defaultChain: result.defaultChain,
      recoveryPhraseSet: result.recoveryPhraseSet,
      signerKeySet: result.signerKeySet,
      rpcOverrides: result.rpcOverrides,
      configDir: result.configDir,
    });
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
    printJsonSuccess({
      key: result.key,
      value: result.redacted ? undefined : result.value,
      set: result.value !== null,
      ...(result.redacted ? { redacted: true } : {}),
    });
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
}

export function renderConfigSet(ctx: OutputContext, result: ConfigSetResult): void {
  guardCsvUnsupported(ctx, "config set");

  if (ctx.mode.isJson) {
    printJsonSuccess({
      key: result.key,
      updated: true,
      summary: result.newValueSummary,
    });
    return;
  }

  if (isSilent(ctx)) return;

  process.stderr.write(
    formatKeyValueRows([
      { label: result.key, value: result.newValueSummary, valueTone: "success" as const },
    ]),
  );
}

// ── config path ──────────────────────────────────────────────────────────────

export function renderConfigPath(ctx: OutputContext, configDir: string): void {
  guardCsvUnsupported(ctx, "config path");

  if (ctx.mode.isJson) {
    printJsonSuccess({ configDir });
    return;
  }

  // Always write to stdout for scripting: `dir=$(privacy-pools config path)`
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
    printJsonSuccess({
      profiles: ["default", ...profiles],
      active,
    });
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
    printJsonSuccess({
      profile: name,
      created: true,
      profileDir,
    });
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
    printJsonSuccess({
      profile: active,
      configDir,
    });
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
