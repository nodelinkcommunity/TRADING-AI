/**
 * FLASHLOAN-AI: Historical Backtester
 * Simulates bot strategy on past on-chain data from Dune/The Graph.
 * Outputs: PnL curve, win rate, Sharpe ratio, max drawdown.
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ss = require("simple-statistics");

class HistoricalBacktester {
  constructor() {
    this.resultsPath = path.join(__dirname, "..", "..", "server", "data", "backtest-results");
    this.isRunning = false;
  }

  /**
   * Run historical backtest
   * @param {object} params - {
   *   chain, daysBack, minProfitBps, maxSlippageBps,
   *   flashAmount, strategy, useLocalData
   * }
   */
  async run(params = {}) {
    if (this.isRunning) {
      return { error: "Backtest already running" };
    }

    this.isRunning = true;

    try {
      const {
        chain = "arbitrum",
        daysBack = 7,
        minProfitBps = 30,
        maxSlippageBps = 50,
        flashAmount = 10000,
        strategy = "dexArbitrage",
        useLocalData = true,
      } = params;

      console.log(`[Backtester] Starting ${daysBack}d backtest on ${chain} (${strategy})`);

      // Fetch historical data
      let historicalSwaps;
      if (useLocalData) {
        historicalSwaps = this._generateSimulatedData(chain, daysBack);
      } else {
        historicalSwaps = await this._fetchHistoricalData(chain, daysBack);
      }

      if (!historicalSwaps || historicalSwaps.length === 0) {
        return { error: "No historical data available" };
      }

      // Simulate trading
      const result = this._simulate(historicalSwaps, {
        minProfitBps,
        maxSlippageBps,
        flashAmount,
        strategy,
      });

      // Calculate advanced metrics
      result.metrics = this._calculateMetrics(result.trades);
      result.params = { chain, daysBack, minProfitBps, maxSlippageBps, flashAmount, strategy };
      result.timestamp = Date.now();
      result.id = `bt-${Date.now()}`;

      // Distinguish data source in results
      const simulatedCount = historicalSwaps.filter(s => s.simulated).length;
      const estimatedCount = historicalSwaps.filter(s => s.estimated).length;
      result.dataSource = {
        type: useLocalData ? "simulated" : "theGraph",
        label: useLocalData
          ? "SIMULATED - randomly generated data, not real historical prices"
          : "The Graph - real on-chain swap data",
        totalDataPoints: historicalSwaps.length,
        simulatedDataPoints: simulatedCount,
        estimatedPriceDiffs: estimatedCount,
      };

      // Save
      this._saveResult(result);

      console.log(`[Backtester] Complete: ${result.trades.length} trades, win rate ${(result.metrics.winRate * 100).toFixed(1)}% [data: ${result.dataSource.label}]`);

      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Generate simulated historical data from local trade history
   */
  _generateSimulatedData(chain, daysBack) {
    const swaps = [];
    const now = Date.now();
    const start = now - daysBack * 86400000;

    // Load local trades if available
    const tradesPath = path.join(__dirname, "..", "..", "server", "data", "trades.json");
    let localTrades = [];
    try {
      if (fs.existsSync(tradesPath)) {
        localTrades = JSON.parse(fs.readFileSync(tradesPath, "utf8"));
      }
    } catch {}

    // Generate synthetic data based on local patterns or reasonable defaults
    const hoursCount = daysBack * 24;
    for (let h = 0; h < hoursCount; h++) {
      const timestamp = start + h * 3600000;
      const hour = new Date(timestamp).getUTCHours();

      // Simulate price differences between DEXes
      // More opportunities during active hours (8-16 UTC)
      const isActiveHour = hour >= 8 && hour <= 16;
      const oppCount = isActiveHour ? Math.floor(Math.random() * 5) + 1 : Math.floor(Math.random() * 2);

      for (let i = 0; i < oppCount; i++) {
        const priceDiffBps = Math.floor(Math.random() * 100) + 5; // 5-105 bps
        const gasGwei = 0.1 + Math.random() * 2; // 0.1-2.1 Gwei

        swaps.push({
          timestamp,
          hour,
          priceDiffBps,
          gasGwei,
          volume: 10000 + Math.random() * 90000, // $10K-$100K
          dex1: isActiveHour ? "uniswapV3" : "sushiswap",
          dex2: isActiveHour ? "sushiswap" : "uniswapV3",
          pool: `WETH-USDC-${Math.floor(Math.random() * 5)}`,
          simulated: true, // Flag: this is randomly generated data, NOT real historical
        });
      }
    }

    return swaps;
  }

  /**
   * Fetch historical data from The Graph
   */
  async _fetchHistoricalData(chain, daysBack) {
    // Placeholder: in production, query The Graph subgraph for historical swaps
    console.log(`[Backtester] Fetching ${daysBack}d data from The Graph for ${chain}...`);

    try {
      // Example: query Uniswap V3 swap events
      const subgraphs = {
        arbitrum: "https://api.thegraph.com/subgraphs/name/messari/uniswap-v3-arbitrum",
        base: "https://api.thegraph.com/subgraphs/name/messari/uniswap-v3-base",
        polygon: "https://api.thegraph.com/subgraphs/name/messari/uniswap-v3-polygon",
      };

      const url = subgraphs[chain];
      if (!url) return this._generateSimulatedData(chain, daysBack);

      const since = Math.floor((Date.now() - daysBack * 86400000) / 1000);

      const query = `{
        swaps(
          first: 1000,
          orderBy: timestamp,
          orderDirection: desc,
          where: { timestamp_gte: "${since}" }
        ) {
          timestamp
          amountUSD
          pool {
            token0 { symbol }
            token1 { symbol }
            feeTier
          }
        }
      }`;

      const response = await axios.post(url, { query }, { timeout: 15000 });
      const rawSwaps = response.data?.data?.swaps || [];

      return rawSwaps.map((s) => {
        const volume = parseFloat(s.amountUSD) || 10000;
        // Estimate price diff from fee tier if available (real swap data doesn't include cross-DEX diff)
        const feeTierBps = s.pool?.feeTier ? parseInt(s.pool.feeTier) / 100 : null;
        const hasPriceDiff = feeTierBps !== null;
        return {
          timestamp: parseInt(s.timestamp) * 1000,
          hour: new Date(parseInt(s.timestamp) * 1000).getUTCHours(),
          priceDiffBps: hasPriceDiff ? Math.round(feeTierBps * 0.8) : 30, // Derive from fee tier or use conservative default
          estimated: !hasPriceDiff, // Flag when priceDiffBps is not from real cross-DEX data
          gasGwei: 0.1 + Math.random() * 1,
          volume,
          pool: `${s.pool?.token0?.symbol}-${s.pool?.token1?.symbol}`,
          dex1: "uniswapV3",
          dex2: "sushiswap",
          simulated: false, // Real data from The Graph
        };
      });
    } catch (error) {
      console.warn(`[Backtester] Fetch error: ${error.message}, using simulated data`);
      return this._generateSimulatedData(chain, daysBack);
    }
  }

  /**
   * Simulate trading on historical data
   */
  _simulate(swaps, params) {
    const trades = [];
    let balance = 0;
    let peakBalance = 0;
    let maxDrawdown = 0;
    const pnlCurve = [];

    for (const swap of swaps) {
      // Would this pass our filter?
      if (swap.priceDiffBps < params.minProfitBps) continue;

      // Estimate gas cost in USD
      const gasCostUsd = swap.gasGwei * 0.000000001 * 300000 * 2000; // gas * gasPrice * gasLimit * ethPrice (rough)

      // Estimate profit
      const grossProfit = (params.flashAmount * swap.priceDiffBps) / 10000;
      const flashFee = params.flashAmount * 0.0005; // 0.05% flash loan fee
      const netProfit = grossProfit - flashFee - gasCostUsd;

      // Simulate slippage (random 0-maxSlippage)
      const slippage = Math.random() * params.maxSlippageBps / 10000;
      const afterSlippage = netProfit * (1 - slippage);

      // Simulate execution success (85% success rate)
      const success = Math.random() < 0.85 && afterSlippage > 0;

      const trade = {
        timestamp: swap.timestamp,
        pool: swap.pool,
        dex1: swap.dex1,
        dex2: swap.dex2,
        priceDiffBps: swap.priceDiffBps,
        grossProfit,
        gasCost: gasCostUsd,
        flashFee,
        netProfit: success ? afterSlippage : -gasCostUsd,
        success,
      };

      trades.push(trade);
      balance += trade.netProfit;

      if (balance > peakBalance) peakBalance = balance;
      const drawdown = peakBalance - balance;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      pnlCurve.push({ timestamp: swap.timestamp, balance, drawdown });
    }

    return {
      trades,
      summary: {
        totalTrades: trades.length,
        balance,
        peakBalance,
        maxDrawdown,
      },
      pnlCurve,
    };
  }

  /**
   * Calculate advanced metrics
   */
  _calculateMetrics(trades) {
    if (trades.length === 0) {
      return { winRate: 0, sharpeRatio: 0, maxDrawdown: 0, avgProfit: 0 };
    }

    const profits = trades.map((t) => t.netProfit);
    const wins = trades.filter((t) => t.success);
    const losses = trades.filter((t) => !t.success);

    const totalProfit = ss.sum(profits);
    const avgProfit = ss.mean(profits);
    const stdDev = profits.length >= 2 ? ss.standardDeviation(profits) : 0;

    // Sharpe ratio (annualized, assuming daily)
    const sharpeRatio = stdDev > 0 ? (avgProfit / stdDev) * Math.sqrt(365) : 0;

    // Profit factor
    const grossProfit = ss.sum(wins.map((t) => t.netProfit));
    const grossLoss = Math.abs(ss.sum(losses.map((t) => t.netProfit)));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

    // Max consecutive wins/losses
    let maxConsecWins = 0, maxConsecLosses = 0, currWins = 0, currLosses = 0;
    for (const t of trades) {
      if (t.success) {
        currWins++;
        currLosses = 0;
        if (currWins > maxConsecWins) maxConsecWins = currWins;
      } else {
        currLosses++;
        currWins = 0;
        if (currLosses > maxConsecLosses) maxConsecLosses = currLosses;
      }
    }

    return {
      winRate: trades.length > 0 ? wins.length / trades.length : 0,
      totalProfit,
      avgProfit,
      medianProfit: ss.median(profits),
      stdDev,
      sharpeRatio,
      profitFactor,
      maxConsecWins,
      maxConsecLosses,
      totalWins: wins.length,
      totalLosses: losses.length,
      avgWin: wins.length > 0 ? ss.mean(wins.map((t) => t.netProfit)) : 0,
      avgLoss: losses.length > 0 ? ss.mean(losses.map((t) => t.netProfit)) : 0,
    };
  }

  _saveResult(result) {
    try {
      if (!fs.existsSync(this.resultsPath)) {
        fs.mkdirSync(this.resultsPath, { recursive: true });
      }
      const filename = `historical-${result.id}.json`;
      fs.writeFileSync(
        path.join(this.resultsPath, filename),
        JSON.stringify(result, null, 2),
        "utf8"
      );
    } catch (error) {
      console.warn(`[Backtester] Save error: ${error.message}`);
    }
  }

  /**
   * List past backtest results
   */
  listResults() {
    try {
      if (!fs.existsSync(this.resultsPath)) return [];
      return fs.readdirSync(this.resultsPath)
        .filter((f) => f.startsWith("historical-") && f.endsWith(".json"))
        .sort()
        .slice(-20)
        .map((f) => {
          const data = JSON.parse(fs.readFileSync(path.join(this.resultsPath, f), "utf8"));
          return {
            id: data.id,
            params: data.params,
            metrics: data.metrics,
            timestamp: data.timestamp,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Get a specific backtest result
   */
  getResult(id) {
    try {
      const filename = `historical-${id}.json`;
      const filepath = path.join(this.resultsPath, filename);
      if (!fs.existsSync(filepath)) return null;
      return JSON.parse(fs.readFileSync(filepath, "utf8"));
    } catch {
      return null;
    }
  }
}

module.exports = HistoricalBacktester;
