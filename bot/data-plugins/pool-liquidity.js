/**
 * FLASHLOAN-AI: Pool & Liquidity Plugin
 * Sources: The Graph subgraphs + DeFi Llama API
 * Provides real-time pool reserves, TVL, volume, liquidity trends.
 */

const axios = require("axios");
const BasePlugin = require("./base-plugin");

// The Graph subgraph endpoints (free, decentralized)
const SUBGRAPH_URLS = {
  arbitrum: {
    "uniswapV3": "https://api.thegraph.com/subgraphs/name/messari/uniswap-v3-arbitrum",
    "sushiswap": "https://api.thegraph.com/subgraphs/name/messari/sushiswap-arbitrum",
  },
  base: {
    "uniswapV3": "https://api.thegraph.com/subgraphs/name/messari/uniswap-v3-base",
  },
  polygon: {
    "uniswapV3": "https://api.thegraph.com/subgraphs/name/messari/uniswap-v3-polygon",
    "sushiswap": "https://api.thegraph.com/subgraphs/name/messari/sushiswap-polygon",
  },
  bsc: {
    "pancakeswapV3": "https://api.thegraph.com/subgraphs/name/messari/pancakeswap-v3-bsc",
  },
  avalanche: {
    "uniswapV3": "https://api.thegraph.com/subgraphs/name/messari/uniswap-v3-avalanche",
  },
};

// DeFi Llama base URL
const DEFILLAMA_BASE = "https://api.llama.fi";
const DEFILLAMA_YIELDS = "https://yields.llama.fi";

class PoolLiquidityPlugin extends BasePlugin {
  constructor() {
    super("pool-liquidity", "A");
    this._cacheTTL = 30000; // 30s cache
    this.latestData = {
      pools: {},
      protocolTVL: {},
      topPools: [],
      stablecoins: {},
      timestamp: 0,
    };
  }

  async initialize(config) {
    await super.initialize(config);
    this.chain = config.chain || "arbitrum";
    this.subgraphs = SUBGRAPH_URLS[this.chain] || {};
    console.log(`[Plugin:pool-liquidity] Chain: ${this.chain}, Subgraphs: ${Object.keys(this.subgraphs).length}`);
  }

  /**
   * Fetch all pool & liquidity data
   */
  async fetchData(chain) {
    const targetChain = chain || this.chain;
    this.subgraphs = SUBGRAPH_URLS[targetChain] || {};

    const results = await Promise.allSettled([
      this._fetchSubgraphPools(targetChain),
      this._fetchDefiLlamaTVL(targetChain),
      this._fetchDefiLlamaPools(targetChain),
      this._fetchStablecoinData(),
    ]);

    // Merge results
    if (results[0].status === "fulfilled") {
      this.latestData.pools = results[0].value;
    }
    if (results[1].status === "fulfilled") {
      this.latestData.protocolTVL = results[1].value;
    }
    if (results[2].status === "fulfilled") {
      this.latestData.topPools = results[2].value;
    }
    if (results[3].status === "fulfilled") {
      this.latestData.stablecoins = results[3].value;
    }

    this.latestData.timestamp = Date.now();
    this.lastUpdate = Date.now();
    return this.latestData;
  }

  /**
   * Fetch pool data from The Graph subgraphs
   */
  async _fetchSubgraphPools(chain) {
    return this.fetchWithCache(`subgraph-${chain}`, async () => {
      const pools = {};

      for (const [dex, url] of Object.entries(this.subgraphs)) {
        try {
          const query = `{
            liquidityPools(
              first: 50,
              orderBy: totalValueLockedUSD,
              orderDirection: desc,
              where: { totalValueLockedUSD_gt: "10000" }
            ) {
              id
              name
              totalValueLockedUSD
              cumulativeVolumeUSD
              inputTokens {
                id
                symbol
                decimals
              }
              fees {
                feePercentage
                feeType
              }
              rewardTokenEmissionsUSD
            }
          }`;

          const response = await axios.post(url, { query }, { timeout: 10000 });
          const data = response.data?.data?.liquidityPools || [];

          for (const pool of data) {
            const tvl = parseFloat(pool.totalValueLockedUSD) || 0;
            const volume = parseFloat(pool.cumulativeVolumeUSD) || 0;
            const tokens = pool.inputTokens?.map((t) => t.symbol).join("/") || "Unknown";
            const fee = pool.fees?.[0]?.feePercentage || 0;

            pools[pool.id] = {
              dex,
              name: pool.name || tokens,
              tokens: pool.inputTokens || [],
              tvl,
              volume,
              fee,
              healthScore: this._calculatePoolHealth(tvl, volume, fee),
              source: "theGraph",
            };
          }
        } catch (error) {
          console.warn(`[Plugin:pool-liquidity] Subgraph error for ${dex}: ${error.message}`);
        }
      }

      return pools;
    }, 30000);
  }

  /**
   * Fetch protocol TVL from DeFi Llama
   */
  async _fetchDefiLlamaTVL(chain) {
    return this.fetchWithCache(`tvl-${chain}`, async () => {
      const chainMap = {
        arbitrum: "Arbitrum",
        base: "Base",
        polygon: "Polygon",
        bsc: "BSC",
        avalanche: "Avalanche",
        mantle: "Mantle",
        scroll: "Scroll",
      };

      const llamaChain = chainMap[chain] || chain;
      const response = await axios.get(`${DEFILLAMA_BASE}/v2/chains`, { timeout: 10000 });

      const chainData = response.data?.find((c) => c.name === llamaChain);
      if (!chainData) return {};

      return {
        chain: llamaChain,
        tvl: chainData.tvl || 0,
        tokenSymbol: chainData.tokenSymbol || "",
        chainId: chainData.chainId || 0,
      };
    }, 300000); // 5 min cache
  }

