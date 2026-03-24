export function npmBin(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}
