import { join } from "node:path";

export const CIRCUIT_FILES = Object.freeze({
  commitment: Object.freeze({
    wasm: "commitment.wasm",
    zkey: "commitment.zkey",
    vkey: "commitment.vkey",
  }),
  withdraw: Object.freeze({
    wasm: "withdraw.wasm",
    zkey: "withdraw.zkey",
    vkey: "withdraw.vkey",
  }),
});

export const CIRCUIT_SOURCE_PATHS = Object.freeze({
  "commitment.wasm":
    "packages/circuits/build/commitment/commitment_js/commitment.wasm",
  "commitment.zkey":
    "packages/circuits/trusted-setup/final-keys/commitment.zkey",
  "commitment.vkey":
    "packages/circuits/trusted-setup/final-keys/commitment.vkey",
  "withdraw.wasm":
    "packages/circuits/build/withdraw/withdraw_js/withdraw.wasm",
  "withdraw.zkey":
    "packages/circuits/trusted-setup/final-keys/withdraw.zkey",
  "withdraw.vkey":
    "packages/circuits/trusted-setup/final-keys/withdraw.vkey",
});

export const ALL_CIRCUIT_FILES = Object.freeze(
  Object.values(CIRCUIT_FILES).flatMap((files) => [
    files.wasm,
    files.zkey,
    files.vkey,
  ]),
);

export function sdkTagFromVersion(version) {
  return `v${version}`;
}

export function bundledCircuitTag(versionOrTag) {
  return versionOrTag.startsWith("v") ? versionOrTag : sdkTagFromVersion(versionOrTag);
}

export function bundledCircuitsDir(packageRoot, versionOrTag) {
  return join(
    packageRoot,
    "assets",
    "circuits",
    bundledCircuitTag(versionOrTag),
  );
}
