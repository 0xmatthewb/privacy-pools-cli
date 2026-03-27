import { runCli } from "../../cli-main.js";
import {
  readCliPackageInfo,
  type CliPackageInfo,
} from "../../package-info.js";
import { installConsoleGuard } from "../../utils/console-guard.js";
import {
  readWorkerRequestFromEnv,
  type WorkerRequestV1,
} from "./request.js";

export async function runWorkerRequest(
  request: WorkerRequestV1,
  pkg: CliPackageInfo = readCliPackageInfo(import.meta.url),
  options: {
    installConsoleGuard?: boolean;
  } = {},
): Promise<void> {
  if (options.installConsoleGuard ?? true) {
    installConsoleGuard();
  }
  await runCli(pkg, request.argv);
}

export async function runWorkerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const request = readWorkerRequestFromEnv(env);
  await runWorkerRequest(request);
}

export const workerTestInternals = {
  readWorkerRequestFromEnv,
};
