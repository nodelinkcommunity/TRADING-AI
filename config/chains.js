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

  bsc: {
    name: "BNB Smart Chain",
    chainId: 56,
    rpc: process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org",
    explorer: "https://bscscan.com",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    // No Aave on BSC - uses Venus Protocol instead
    venusComptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    avgBlockTimeMs: 3000,
  },

  avalanche: {
    name: "Avalanche C-Chain",
    chainId: 43114,
    rpc: process.env.AVAX_RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
    explorer: "https://snowtrace.io",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    aavePoolProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aaveDataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    avgBlockTimeMs: 2000,
  },

  mantle: {
    name: "Mantle",
    chainId: 5000,
    rpc: process.env.MANTLE_RPC_URL || "https://rpc.mantle.xyz",
    explorer: "https://explorer.mantle.xyz",
    nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
    // No Aave on Mantle - uses Lendle (Aave fork) instead
    lendlePool: "0xCFa5aE7c2CE8Fadc6426C1ff872cA45378Fb7cF3",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    avgBlockTimeMs: 2000,
  },

  scroll: {
    name: "Scroll",
    chainId: 534352,
    rpc: process.env.SCROLL_RPC_URL || "https://rpc.scroll.io",
    explorer: "https://scrollscan.com",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    aavePoolProvider: "0x69850D0B276776781C063771b161bd8894BCdD04",
    aavePool: "0x11fCfe756c05AD438e312a7fd934381537D3cFfe",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    avgBlockTimeMs: 3000,
  },

  // ============ Testnets ============
  arbitrumSepolia: {
    name: "Arbitrum Sepolia",
    chainId: 421614,
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://sepolia.arbiscan.io",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    aavePoolProvider: "0xB25a5D144626a0D488e52AE717A051a2E9997076",
    aavePool: "0xBfC91D59fdAA134A4ED45f7B584cAf96D7792Eff",
    aaveDataProvider: "0x12373B5085e3b42D42C1D4ABF3B3Cf4Df0E0Fa01",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    isTestnet: true,
  },

  baseSepolia: {
    name: "Base Sepolia",
    chainId: 84532,
    rpc: "https://sepolia.base.org",
    explorer: "https://sepolia.basescan.org",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    aavePoolProvider: "0xE4C23309117Aa30342BFaae6c95c6478e0A4Ad00",
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
