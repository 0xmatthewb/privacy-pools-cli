import { supportsUnicodeOutput } from "./terminal.js";

type SymbolName =
  | "active"
  | "pending"
  | "current"
  | "warning"
  | "success"
  | "failure";

const UNICODE_SYMBOLS: Record<SymbolName, string> = {
  active: "●",
  pending: "○",
  current: "◉",
  warning: "⚠",
  success: "✓",
  failure: "✖",
};

const ASCII_SYMBOLS: Record<SymbolName, string> = {
  active: "*",
  pending: "o",
  current: ">",
  warning: "!",
  success: "+",
  failure: "x",
};

export function glyph(name: SymbolName): string {
  const symbols = supportsUnicodeOutput() ? UNICODE_SYMBOLS : ASCII_SYMBOLS;
  return symbols[name];
}
