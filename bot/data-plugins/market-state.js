/**
 * FLASHLOAN-AI: MarketState Aggregator
 * Central state object combining all plugin data into a single source of truth
 * for the AI Decision Engine.
 */

class MarketState {
  constructor() {
    this.state = {
      timestamp: 0,
      chain: "",

      // Pool & Liquidity data
      pools: {
        topPools: [],
        poolHealth: {},
        protocolTVL: {},
        liquiditySignals: [],
        stablecoins: {},
      },

      // Market conditions
      market: {
        regime: "UNKNOWN",
        volatility: 0,
        trend: 0,
        gasPrice: 0,
        gasTrend: "STABLE",
        confidence: 0,
      },

      // Whale activity
      whales: {
        alertLevel: "NONE",
        impactEstimate: "NONE",
        buyPressure: 0,
        sellPressure: 0,
        totalVolumeHour: 0,
        topWhales: [],
        accumulationSignals: [],
        distributionSignals: [],
      },

      // Historical patterns
      historical: {
        bestHours: [],
        worstHours: [],
        bestPairs: [],
        bestDex: null,
        optimalParams: {},
        timeRecommendation: null,
        confidence: 0,
      },

      // Aggregated signals
      signals: [],
    };
  }

  /**
   * Update MarketState from all plugin data
   * @param {object} pluginData - Data from PluginManager.getAllData()
   * @param {object} aiModules - Data from existing AI modules (regime, gas, etc.)
   */
  update(pluginData, aiModules = {}) {
    this.state.timestamp = Date.now();

    // Pool & Liquidity
    const poolData = pluginData["pool-liquidity"];
    if (poolData) {
      this.state.pools = {
        topPools: poolData.topPools || [],
        poolHealth: poolData.pools || {},
        protocolTVL: poolData.protocolTVL || {},
        liquiditySignals: this._extractLiquiditySignals(poolData),
        stablecoins: poolData.stablecoins || {},
      };
    }

    // Market conditions (from existing AI modules)
    if (aiModules.regime) {
      this.state.market = {
        regime: aiModules.regime.regime || "UNKNOWN",
        volatility: aiModules.regime.volatility || 0,
        trend: aiModules.regime.trend || 0,
        confidence: aiModules.regime.confidence || 0,
        bestStrategies: aiModules.regime.bestStrategies || [],
        riskLevel: aiModules.regime.riskLevel || { level: "MEDIUM" },
      };
    }

    if (aiModules.gas) {
      this.state.market.gasPrice = aiModules.gas.current || 0;
      this.state.market.gasTrend = aiModules.gas.trend || "STABLE";
      this.state.market.gasRecommendation = aiModules.gas.recommendation || "NORMAL";
    }

    // Whale activity
    const whaleData = pluginData["whale-enhanced"];
    if (whaleData) {
      this.state.whales = {
        alertLevel: whaleData.alertLevel || "NONE",
        impactEstimate: whaleData.impactEstimate || "NONE",
        buyPressure: whaleData.buyPressure || 0,
        sellPressure: whaleData.sellPressure || 0,
        buyVolume: whaleData.buyVolume || 0,
        sellVolume: whaleData.sellVolume || 0,
        totalVolumeHour: whaleData.totalVolumeHour || 0,
        topWhales: whaleData.topWhales || [],
        accumulationSignals: whaleData.accumulationSignals || [],
        distributionSignals: whaleData.distributionSignals || [],
      };
    }

    // Historical patterns
    const histData = pluginData["historical-patterns"];
    if (histData) {
      this.state.historical = {
        bestHours: histData.bestHours || [],
        worstHours: histData.optimalParams?.worstHoursUTC || [],
        bestPairs: histData.bestPairs || [],
        bestDex: histData.optimalParams?.bestDex || null,
        optimalParams: histData.optimalParams || {},
        timeRecommendation: histData.timeRecommendation || null,
        localStats: histData.localStats || {},
        confidence: histData.optimalParams?.confidence || 0,
      };
    }

    // Generate aggregated signals
    this.state.signals = this._generateSignals();
  }

  /**
   * Extract liquidity signals from pool data
   */
  _extractLiquiditySignals(poolData) {
    const signals = [];

    // From top pools: check for anomalies
    if (poolData.topPools) {
      for (const pool of poolData.topPools.slice(0, 20)) {
        // High volume relative to TVL
        if (pool.volumeUsd1d > pool.tvl * 0.5) {
          signals.push({
            type: "HIGH_VOLUME_RATIO",
            pool: pool.symbol,
            project: pool.project,
            ratio: pool.volumeUsd1d / pool.tvl,
            severity: pool.volumeUsd1d > pool.tvl ? "HIGH" : "MEDIUM",
          });
        }

        // Very high APY might indicate risk or opportunity
        if (pool.apy > 100) {
          signals.push({
            type: "HIGH_APY",
            pool: pool.symbol,
            project: pool.project,
            apy: pool.apy,
            severity: pool.apy > 500 ? "HIGH" : "MEDIUM",
          });
        }
      }
    }

    return signals;
  }

