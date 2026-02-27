import { mainnet, arbitrum, optimism, sepolia, optimismSepolia, } from "viem/chains";
export const CHAINS = {
    ethereum: {
        id: 1,
        name: "ethereum",
        chain: mainnet,
        entrypoint: "0x6818809eefce719e480a7526d76bd3e561526b46",
        startBlock: 22153709n,
        aspHost: "https://api.0xbow.io",
        relayerHost: "https://fastrelay.xyz",
        isTestnet: false,
    },
    arbitrum: {
        id: 42161,
        name: "arbitrum",
        chain: arbitrum,
        entrypoint: "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
        startBlock: 404391795n,
        aspHost: "https://api.0xbow.io",
        relayerHost: "https://fastrelay.xyz",
        isTestnet: false,
    },
    optimism: {
        id: 10,
        name: "optimism",
        chain: optimism,
        entrypoint: "0x44192215fed782896be2ce24e0bfbf0bf825d15e",
        startBlock: 144288139n,
        aspHost: "https://api.0xbow.io",
        relayerHost: "https://fastrelay.xyz",
        isTestnet: false,
    },
    sepolia: {
        id: 11155111,
        name: "sepolia",
        chain: sepolia,
        entrypoint: "0x34a2068192b1297f2a7f85d7d8cde66f8f0921cb",
        startBlock: 8461450n,
        aspHost: "https://dw.0xbow.io",
        relayerHost: "https://testnet-relayer.privacypools.com",
        isTestnet: true,
    },
    "op-sepolia": {
        id: 11155420,
        name: "op-sepolia",
        chain: optimismSepolia,
        entrypoint: "0x54aca0d27500669fa37867233e05423701f11ba1",
        startBlock: 32854673n,
        aspHost: "https://dw.0xbow.io",
        relayerHost: "https://testnet-relayer.privacypools.com",
        isTestnet: true,
    },
};
export const CHAIN_NAMES = Object.keys(CHAINS);
export const NATIVE_ASSET_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const EXPLORER_URLS = {
    1: "https://etherscan.io",
    42161: "https://arbiscan.io",
    10: "https://optimistic.etherscan.io",
    11155111: "https://sepolia.etherscan.io",
    11155420: "https://sepolia-optimism.etherscan.io",
};
export function explorerTxUrl(chainId, txHash) {
    const base = EXPLORER_URLS[chainId];
    if (!base)
        return null;
    return `${base}/tx/${txHash}`;
}
