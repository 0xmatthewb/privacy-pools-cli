export interface SeededRng {
  nextUInt32(): number;
  nextFloat(): number;
  nextInt(maxExclusive: number): number;
}

export function getFuzzSeed(envVar: string = "PP_FUZZ_SEED", fallback: number = 1337): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed >>> 0 : fallback;
}

export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;

  const nextUInt32 = (): number => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  return {
    nextUInt32,
    nextFloat(): number {
      return nextUInt32() / 0x1_0000_0000;
    },
    nextInt(maxExclusive: number): number {
      if (maxExclusive <= 0) return 0;
      return Math.floor((nextUInt32() / 0x1_0000_0000) * maxExclusive);
    },
  };
}