  /**
   * Fetch top pools from DeFi Llama yields API
   */
  async _fetchDefiLlamaPools(chain) {
    return this.fetchWithCache(`pools-${chain}`, async () => {
      const chainMap = {
        arbitrum: "Arbitrum",
        base: "Base",
        polygon: "Polygon",
        bsc: "Binance",
        avalanche: "Avalanche",
        mantle: "Mantle",
        scroll: "Scroll",
      };

      const llamaChain = chainMap[chain] || chain;
      const response = await axios.get(`${DEFILLAMA_YIELDS}/pools`, { timeout: 15000 });
      const allPools = response.data?.data || [];

      // Filter pools for our chain, sort by TVL
      const chainPools = allPools
        .filter((p) => p.chain === llamaChain && p.tvlUsd > 50000)
        .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))
        .slice(0, 100)
        .map((p) => ({
          pool: p.pool,
          project: p.project,
          symbol: p.symbol,
          tvl: p.tvlUsd,
          apy: p.apy,
          apyBase: p.apyBase,
          volumeUsd1d: p.volumeUsd1d || 0,
          volumeUsd7d: p.volumeUsd7d || 0,
          il7d: p.il7d || 0,
          exposure: p.exposure,
          stablecoin: p.stablecoin || false,
        }));

      return chainPools;
    }, 300000); // 5 min cache
  }

  /**
   * Fetch stablecoin data
   */
  async _fetchStablecoinData() {
    return this.fetchWithCache("stablecoins", async () => {
      const response = await axios.get(`${DEFILLAMA_BASE}/stablecoins`, { timeout: 10000 });
      const stables = response.data?.peggedAssets || [];

      return stables.slice(0, 20).map((s) => ({
        name: s.name,
        symbol: s.symbol,
        pegType: s.pegType,
        circulating: s.circulating?.peggedUSD || 0,
        price: s.price || 1,
      }));
    }, 600000); // 10 min cache
  }

  /**
   * Calculate pool health score (0-100)
   */
  _calculatePoolHealth(tvl, volume, fee) {
    let score = 0;

    // TVL score (0-40)
    if (tvl > 10000000) score += 40;
    else if (tvl > 1000000) score += 30;
    else if (tvl > 100000) score += 20;
    else if (tvl > 10000) score += 10;

    // Volume score (0-30): higher volume = more active
    const volumeToTvl = tvl > 0 ? volume / tvl : 0;
    if (volumeToTvl > 10) score += 30;
    else if (volumeToTvl > 1) score += 20;
    else if (volumeToTvl > 0.1) score += 10;

    // Fee score (0-30): reasonable fees are good
    if (fee >= 0.01 && fee <= 0.3) score += 30;
    else if (fee > 0.3 && fee <= 1) score += 20;
    else score += 10;

    return Math.min(100, score);
  }

  /**
   * Get pool health for specific pool address
   */
  getPoolHealth(poolAddress) {
    const pool = this.latestData.pools[poolAddress.toLowerCase()];
    return pool ? pool.healthScore : null;
  }

  /**
   * Get top pools by TVL for a token pair
   */
  getTopPoolsForPair(tokenA, tokenB) {
    const pools = Object.values(this.latestData.pools);
    const isAddress = (s) => s && s.startsWith("0x") && s.length >= 40;
    const isAddrA = isAddress(tokenA);
    const isAddrB = isAddress(tokenB);

    return pools
      .filter((p) => {
        const tokens = p.tokens || [];
        const matchA = isAddrA
          ? tokens.some((t) => (t.id || t.address || "").toLowerCase() === tokenA.toLowerCase())
          : tokens.some((t) => t.symbol?.toUpperCase() === tokenA?.toUpperCase());
        const matchB = isAddrB
          ? tokens.some((t) => (t.id || t.address || "").toLowerCase() === tokenB.toLowerCase())
          : tokens.some((t) => t.symbol?.toUpperCase() === tokenB?.toUpperCase());
        return matchA && matchB;
      })
      .sort((a, b) => b.tvl - a.tvl);
  }

  /**
   * Get liquidity signals
   */
  getLiquiditySignals() {
    const signals = [];
    const topPools = this.latestData.topPools || [];

    for (const pool of topPools.slice(0, 20)) {
      // High volume spike
      if (pool.volumeUsd1d > pool.tvl * 0.5) {
        signals.push({
          type: "HIGH_VOLUME",
          pool: pool.symbol,
          project: pool.project,
          detail: `24h volume ($${Math.round(pool.volumeUsd1d).toLocaleString()}) is ${Math.round((pool.volumeUsd1d / pool.tvl) * 100)}% of TVL`,
          severity: "MEDIUM",
        });
      }

      // High IL warning
      if (pool.il7d && Math.abs(pool.il7d) > 5) {
        signals.push({
          type: "HIGH_IL",
          pool: pool.symbol,
          project: pool.project,
          detail: `7d impermanent loss: ${pool.il7d.toFixed(2)}%`,
          severity: "HIGH",
        });
      }
    }

    return signals;
  }

  /**
   * Return latest cached data
   */
  getLatestData() {
    return this.latestData;
  }
}

module.exports = PoolLiquidityPlugin;
