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
  // ============ BSC (BEP20) ============
  56: {
    WBNB:  { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, symbol: "WBNB" },
    USDT:  { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, symbol: "USDT" },
    USDC:  { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, symbol: "USDC" },
    BUSD:  { address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18, symbol: "BUSD" },
    ETH:   { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18, symbol: "ETH" },
    BTCB:  { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18, symbol: "BTCB" },
    CAKE:  { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, symbol: "CAKE" },
  },

  // ============ Avalanche C-Chain ============
  43114: {
    WAVAX: { address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18, symbol: "WAVAX" },
    USDC:  { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6,  symbol: "USDC" },
    USDCe: { address: "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664", decimals: 6,  symbol: "USDC.e" },
    USDT:  { address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6,  symbol: "USDT" },
    USDTe: { address: "0xc7198437980c041c805A1EDcbA50c1Ce5db95118", decimals: 6,  symbol: "USDT.e" },
    WETHe: { address: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", decimals: 18, symbol: "WETH.e" },
    WBTC:  { address: "0x50b7545627a5162F82A992c33b87aDc75187B218", decimals: 8,  symbol: "WBTC" },
    JOE:   { address: "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd", decimals: 18, symbol: "JOE" },
  },

  // ============ Mantle ============
  5000: {
    WMNT:  { address: "0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8", decimals: 18, symbol: "WMNT" },
    USDC:  { address: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", decimals: 6,  symbol: "USDC" },
    USDT:  { address: "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE", decimals: 6,  symbol: "USDT" },
    WETH:  { address: "0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111", decimals: 18, symbol: "WETH" },
    mETH:  { address: "0xcDA86A272531e8640cD7F1a92c01839911B90bb0", decimals: 18, symbol: "mETH" },
  },

  // ============ Scroll ============
  534352: {
    WETH:   { address: "0x5300000000000000000000000000000000000004", decimals: 18, symbol: "WETH" },
    USDC:   { address: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", decimals: 6,  symbol: "USDC" },
    USDT:   { address: "0xf55BEC9cafDbE8730f096Aa55dad6D22d44099Df", decimals: 6,  symbol: "USDT" },
    wstETH: { address: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32", decimals: 18, symbol: "wstETH" },
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
  const stableSymbols = ["USDC", "USDCe", "USDT", "USDTe", "USDbC", "DAI", "FRAX", "BUSD"];
  const tokens = TOKENS[chainId] || {};
  return Object.entries(tokens)
    .filter(([sym]) => stableSymbols.includes(sym))
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
}

module.exports = { TOKENS, getTokensByChain, getToken, getStablecoins };
