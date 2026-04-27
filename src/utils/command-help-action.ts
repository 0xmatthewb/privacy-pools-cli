import type { Command } from "commander";
import type { GlobalOptions } from "../types.js";
import { printJsonSuccess } from "./json.js";
import { resolveGlobalMode } from "./mode.js";

function rootOptionsForCommand(command: Command): GlobalOptions {
  let current = command;
  while (current.parent) {
    current = current.parent;
  }
  return current.opts() as GlobalOptions;
}

function commandPath(command: Command): string {
  const names: string[] = [];
  let current: Command | undefined = command;
  while (current?.parent) {
    names.unshift(current.name());
    current = current.parent;
  }
  return names.join(" ");
}

export function showCommandHelpAction(command: Command): () => void {
  return () => {
    const mode = resolveGlobalMode(rootOptionsForCommand(command));
    if (mode.isJson) {
      printJsonSuccess({
        mode: "help",
        command: commandPath(command),
        subcommands: command.commands.map((subcommand) => subcommand.name()),
        help: command.helpInformation().trimEnd(),
      });
      return;
    }
    command.help();
  };
}
