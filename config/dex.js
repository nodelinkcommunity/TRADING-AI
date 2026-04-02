/**
 * FLASHLOAN-AI: DEX Router Addresses theo Chain
 * Cau hinh routers, quoters, va factories cho cac DEX
 */

const DEX = {
  // ============ Arbitrum One ============
  42161: {
    uniswapV3: {
      name: "Uniswap V3",
      type: "v3",
      router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
      factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      fees: [100, 500, 3000, 10000],
    },
    sushiswap: {
      name: "SushiSwap",
      type: "v2",
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
    },
    camelot: {
      name: "Camelot",
      type: "v2",
      router: "0xc873fEcbd354f5A56E00E710B90EF4201db2448d",
      factory: "0x6EcCab422D763aC031210895C81787E87B43A652",
    },
  },

  // ============ Base ============
  8453: {
    uniswapV3: {
      name: "Uniswap V3",
      type: "v3",
      router: "0x2626664c2603336E57B271c5C0b26F421741e481",
      quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
      fees: [100, 500, 3000, 10000],
    },
    aerodrome: {
      name: "Aerodrome",
      type: "v2",
      router: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
      factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
    },
  },

  // ============ Polygon ============
  137: {
    uniswapV3: {
      name: "Uniswap V3",
      type: "v3",
      router: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
      quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
      factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      fees: [100, 500, 3000, 10000],
    },
    sushiswap: {
      name: "SushiSwap",
      type: "v2",
      router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      factory: "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
    },
    quickswap: {
      name: "QuickSwap",
      type: "v2",
      router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
      factory: "0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32",
    },
  },
};

function getDexByChain(chainId) {
  return DEX[chainId] || {};
}

function getDex(chainId, dexName) {
  const dexes = DEX[chainId];
  return dexes ? dexes[dexName] || null : null;
}

function getV3Dexes(chainId) {
  const dexes = DEX[chainId] || {};
  return Object.entries(dexes)
    .filter(([, d]) => d.type === "v3")
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
}

function getV2Dexes(chainId) {
  const dexes = DEX[chainId] || {};
  return Object.entries(dexes)
    .filter(([, d]) => d.type === "v2")
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
}

module.exports = { DEX, getDexByChain, getDex, getV3Dexes, getV2Dexes };
