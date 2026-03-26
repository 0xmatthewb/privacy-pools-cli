import { mkdirSync, writeFileSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import type { CliRunOptions, CliRunResult } from "./cli.ts";
import {
  createTempHome,
  mustInitSeededHome,
  runBuiltCli,
  runCli,
} from "./cli.ts";
import { terminateChildProcess } from "./process.ts";

export interface TestWorld {
  readonly home: string;
  readonly cwd: string;
  env: Record<string, string | undefined>;
  lastResult: CliRunResult | null;
  seedHome(chain?: string): void;
  setEnv(env: Record<string, string | undefined>): void;
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
  const cwd = options.cwd ?? process.cwd();
  const trackedChildren = new Set<ChildProcess>();

  const world: TestWorld = {
    home,
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
    },
  };

  return world;
}
