/**
 * FLASHLOAN-AI: Token Addresses theo Chain
 * Danh sach cac token duoc ho tro tren tung chain
 */

const TOKENS = {
  // ============ Arbitrum One ============
  42161: {
    WETH:  { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, symbol: "WETH" },
    USDC:  { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6,  symbol: "USDC" },
    USDCe: { address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6,  symbol: "USDC.e" },
    USDT:  { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6,  symbol: "USDT" },
    WBTC:  { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8,  symbol: "WBTC" },
    ARB:   { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, symbol: "ARB" },
    LINK:  { address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18, symbol: "LINK" },
    DAI:   { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, symbol: "DAI" },
    FRAX:  { address: "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F", decimals: 18, symbol: "FRAX" },
    GMX:   { address: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", decimals: 18, symbol: "GMX" },
  },

  // ============ Base ============
  8453: {
    WETH:  { address: "0x4200000000000000000000000000000000000006", decimals: 18, symbol: "WETH" },
    USDC:  { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  symbol: "USDC" },
    USDbC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6,  symbol: "USDbC" },
    DAI:   { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, symbol: "DAI" },
    cbETH: { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18, symbol: "cbETH" },
  },

  // ============ Polygon ============
  137: {
    WMATIC: { address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18, symbol: "WMATIC" },
    WETH:   { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, symbol: "WETH" },
    USDC:   { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6,  symbol: "USDC" },
    USDCe:  { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6,  symbol: "USDC.e" },
    USDT:   { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6,  symbol: "USDT" },
    WBTC:   { address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8,  symbol: "WBTC" },
    DAI:    { address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, symbol: "DAI" },
    LINK:   { address: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39", decimals: 18, symbol: "LINK" },
  },
};

function getTokensByChain(chainId) {
  return TOKENS[chainId] || {};
}

function getToken(chainId, symbol) {
  const tokens = TOKENS[chainId];
  return tokens ? tokens[symbol] || null : null;
}

function getStablecoins(chainId) {
  const stableSymbols = ["USDC", "USDCe", "USDT", "USDbC", "DAI", "FRAX"];
  const tokens = TOKENS[chainId] || {};
  return Object.entries(tokens)
    .filter(([sym]) => stableSymbols.includes(sym))
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
}

module.exports = { TOKENS, getTokensByChain, getToken, getStablecoins };
