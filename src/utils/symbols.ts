import { supportsUnicodeOutput } from "./terminal.js";

type SymbolName =
  | "success"
  | "failure"
  | "warning"
  | "info"
  | "active"
  | "pending"
  | "current"
  | "deposit"
  | "withdraw"
  | "recovery"
  | "next";

const UNICODE_SYMBOLS: Record<SymbolName, string> = {
  success: "✓",
  failure: "✗",
  warning: "⚠",
  info: "ℹ",
  active: "●",
  pending: "○",
  current: "◉",
  deposit: "↓",
  withdraw: "↑",
  recovery: "⟲",
  next: "→",
};

const ASCII_SYMBOLS: Record<SymbolName, string> = {
  success: "ok",
  failure: "x",
  warning: "!",
  info: "i",
  active: "*",
  pending: "o",
  current: ">",
  deposit: "v",
  withdraw: "^",
  recovery: "~",
  next: "->",
};

export function glyph(name: SymbolName): string {
  const symbols = supportsUnicodeOutput() ? UNICODE_SYMBOLS : ASCII_SYMBOLS;
  return symbols[name];
}
