import { existsSync, readFileSync } from "node:fs";
import type { Command } from "commander";
import { renderBroadcast } from "../output/broadcast.js";
import { createOutputContext } from "../output/common.js";
import { broadcastEnvelope } from "../services/broadcast.js";
import { createSubmissionRecord } from "../services/submissions.js";
import type { GlobalOptions } from "../types.js";
import { CLIError, printError } from "../utils/errors.js";
import { resolveGlobalMode } from "../utils/mode.js";

function readBroadcastInput(inputRef: string): string {
  if (inputRef === "-") {
    let stdin: string;
    try {
      stdin = readFileSync(0, "utf-8");
    } catch (error) {
      throw new CLIError(
        "Failed to read broadcast envelope from stdin.",
        "INPUT",
        `Pipe the full unsigned envelope JSON into 'privacy-pools broadcast -'. Read detail: ${error instanceof Error ? error.message : String(error)}`,
        "INPUT_BROADCAST_STDIN_READ_FAILED",
      );
    }
    if (stdin.trim().length === 0) {
      throw new CLIError(
        "No broadcast envelope was received on stdin.",
        "INPUT",
        "Pipe the full unsigned envelope JSON into 'privacy-pools broadcast -', or pass a file path instead.",
        "INPUT_BROADCAST_EMPTY_STDIN",
      );
    }
    return stdin;
  }

  const trimmed = inputRef.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    throw new CLIError(
      "Inline JSON is not supported for broadcast.",
      "INPUT",
      "Write the envelope JSON to a file and pass its path, or pipe it into 'privacy-pools broadcast -'.",
      "INPUT_BROADCAST_INLINE_JSON_UNSUPPORTED",
    );
  }

  if (!existsSync(inputRef)) {
    throw new CLIError(
      `Broadcast input not found: ${inputRef}`,
      "INPUT",
      "Pass a valid file path, or use '-' to read the envelope JSON from stdin.",
      "INPUT_BROADCAST_INPUT_NOT_FOUND",
    );
  }

  try {
    return readFileSync(inputRef, "utf-8");
  } catch (error) {
    throw new CLIError(
      `Failed to read broadcast input: ${inputRef}`,
      "INPUT",
      `Pass a readable JSON file path, or use '-' to read the envelope JSON from stdin. Read detail: ${error instanceof Error ? error.message : String(error)}`,
      "INPUT_BROADCAST_INPUT_UNREADABLE",
    );
  }
}

export async function handleBroadcastCommand(
  inputRef: string,
  opts: { validateOnly?: boolean; noWait?: boolean },
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);

  try {
    const raw = readBroadcastInput(inputRef);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new CLIError(
        "Broadcast input is not valid JSON.",
        "INPUT",
        `Parse the file or stdin payload as JSON before retrying. Parser detail: ${error instanceof Error ? error.message : String(error)}`,
        "INPUT_BROADCAST_INVALID_JSON",
      );
    }

    const result = await broadcastEnvelope(parsed, {
      rpcOverride: globalOpts?.rpcUrl,
      expectedChain: globalOpts?.chain,
      validateOnly: opts.validateOnly === true,
      noWait: opts.noWait === true,
    });
    const submission = opts.noWait === true && !result.validatedOnly
      ? createSubmissionRecord({
          operation: "broadcast",
          sourceCommand: "broadcast",
          chain: result.chain,
          asset: null,
          broadcastMode: result.broadcastMode,
          broadcastSourceOperation: result.sourceOperation,
          transactions: result.transactions
            .filter((transaction) => transaction.txHash)
            .map((transaction) => ({
              description: transaction.description,
              txHash: transaction.txHash!,
            })),
        })
      : null;
    renderBroadcast(createOutputContext(mode, globalOpts?.verbose ?? false), {
      ...result,
      submissionId: submission?.submissionId ?? null,
    });
  } catch (error) {
    printError(error, mode.isJson);
  }
}
