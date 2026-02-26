import { PrivacyPoolSDK, DataService, } from "@0xbow/privacy-pools-core-sdk";
import { createPublicClient, http } from "viem";
import { getRpcUrl } from "./config.js";
import { loadPrivateKey } from "./wallet.js";
// Use dynamic import for Circuits since it may need async init
let _circuits = null;
let _sdk = null;
async function getCircuits() {
    if (_circuits)
        return _circuits;
    const { Circuits } = await import("@0xbow/privacy-pools-core-sdk");
    _circuits = new Circuits({ browser: false });
    return _circuits;
}
export async function getSDK() {
    if (_sdk)
        return _sdk;
    const circuits = await getCircuits();
    _sdk = new PrivacyPoolSDK(circuits);
    return _sdk;
}
export async function getContracts(chainConfig, rpcOverride) {
    const sdk = await getSDK();
    const rpcUrl = getRpcUrl(chainConfig.id, rpcOverride);
    const privateKey = loadPrivateKey();
    return sdk.createContractInstance(rpcUrl, chainConfig.chain, chainConfig.entrypoint, privateKey);
}
export function getPublicClient(chainConfig, rpcOverride) {
    const rpcUrl = getRpcUrl(chainConfig.id, rpcOverride);
    return createPublicClient({
        chain: chainConfig.chain,
        transport: http(rpcUrl),
    });
}
export function getDataService(chainConfig, poolAddress, rpcOverride) {
    const rpcUrl = getRpcUrl(chainConfig.id, rpcOverride);
    return new DataService([
        {
            chainId: chainConfig.id,
            rpcUrl,
            privacyPoolAddress: poolAddress,
            startBlock: chainConfig.startBlock,
        },
    ]);
}
export async function warmCircuits() {
    const circuits = await getCircuits();
    // Init artifacts triggers download/cache
    if (typeof circuits.initArtifacts === "function") {
        await circuits.initArtifacts("latest");
    }
}
