/**
 * FLASHLOAN-AI: Market Analyzer
 * Market regime detection and strategy recommendation
 * Tracks volatility, trend, and volume to classify market conditions
 */

class MarketAnalyzer {
  constructor() {
    this.priceHistory = {};    // token -> [{price, timestamp}]
    this.volatilityWindow = 20;
    this.regimeHistory = [];
    this.maxPriceHistory = 1000;
    this.maxRegimeHistory = 100;
  }

  /**
   * Add a price data point for a token
   */
  addPrice(token, price, timestamp) {
    try {
      if (!token || price === undefined || price === null) return;

      const priceNum = typeof price === "bigint" ? Number(price) : Number(price);
      if (isNaN(priceNum) || priceNum <= 0) return;

      if (!this.priceHistory[token]) this.priceHistory[token] = [];

      this.priceHistory[token].push({
        price: priceNum,
        timestamp: timestamp || Date.now(),
      });

      // Keep last 1000 entries per token
      if (this.priceHistory[token].length > this.maxPriceHistory) {
        this.priceHistory[token].shift();
      }
    } catch (error) {
      // Silently ignore
    }
  }

  /**
   * Detect current market regime
   */
  detectRegime() {
    try {
      const volatility = this._calculateVolatility();
      const trend = this._calculateTrend();
      const volume = this._estimateVolume();

      let regime;
      if (volatility > 0.05) {
        regime = trend > 0 ? "VOLATILE_UP" : "VOLATILE_DOWN";
      } else if (volatility > 0.02) {
        regime = trend > 0 ? "TRENDING_UP" : "TRENDING_DOWN";
      } else {
        regime = "SIDEWAYS";
      }

      // Calculate confidence based on data availability
      const tokenCount = Object.keys(this.priceHistory).length;
      const totalSamples = Object.values(this.priceHistory).reduce(
        (sum, arr) => sum + arr.length, 0
      );
      let confidence = Math.min(100, Math.round((totalSamples / 50) * 100));
      if (tokenCount === 0) confidence = 0;

      const result = {
        regime,
        volatility: Math.round(volatility * 10000) / 10000,
        trend: Math.round(trend * 10000) / 10000,
        volume,
        confidence,
        bestStrategies: this._recommendStrategies(regime),
        riskLevel: this._assessRisk(volatility, trend),
        timestamp: Date.now(),
      };

      // Record regime history
      this.regimeHistory.push({ regime, timestamp: Date.now() });
      if (this.regimeHistory.length > this.maxRegimeHistory) {
        this.regimeHistory.shift();
      }

      return result;
    } catch (error) {
      return {
        regime: "UNKNOWN",
        volatility: 0,
        trend: 0,
        volume: 0,
        confidence: 0,
        bestStrategies: ["dexArbitrage"],
        riskLevel: { level: "UNKNOWN", score: 50, action: "CAUTIOUS" },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Recommend which strategies to use based on regime
   */
  _recommendStrategies(regime) {
    const strategies = {
      "VOLATILE_UP": ["dexArbitrage", "triangular", "liquidation"],
      "VOLATILE_DOWN": ["liquidation", "stablecoin", "dexArbitrage"],
      "TRENDING_UP": ["dexArbitrage", "newPool"],
      "TRENDING_DOWN": ["liquidation", "stablecoin"],
      "SIDEWAYS": ["stablecoin", "yieldRebalance"],
    };
    return strategies[regime] || ["dexArbitrage"];
  }

  /**
   * Risk assessment based on volatility and trend
   */
  _assessRisk(volatility, trend) {
    if (volatility > 0.08) {
      return { level: "EXTREME", score: 95, action: "REDUCE_EXPOSURE" };
    }
    if (volatility > 0.05) {
      return { level: "HIGH", score: 75, action: "CAUTIOUS" };
    }
    if (volatility > 0.02) {
      return { level: "MEDIUM", score: 50, action: "NORMAL" };
    }
    return { level: "LOW", score: 25, action: "AGGRESSIVE" };
  }

  /**
   * Calculate volatility as standard deviation of returns
   */
  _calculateVolatility() {
    const allReturns = [];

    for (const token of Object.keys(this.priceHistory)) {
      const prices = this.priceHistory[token];
      if (prices.length < 3) continue;

      // Use last N prices
      const recent = prices.slice(-this.volatilityWindow);
      for (let i = 1; i < recent.length; i++) {
        if (recent[i - 1].price > 0) {
          const ret = (recent[i].price - recent[i - 1].price) / recent[i - 1].price;
          allReturns.push(ret);
        }
      }
    }

    if (allReturns.length === 0) return 0;

    const mean = allReturns.reduce((s, r) => s + r, 0) / allReturns.length;
    const variance = allReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / allReturns.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate trend as simple moving average slope
   * Returns -1 to 1 (negative = downtrend, positive = uptrend)
   */
  _calculateTrend() {
    const trends = [];

    for (const token of Object.keys(this.priceHistory)) {
      const prices = this.priceHistory[token];
      if (prices.length < 5) continue;

      const recent = prices.slice(-this.volatilityWindow);
      const first = recent[0].price;
      const last = recent[recent.length - 1].price;

      if (first > 0) {
        const change = (last - first) / first;
        trends.push(change);
      }
    }

    if (trends.length === 0) return 0;

    const avgTrend = trends.reduce((s, t) => s + t, 0) / trends.length;
    // Clamp to [-1, 1]
    return Math.max(-1, Math.min(1, avgTrend * 10));
  }

  /**
   * Estimate volume based on swap count (number of price updates)
   */
  _estimateVolume() {
    const now = Date.now();
    let recentUpdates = 0;

    for (const token of Object.keys(this.priceHistory)) {
      const prices = this.priceHistory[token];
      recentUpdates += prices.filter(p => now - p.timestamp < 300000).length;
    }

    return recentUpdates;
  }

  /**
   * Get tokens being tracked
   */
  getTrackedTokens() {
    return Object.keys(this.priceHistory).map(token => ({
      token,
      samples: this.priceHistory[token].length,
      latestPrice: this.priceHistory[token].length > 0
        ? this.priceHistory[token][this.priceHistory[token].length - 1].price
        : 0,
    }));
  }

  /**
   * Get regime history for dashboard
   */
  getRegimeHistory() {
    return this.regimeHistory.slice(-20);
  }
}

module.exports = { MarketAnalyzer };
