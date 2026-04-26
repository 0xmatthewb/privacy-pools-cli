import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import type { GlobalOptions } from "../types.js";
import { resolveGlobalMode } from "../utils/mode.js";
import { createOutputContext } from "../output/common.js";
import { renderGuide } from "../output/guide.js";
import { printError } from "../utils/errors.js";
import { guideText } from "../utils/help.js";
import { maybeLaunchBrowser } from "../utils/web.js";

interface GuideCommandOptions {
  topics?: boolean;
  pager?: boolean;
}

function shouldUsePager(opts: GuideCommandOptions, mode: ReturnType<typeof resolveGlobalMode>): boolean {
  return (
    opts.pager === true &&
    !mode.isJson &&
    !mode.isQuiet &&
    process.stdout.isTTY === true
  );
}

function pageGuideText(text: string): boolean {
  const pager = process.env.PAGER?.trim() || "less -R";
  const result = spawnSync(pager, {
    input: `${text}\n`,
    shell: true,
    stdio: ["pipe", "inherit", "inherit"],
  });
  return result.status === 0;
}

function guideWebUrl(topic?: string): string {
  const base = "https://github.com/0xmatthewb/privacy-pools-cli";
  return topic ? `${base}/blob/main/docs/reference.md` : `${base}#readme`;
}

export async function handleGuideCommand(
  topic: string | undefined,
  opts: GuideCommandOptions,
  cmd: Command,
): Promise<void> {
  const globalOpts = cmd.parent?.opts() as GlobalOptions;
  const mode = resolveGlobalMode(globalOpts);
  const resolvedTopic = opts.topics ? "topics" : topic;
  try {
    if (shouldUsePager(opts, mode)) {
      if (pageGuideText(guideText(resolvedTopic))) {
        return;
      }
    }
    maybeLaunchBrowser({
      globalOpts,
      mode,
      url: guideWebUrl(resolvedTopic),
      label: resolvedTopic ? "guide reference" : "guide",
    });
    renderGuide(createOutputContext(mode), resolvedTopic);
  } catch (error) {
    printError(error, mode.isJson);
  }
}
