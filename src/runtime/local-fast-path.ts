import type { CliPackageInfo } from "../package-info.js";
import { CLIError } from "../utils/errors.js";
import { printJsonSuccess } from "../utils/json.js";
import {
  invalidOutputFormatMessage,
  isSupportedOutputFormat,
} from "../utils/mode.js";
import type { InvocationPlan } from "./invocation-plan.js";

type CliPackageInfoSource = CliPackageInfo | (() => CliPackageInfo);

function resolveCliPackageInfo(
  pkg: CliPackageInfoSource,
): CliPackageInfo {
  return typeof pkg === "function" ? pkg() : pkg;
}

export async function writeVersionOutput(
  pkg: CliPackageInfo,
  isStructuredOutputMode: boolean,
): Promise<void> {
  if (isStructuredOutputMode) {
    printJsonSuccess({
      mode: "version",
      version: pkg.version,
    });
    return;
  }

  process.stdout.write(`${pkg.version}\n`);
}

export function exitSuccessfulFastPath(): void {
  if ((process.exitCode ?? 0) !== 0) {
    return;
  }

  process.exitCode = 0;
}

export async function runLocalFastPathPlan(
  plan: InvocationPlan,
  pkg: CliPackageInfoSource,
  argv: string[],
): Promise<boolean> {
  if (plan.kind !== "local-static") {
    return false;
  }

  const { parsed } = plan;
  if (
    parsed.formatFlagValue &&
    !isSupportedOutputFormat(parsed.formatFlagValue)
  ) {
    throw new CLIError(
      invalidOutputFormatMessage(parsed.formatFlagValue),
      "INPUT",
      "Use --help to see usage and examples.",
    );
  }

  switch (plan.fastPath) {
    case "version":
      await writeVersionOutput(
        resolveCliPackageInfo(pkg),
        parsed.isStructuredOutputMode,
      );
      exitSuccessfulFastPath();
      return true;
    case "root-help": {
      const { runStaticRootHelp } = await import("../static-discovery.js");
      await runStaticRootHelp(parsed.isStructuredOutputMode);
      exitSuccessfulFastPath();
      return true;
    }
    case "completion-query": {
      const { runStaticCompletionQuery } = await import("../static-discovery.js");
      if (await runStaticCompletionQuery(argv)) {
        exitSuccessfulFastPath();
        return true;
      }
      return false;
    }
    case "static-discovery": {
      const { runStaticDiscoveryCommand } = await import("../static-discovery.js");
      if (await runStaticDiscoveryCommand(argv, parsed)) {
        exitSuccessfulFastPath();
        return true;
      }
      return false;
    }
  }
}
