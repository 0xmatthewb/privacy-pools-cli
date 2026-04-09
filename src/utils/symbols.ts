import { supportsUnicodeOutput } from "./terminal.js";

type SymbolName =
  | "active"
  | "pending"
  | "current"
  | "warning";

const UNICODE_SYMBOLS: Record<SymbolName, string> = {
  active: "●",
  pending: "○",
  current: "◉",
  warning: "⚠",
};

const ASCII_SYMBOLS: Record<SymbolName, string> = {
  active: "*",
  pending: "o",
  current: ">",
  warning: "!",
};

export function glyph(name: SymbolName): string {
  const symbols = supportsUnicodeOutput() ? UNICODE_SYMBOLS : ASCII_SYMBOLS;
  return symbols[name];
}