  /**
   * Generate aggregated signals from all data sources
   */
  _generateSignals() {
    const signals = [];
    const now = Date.now();

    // Signal 1: Whale activity surge
    if (this.state.whales.alertLevel === "HIGH" || this.state.whales.alertLevel === "EXTREME") {
      signals.push({
        type: "WHALE_SURGE",
        severity: this.state.whales.alertLevel,
        message: `Whale activity ${this.state.whales.alertLevel}: ${this.state.whales.totalVolumeHour.toFixed(0)} ETH volume in last hour`,
        actionable: true,
        suggestion: this.state.whales.impactEstimate.includes("BUY")
          ? "Whale buy pressure detected — favorable for arbitrage"
          : "Whale sell pressure — exercise caution",
        timestamp: now,
      });
    }

    // Signal 2: Accumulation/Distribution pattern
    if (this.state.whales.accumulationSignals.length > 0) {
      signals.push({
        type: "WHALE_ACCUMULATION",
        severity: "MEDIUM",
        message: `${this.state.whales.accumulationSignals.length} whales accumulating`,
        actionable: true,
        suggestion: "Smart money buying — consider more aggressive parameters",
        timestamp: now,
      });
    }
    if (this.state.whales.distributionSignals.length > 0) {
      signals.push({
        type: "WHALE_DISTRIBUTION",
        severity: "HIGH",
        message: `${this.state.whales.distributionSignals.length} whales distributing`,
        actionable: true,
        suggestion: "Smart money selling — tighten risk parameters",
        timestamp: now,
      });
    }

    // Signal 3: Market regime change
    if (this.state.market.regime.includes("VOLATILE")) {
      signals.push({
        type: "VOLATILE_MARKET",
        severity: "MEDIUM",
        message: `Market is ${this.state.market.regime} (volatility: ${(this.state.market.volatility * 100).toFixed(1)}%)`,
        actionable: true,
        suggestion: "Volatile markets create more arbitrage opportunities but higher risk",
        timestamp: now,
      });
    }

    // Signal 4: Gas conditions
    if (this.state.market.gasRecommendation === "GOOD_TIME") {
      signals.push({
        type: "LOW_GAS",
        severity: "LOW",
        message: "Gas prices below average — good time for execution",
        actionable: true,
        suggestion: "Consider increasing scan frequency or lowering min profit threshold",
        timestamp: now,
      });
    } else if (this.state.market.gasRecommendation === "WAIT") {
      signals.push({
        type: "HIGH_GAS",
        severity: "MEDIUM",
        message: "Gas prices elevated — consider waiting",
        actionable: true,
        suggestion: "Increase min profit threshold to compensate for gas costs",
        timestamp: now,
      });
    }

    // Signal 5: Historical time recommendation
    const timeRec = this.state.historical.timeRecommendation;
    if (timeRec && timeRec.recommendation === "AGGRESSIVE") {
      signals.push({
        type: "OPTIMAL_HOUR",
        severity: "LOW",
        message: timeRec.reason,
        actionable: true,
        suggestion: "Historical data shows high win rate — consider increasing positions",
        timestamp: now,
      });
    } else if (timeRec && timeRec.recommendation === "CONSERVATIVE") {
      signals.push({
        type: "SUBOPTIMAL_HOUR",
        severity: "LOW",
        message: timeRec.reason,
        actionable: true,
        suggestion: "Historical data shows low win rate — reduce position sizes",
        timestamp: now,
      });
    }

    // Signal 6: Liquidity signals from pools
    for (const liq of this.state.pools.liquiditySignals.slice(0, 3)) {
      signals.push({
        type: "LIQUIDITY_ANOMALY",
        severity: liq.severity,
        message: `${liq.pool} (${liq.project}): ${liq.type === "HIGH_VOLUME_RATIO" ? "Volume spike" : "High APY"}`,
        actionable: liq.type === "HIGH_VOLUME_RATIO",
        suggestion: "High volume may indicate price dislocations — check for arbitrage",
        timestamp: now,
      });
    }

    return signals.sort((a, b) => {
      const sevOrder = { HIGH: 0, EXTREME: 0, MEDIUM: 1, LOW: 2 };
      return (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2);
    });
  }

  /**
   * Get the current market state
   */
  getState() {
    return this.state;
  }

  /**
   * Get actionable signals only
   */
  getActionableSignals() {
    return this.state.signals.filter((s) => s.actionable);
  }

  /**
   * Get pool health score for a specific pool
   */
  getPoolHealth(poolAddress) {
    const pool = this.state.pools.poolHealth[poolAddress?.toLowerCase()];
    return pool?.healthScore || null;
  }

  /**
   * Get overall market sentiment (-1 to 1)
   */
  getMarketSentiment() {
    let sentiment = 0;
    let factors = 0;

    // Whale pressure
    if (this.state.whales.buyVolume > 0 || this.state.whales.sellVolume > 0) {
      const total = this.state.whales.buyVolume + this.state.whales.sellVolume;
      if (total > 0) {
        sentiment += (this.state.whales.buyVolume - this.state.whales.sellVolume) / total;
        factors++;
      }
    }

    // Market trend
    if (this.state.market.trend) {
      sentiment += this.state.market.trend;
      factors++;
    }

    // Accumulation vs distribution
    const accCount = this.state.whales.accumulationSignals.length;
    const distCount = this.state.whales.distributionSignals.length;
    if (accCount + distCount > 0) {
      sentiment += (accCount - distCount) / (accCount + distCount);
      factors++;
    }

    return factors > 0 ? sentiment / factors : 0;
  }

  /**
   * Quick summary for logging
   */
  getSummary() {
    return {
      regime: this.state.market.regime,
      gasPrice: this.state.market.gasPrice,
      whaleAlert: this.state.whales.alertLevel,
      sentiment: this.getMarketSentiment().toFixed(2),
      signals: this.state.signals.length,
      actionableSignals: this.getActionableSignals().length,
    };
  }
}

module.exports = MarketState;
