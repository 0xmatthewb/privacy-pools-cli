/**
 * Fuzzy matching utility for CLI error suggestions.
 *
 * Provides Levenshtein-distance–based "did you mean?" hints when users
 * mistype chain names, asset symbols, or other identifiers.
 */

/**
 * Compute Levenshtein edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Suggest the closest candidate(s) for a misspelled input.
 * Returns null if no candidate is within maxDistance.
 */
export function didYouMean(
  input: string,
  candidates: string[],
  maxDistance = 3,
): string | null {
  const lower = input.toLowerCase();
  let bestMatch: string | null = null;
  let bestDist = maxDistance + 1;
  for (const c of candidates) {
    const dist = levenshtein(lower, c.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = c;
    }
  }
  return bestMatch;
}

export function didYouMeanMany(
  input: string,
  candidates: string[],
  maxDistance = 3,
  limit = 3,
): string[] {
  const lower = input.toLowerCase();
  return candidates
    .map((candidate) => ({
      candidate,
      distance: levenshtein(lower, candidate.toLowerCase()),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((left, right) =>
      left.distance === right.distance
        ? left.candidate.localeCompare(right.candidate)
        : left.distance - right.distance,
    )
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
