/**
 * FLASHLOAN-AI: Historical Patterns Plugin
 * Source: Dune Analytics API + local trade history
 * Provides historical arbitrage patterns, best hours, best pools, win rates.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ss = require("simple-statistics");
const BasePlugin = require("./base-plugin");

// Dune Analytics API
const DUNE_BASE = "https://api.dune.com/api/v1";

// Pre-built Dune query IDs for arbitrage analysis
const DUNE_QUERIES = {
  // Popular community queries (public, free)
  arbTradesUniswap: 3374262,  // Uniswap arbitrage trades
  flashLoanUsage: 3105693,    // Flash loan usage patterns
  dexVolume: 2803476,         // DEX volume by chain
};

class HistoricalPatternsPlugin extends BasePlugin {
  constructor() {
    super("historical-patterns", "A");
    this._cacheTTL = 3600000; // 1 hour cache
    this.latestData = {
      hourlyPatterns: {},
      poolPatterns: {},
      dexPatterns: {},
      optimalParams: {},
      localStats: {},
      timestamp: 0,
    };
    this.tradesPath = path.join(__dirname, "..", "..", "server", "data", "trades.json");
    this.opportunitiesPath = path.join(__dirname, "..", "..", "server", "data", "opportunities.json");
  }

  async initialize(config) {
    await super.initialize(config);
    this.apiKey = config.apiKey || process.env.DUNE_API_KEY || "";
    this.chain = config.chain || "arbitrum";
    this.hasDuneKey = !!this.apiKey;

    if (!this.hasDuneKey) {
      console.log("[Plugin:historical-patterns] No Dune API key — using local trade history only");
    }

    // Ensure opportunities file exists
    if (!fs.existsSync(this.opportunitiesPath)) {
      fs.writeFileSync(this.opportunitiesPath, "[]", "utf8");
    }
  }

  /**
   * Fetch all historical pattern data
   */
  async fetchData(chain) {
    const results = await Promise.allSettled([
      this._analyzeLocalTrades(),
      this._analyzeStoredOpportunities(),
      this.hasDuneKey ? this._fetchDuneData(chain) : Promise.resolve(null),
    ]);

    if (results[0].status === "fulfilled" && results[0].value) {
      Object.assign(this.latestData, results[0].value);
    }
    if (results[1].status === "fulfilled" && results[1].value) {
      this.latestData.missedOpportunities = results[1].value;
    }
    if (results[2].status === "fulfilled" && results[2].value) {
      this.latestData.duneData = results[2].value;
    }

    // Calculate optimal parameters
    this.latestData.optimalParams = this._calculateOptimalParams();
    this.latestData.timestamp = Date.now();
    this.lastUpdate = Date.now();
    return this.latestData;
  }

  /**
   * Analyze local trade history for patterns
   */
  async _analyzeLocalTrades() {
    try {
      if (!fs.existsSync(this.tradesPath)) return null;

      const raw = fs.readFileSync(this.tradesPath, "utf8");
      const trades = JSON.parse(raw);
      if (!Array.isArray(trades) || trades.length === 0) return null;

      // Filter real trades (not paper, not test)
      const realTrades = trades.filter((t) => !t.paper && !t.test);
      const paperTrades = trades.filter((t) => t.paper && !t.test);
      const allTrades = [...realTrades, ...paperTrades]; // analyze both

      // Hourly patterns
      const hourlyPatterns = {};
      for (let h = 0; h < 24; h++) {
        hourlyPatterns[h] = { trades: 0, wins: 0, totalProfit: 0, avgProfit: 0 };
      }

      // DEX patterns
      const dexPatterns = {};

      // Pool/pair patterns
      const poolPatterns = {};

      for (const trade of allTrades) {
        const date = new Date(trade.timestamp || trade.time || Date.now());
        const hour = date.getUTCHours();

        // Hourly
        hourlyPatterns[hour].trades++;
        const profit = parseFloat(trade.profit || trade.profitUsd || 0);
        if (profit > 0) {
          hourlyPatterns[hour].wins++;
          hourlyPatterns[hour].totalProfit += profit;
        }

        // DEX
        const dex = trade.dex || trade.buyDex || "unknown";
        if (!dexPatterns[dex]) {
          dexPatterns[dex] = { trades: 0, wins: 0, totalProfit: 0, failures: 0 };
        }
        dexPatterns[dex].trades++;
        if (trade.success !== false && profit >= 0) dexPatterns[dex].wins++;
        else dexPatterns[dex].failures++;
        dexPatterns[dex].totalProfit += profit;

        // Pool/pair
        const pair = trade.pair || trade.tokenPair || `${trade.tokenIn || "?"}-${trade.tokenOut || "?"}`;
        if (!poolPatterns[pair]) {
          poolPatterns[pair] = { trades: 0, wins: 0, totalProfit: 0, avgProfit: 0 };
        }
        poolPatterns[pair].trades++;
        if (profit > 0) poolPatterns[pair].wins++;
        poolPatterns[pair].totalProfit += profit;
      }

      // Calculate averages and win rates
      for (const h of Object.keys(hourlyPatterns)) {
        const hp = hourlyPatterns[h];
        hp.winRate = hp.trades > 0 ? hp.wins / hp.trades : 0;
        hp.avgProfit = hp.wins > 0 ? hp.totalProfit / hp.wins : 0;
      }
      for (const d of Object.keys(dexPatterns)) {
        const dp = dexPatterns[d];
        dp.winRate = dp.trades > 0 ? dp.wins / dp.trades : 0;
        dp.avgProfit = dp.wins > 0 ? dp.totalProfit / dp.wins : 0;
      }
      for (const p of Object.keys(poolPatterns)) {
        const pp = poolPatterns[p];
        pp.winRate = pp.trades > 0 ? pp.wins / pp.trades : 0;
        pp.avgProfit = pp.wins > 0 ? pp.totalProfit / pp.wins : 0;
      }

      // Find best hours
      const bestHours = Object.entries(hourlyPatterns)
        .filter(([, v]) => v.trades >= 3)
        .sort((a, b) => b[1].winRate - a[1].winRate)
        .slice(0, 5)
        .map(([hour, data]) => ({ hour: parseInt(hour), ...data }));

      // Find best pairs
      const bestPairs = Object.entries(poolPatterns)
        .filter(([, v]) => v.trades >= 3)
        .sort((a, b) => b[1].totalProfit - a[1].totalProfit)
        .slice(0, 10)
        .map(([pair, data]) => ({ pair, ...data }));

      return {
        hourlyPatterns,
        dexPatterns,
        poolPatterns,
        bestHours,
        bestPairs,
        localStats: {
          totalTrades: allTrades.length,
          realTrades: realTrades.length,
          paperTrades: paperTrades.length,
          overallWinRate: allTrades.length > 0
            ? allTrades.filter((t) => parseFloat(t.profit || 0) > 0).length / allTrades.length
            : 0,
        },
      };
    } catch (error) {
      console.warn(`[Plugin:historical-patterns] Local analysis error: ${error.message}`);
      return null;
    }
  }

  /**
   * Analyze stored opportunities (both executed and missed)
   */
  async _analyzeStoredOpportunities() {
    try {
      if (!fs.existsSync(this.opportunitiesPath)) return null;

      const raw = fs.readFileSync(this.opportunitiesPath, "utf8");
      const opportunities = JSON.parse(raw);
      if (!Array.isArray(opportunities) || opportunities.length === 0) return null;

      const executed = opportunities.filter((o) => o.executed);
      const skipped = opportunities.filter((o) => !o.executed);

      // Find "missed" profitable opportunities
      const missedProfitable = skipped.filter(
        (o) => o.estimatedProfitBps && o.estimatedProfitBps > 30
      );

      return {
        total: opportunities.length,
        executed: executed.length,
        skipped: skipped.length,
        missedProfitable: missedProfitable.length,
        topMissed: missedProfitable
          .sort((a, b) => b.estimatedProfitBps - a.estimatedProfitBps)
          .slice(0, 5),
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Fetch data from Dune Analytics API
   */
  async _fetchDuneData(chain) {
    if (!this.hasDuneKey) return null;

    return this.fetchWithCache(`dune-${chain}`, async () => {
      const results = {};

      for (const [name, queryId] of Object.entries(DUNE_QUERIES)) {
        try {
          const response = await axios.get(
            `${DUNE_BASE}/query/${queryId}/results`,
            {
              headers: { "X-Dune-API-Key": this.apiKey },
              timeout: 15000,
            }
          );
          results[name] = response.data?.result?.rows || [];
        } catch (error) {
          console.warn(`[Plugin:historical-patterns] Dune query ${name} failed: ${error.message}`);
        }
      }

      return results;
    }, 3600000); // 1 hour cache
  }

  /**
   * Calculate optimal parameters from historical data
   */
  _calculateOptimalParams() {
    const patterns = this.latestData;
    const params = {
      suggestedMinProfitBps: 30,
      suggestedScanInterval: 3000,
      bestHoursUTC: [],
      worstHoursUTC: [],
      bestDex: null,
      confidence: 0,
    };

    // Best hours
    if (patterns.bestHours && patterns.bestHours.length > 0) {
      params.bestHoursUTC = patterns.bestHours.map((h) => h.hour);
    }

    // Best DEX
    if (patterns.dexPatterns) {
      const dexEntries = Object.entries(patterns.dexPatterns)
        .filter(([, v]) => v.trades >= 5)
        .sort((a, b) => b[1].winRate - a[1].winRate);

      if (dexEntries.length > 0) {
        params.bestDex = { name: dexEntries[0][0], ...dexEntries[0][1] };
      }
    }

    // Worst hours (avoid)
    if (patterns.hourlyPatterns) {
      params.worstHoursUTC = Object.entries(patterns.hourlyPatterns)
        .filter(([, v]) => v.trades >= 3 && v.winRate < 0.3)
        .map(([h]) => parseInt(h));
    }

    // Confidence based on data volume
    const totalTrades = patterns.localStats?.totalTrades || 0;
    if (totalTrades >= 100) params.confidence = 0.9;
    else if (totalTrades >= 50) params.confidence = 0.7;
    else if (totalTrades >= 20) params.confidence = 0.5;
    else if (totalTrades >= 5) params.confidence = 0.3;
    else params.confidence = 0.1;

    return params;
  }

  /**
   * Store a scanned opportunity for future analysis
   * @param {object} opportunity - The scanned opportunity
   * @param {boolean} executed - Whether it was executed
   * @param {object} result - Execution result (if executed)
   */
  storeOpportunity(opportunity, executed = false, result = null) {
    try {
      let opportunities = [];
      if (fs.existsSync(this.opportunitiesPath)) {
        opportunities = JSON.parse(fs.readFileSync(this.opportunitiesPath, "utf8"));
      }

      opportunities.push({
        ...opportunity,
        executed,
        result,
        storedAt: Date.now(),
      });

      // Keep max 10000
      if (opportunities.length > 10000) {
        opportunities = opportunities.slice(-10000);
      }

      fs.writeFileSync(this.opportunitiesPath, JSON.stringify(opportunities, null, 2), "utf8");
    } catch (error) {
      console.warn(`[Plugin:historical-patterns] Store opportunity error: ${error.message}`);
    }
  }

  /**
   * Get time-based recommendation
   */
  getTimeRecommendation() {
    const hour = new Date().getUTCHours();
    const hourData = this.latestData.hourlyPatterns?.[hour];

    if (!hourData || hourData.trades < 3) {
      return { recommendation: "NEUTRAL", reason: "Insufficient data for this hour", confidence: 0.1 };
    }

    if (hourData.winRate >= 0.7) {
      return { recommendation: "AGGRESSIVE", reason: `Hour ${hour} UTC has ${(hourData.winRate * 100).toFixed(0)}% win rate`, confidence: 0.8 };
    } else if (hourData.winRate >= 0.5) {
      return { recommendation: "NORMAL", reason: `Hour ${hour} UTC has ${(hourData.winRate * 100).toFixed(0)}% win rate`, confidence: 0.6 };
    } else {
      return { recommendation: "CONSERVATIVE", reason: `Hour ${hour} UTC has only ${(hourData.winRate * 100).toFixed(0)}% win rate`, confidence: 0.7 };
    }
  }

  getLatestData() {
    return this.latestData;
  }
}

module.exports = HistoricalPatternsPlugin;
