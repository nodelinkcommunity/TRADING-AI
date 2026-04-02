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
  // ============ BSC (BEP20) ============
  56: {
    pancakeswapV3: {
      name: "PancakeSwap V3",
      type: "v3",
      router: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
      quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
      factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
      fees: [100, 500, 2500, 10000],
    },
    pancakeswapV2: {
      name: "PancakeSwap V2",
      type: "v2",
      router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
      factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
    },
    biswap: {
      name: "BiSwap",
      type: "v2",
      router: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
      factory: "0x858E3312ed3A876947EA49d572A7C42DE08af7EE",
    },
    apeswap: {
      name: "ApeSwap",
      type: "v2",
      router: "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b7",
      factory: "0x0841BD0B734E4F5853f0dD8d7Ea989fAf63568D4",
    },
  },

  // ============ Avalanche C-Chain ============
  43114: {
    traderJoeV2: {
      name: "Trader Joe V2.1",
      type: "v2",
      router: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4",
      factory: "0x9Ad6C38BE94206cA50bb0d90783181834C915DeB",
    },
    pangolin: {
      name: "Pangolin",
      type: "v2",
      router: "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106",
      factory: "0xefa94DE7a4656D787667C749f7E1223D71E9FD88",
    },
    uniswapV3: {
      name: "Uniswap V3",
      type: "v3",
      router: "0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE",
      quoter: "0xbe0F5544EC67e9B3b2D819B1066c7E434Ad94E9e",
      factory: "0x740b1c1de25031C31FF4fC9A62f554A55cdC1baD",
      fees: [100, 500, 3000, 10000],
    },
  },

  // ============ Mantle ============
  5000: {
    merchantMoe: {
      name: "Merchant Moe",
      type: "v2",
      router: "0xeaEE7EE68874218e3f1c40F1b39e4A02B5E40Bb6",
      factory: "0x5bEf015CA9424A7C07B68490616a4C1F094BEdEc",
    },
    agniFinance: {
      name: "Agni Finance",
      type: "v3",
      router: "0x319B69888b0d11cEC22caA5034e25FfFBDc88421",
      quoter: "0x3d146FcE6c1006857750cBe8aF44f76a28041CCc",
      factory: "0x25780dc8Fc3cfBD75F33bFDAB65e969b603b2035",
      fees: [100, 500, 2500, 10000],
    },
    fusionX: {
      name: "FusionX",
      type: "v3",
      router: "0x5989FB161568b9F133eDf5Cf6787f5597762797F",
      quoter: "0x5C0Efc09F1F3Fed2e8E9C87B97B7A12b65D1F919",
      factory: "0x530d2766EAD2240dCf6f1B33E08CeD6f7f3c0ab0",
      fees: [100, 500, 2500, 10000],
    },
  },

  // ============ Scroll ============
  534352: {
    ambientFinance: {
      name: "Ambient Finance",
      type: "v2",
      router: "0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106",
      factory: "0xaaaaAAAACB71BF2C8CaE522EA5fa455571A74106",
    },
    syncswap: {
      name: "SyncSwap",
      type: "v2",
      router: "0x80e38291e06339d10AAB483C65695D004dBD5C69",
      factory: "0x37BAc764494c8db4e54BDE72f6965beA9fa0AC2d",
    },
    uniswapV3: {
      name: "Uniswap V3",
      type: "v3",
      router: "0xfc30937f5Adb2fEcb2Cf071394e3c5d2C9975733",
      quoter: "0x2E0C7C29eAfc0E5CeE9be55a8b1cB5EB0d785d1e",
      factory: "0x31b9F7d1B3e38882b60e80fa8D32F42ABE3f0a34",
      fees: [100, 500, 3000, 10000],
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
