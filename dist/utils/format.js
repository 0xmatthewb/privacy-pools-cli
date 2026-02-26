import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { formatUnits } from "viem";
export function formatAmount(value, decimals, symbol) {
    const formatted = formatUnits(value, decimals);
    return symbol ? `${formatted} ${symbol}` : formatted;
}
export function formatAddress(address, chars = 6) {
    if (address.length <= chars * 2 + 2)
        return address;
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
export function formatBPS(bps) {
    const percent = Number(bps) / 100;
    return `${percent.toFixed(2)}%`;
}
export function formatTxHash(hash) {
    return formatAddress(hash, 8);
}
export function printTable(headers, rows, options) {
    if (options?.json) {
        const records = rows.map((row) => Object.fromEntries(headers.map((header, idx) => [header, row[idx] ?? ""])));
        console.log(JSON.stringify(records));
        return;
    }
    const table = new Table({
        head: headers.map((h) => chalk.bold(h)),
        style: { head: [], border: [] },
    });
    for (const row of rows) {
        table.push(row);
    }
    process.stderr.write(table.toString() + "\n");
}
export function spinner(text, quiet = false) {
    return ora({ text, color: "cyan", stream: process.stderr, isSilent: quiet });
}
export function success(message, quiet = false) {
    if (quiet)
        return;
    process.stderr.write(`${chalk.green(`✓ ${message}`)}\n`);
}
export function warn(message, quiet = false) {
    if (quiet)
        return;
    process.stderr.write(`${chalk.yellow(`⚠ ${message}`)}\n`);
}
export function info(message, quiet = false) {
    if (quiet)
        return;
    process.stderr.write(`${chalk.blue(`ℹ ${message}`)}\n`);
}
export function verbose(message, isVerbose, quiet = false) {
    if (isVerbose && !quiet) {
        process.stderr.write(`${chalk.dim(message)}\n`);
    }
}
