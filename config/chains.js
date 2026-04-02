/**
 * FLASHLOAN-AI: Chain Configurations
 * Cau hinh cho tung blockchain (mainnet + testnet)
 */

const CHAINS = {
  // ============ Mainnets ============
  arbitrum: {
    name: "Arbitrum One",
    chainId: 42161,
    rpc: process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbiscan.io",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    aavePoolProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aaveDataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    avgBlockTimeMs: 250,
  },

  base: {
    name: "Base",
    chainId: 8453,
    rpc: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    explorer: "https://basescan.org",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    aavePoolProvider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
    aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    aaveDataProvider: "0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    avgBlockTimeMs: 2000,
  },

  polygon: {
    name: "Polygon PoS",
    chainId: 137,
    rpc: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
    explorer: "https://polygonscan.com",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
    aavePoolProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aaveDataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    avgBlockTimeMs: 2000,
  },

  // ============ Testnets ============
  arbitrumSepolia: {
    name: "Arbitrum Sepolia",
    chainId: 421614,
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    aavePoolProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    isTestnet: true,
  },

  baseSepolia: {
    name: "Base Sepolia",
    chainId: 84532,
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    aavePoolProvider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    isTestnet: true,
  },
};

function getChainById(chainId) {
  return Object.values(CHAINS).find((c) => c.chainId === chainId) || null;
}

function getChainByName(name) {
  return CHAINS[name] || null;
}

function getAllMainnets() {
  return Object.entries(CHAINS)
    .filter(([, c]) => !c.isTestnet)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
}

function getAllTestnets() {
  return Object.entries(CHAINS)
    .filter(([, c]) => c.isTestnet)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
}

module.exports = { CHAINS, getChainById, getChainByName, getAllMainnets, getAllTestnets };
