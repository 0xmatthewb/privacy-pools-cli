import { mkdirSync, writeFileSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import {
  saveConfig,
  saveMnemonicToFile,
  saveSignerKey,
} from "../../src/services/config.ts";
import type { CliRunOptions, CliRunResult } from "./cli.ts";
import {
  TEST_MNEMONIC,
  TEST_PRIVATE_KEY,
  cleanupTrackedTempHome,
  createTempHome,
  mustInitSeededHome,
  runBuiltCli,
  runCli,
} from "./cli.ts";
import { terminateChildProcess } from "./process.ts";

export interface TestWorld {
  readonly home: string;
  readonly configHome: string;
  readonly cwd: string;
  env: Record<string, string | undefined>;
  lastResult: CliRunResult | null;
  seedHome(chain?: string): void;
  setEnv(env: Record<string, string | undefined>): void;
  setProcessEnv(env: Record<string, string | undefined>): void;
  useConfigHome(env?: Record<string, string | undefined>): string;
  seedConfigHome(options?: {
    defaultChain?: string;
    withMnemonic?: boolean;
    withSigner?: boolean;
    mnemonic?: string;
    signerKey?: string;
    rpcOverrides?: Record<number, string>;
  }): string;
  pathFor(relativePath: string): string;
  writeFile(relativePath: string, content: string): string;
  runCli(
    args: string[],
    options?: Omit<CliRunOptions, "home" | "env">,
  ): CliRunResult;
  runBuiltCli(
    args: string[],
    options?: Omit<CliRunOptions, "home" | "env">,
  ): CliRunResult;
  trackChildProcess<T extends ChildProcess>(proc: T): T;
  teardown(): Promise<void>;
}

export function createTestWorld(
  options: {
    prefix?: string;
    cwd?: string;
  } = {},
): TestWorld {
  const home = createTempHome(options.prefix ?? "pp-test-world-");
  const configHome = join(home, ".privacy-pools");
  const cwd = options.cwd ?? process.cwd();
  const trackedChildren = new Set<ChildProcess>();
  const originalProcessEnv = new Map<string, string | undefined>();

  function setProcessEnvValues(env: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(env)) {
      if (!originalProcessEnv.has(key)) {
        originalProcessEnv.set(key, process.env[key]);
      }

      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  }

  const world: TestWorld = {
    home,
    configHome,
    cwd,
    env: {},
    lastResult: null,
    seedHome(chain: string = "mainnet") {
      mustInitSeededHome(home, chain);
    },
    setEnv(env: Record<string, string | undefined>) {
      world.env = {
        ...world.env,
        ...env,
      };
    },
    setProcessEnv(env) {
      setProcessEnvValues(env);
    },
    useConfigHome(env = {}) {
      setProcessEnvValues({
        PRIVACY_POOLS_HOME: configHome,
        PRIVACY_POOLS_CONFIG_DIR: undefined,
        ...env,
      });
      return configHome;
    },
    seedConfigHome({
      defaultChain = "mainnet",
      withMnemonic = true,
      withSigner = false,
      mnemonic = TEST_MNEMONIC,
      signerKey = TEST_PRIVATE_KEY,
      rpcOverrides = {},
    } = {}) {
      world.useConfigHome();
      saveConfig({
        defaultChain,
        rpcOverrides,
      });
      if (withMnemonic) {
        saveMnemonicToFile(mnemonic);
      }
      if (withSigner) {
        saveSignerKey(signerKey);
      }
      return configHome;
    },
    pathFor(relativePath: string) {
      return join(home, relativePath);
    },
    writeFile(relativePath: string, content: string) {
      const absolutePath = join(home, relativePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, content, "utf8");
      return absolutePath;
    },
    runCli(args, testOptions = {}) {
      world.lastResult = runCli(args, {
        ...testOptions,
        cwd,
        home,
        env: {
          ...world.env,
          ...testOptions.env,
        },
      });
      return world.lastResult;
    },
    runBuiltCli(args, testOptions = {}) {
      world.lastResult = runBuiltCli(args, {
        ...testOptions,
        cwd,
        home,
        env: {
          ...world.env,
          ...testOptions.env,
        },
      });
      return world.lastResult;
    },
    trackChildProcess(proc) {
      trackedChildren.add(proc);
      proc.once("exit", () => {
        trackedChildren.delete(proc);
      });
      return proc;
    },
    async teardown() {
      for (const proc of Array.from(trackedChildren).reverse()) {
        trackedChildren.delete(proc);
        await terminateChildProcess(proc).catch(() => undefined);
      }
      for (const [key, value] of originalProcessEnv.entries()) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      originalProcessEnv.clear();
      cleanupTrackedTempHome(home);
    },
  };

  return world;
}
