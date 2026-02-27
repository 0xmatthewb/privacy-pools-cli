import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { formatUnits } from "viem";

export function formatAmount(
  value: bigint,
  decimals: number,
  symbol?: string
): string {
  const formatted = formatUnits(value, decimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

export function formatAddress(address: string, chars: number = 6): string {
  if (address.length <= chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatBPS(bps: bigint | string | number): string {
  const percent = Number(bps) / 100;
  return `${percent.toFixed(2)}%`;
}

export function formatTxHash(hash: string): string {
  return formatAddress(hash, 8);
}

export function printTable(
  headers: string[],
  rows: string[][]
): void {
  const table = new Table({
    head: headers.map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  for (const row of rows) {
    table.push(row);
  }

  process.stderr.write(table.toString() + "\n");
}

export function spinner(text: string, quiet: boolean = false) {
  return ora({ text, color: "cyan", stream: process.stderr, isSilent: quiet });
}

export function success(message: string, quiet: boolean = false): void {
  if (quiet) return;
  process.stderr.write(`${chalk.green(`✓ ${message}`)}\n`);
}

export function warn(message: string, quiet: boolean = false): void {
  if (quiet) return;
  process.stderr.write(`${chalk.yellow(`⚠ ${message}`)}\n`);
}

export function info(message: string, quiet: boolean = false): void {
  if (quiet) return;
  process.stderr.write(`${chalk.blue(`ℹ ${message}`)}\n`);
}

export function verbose(
  message: string,
  isVerbose: boolean,
  quiet: boolean = false
): void {
  if (isVerbose && !quiet) {
    process.stderr.write(`${chalk.dim(message)}\n`);
  }
}
