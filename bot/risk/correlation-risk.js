/**
 * FLASHLOAN-AI: Correlation Risk Manager
 * Prevents over-concentration in tokens, chains, and pools.
 */

class CorrelationRisk {
  constructor() {
    this.config = {};
    this.activePositions = []; // currently executing trades
    this.recentTrades = []; // last 1 hour of trades
  }

  initialize(config) {
    this.config = {
      maxExposurePerToken: config.maxExposurePerToken || 0.3,   // 30%
      maxExposurePerChain: config.maxExposurePerChain || 0.5,   // 50%
      maxConcurrentPerPool: config.maxConcurrentPerPool || 3,
      maxConcurrentTotal: config.maxConcurrentTotal || 10,
      ...config,
    };
  }

  /**
   * Check if an opportunity passes correlation risk checks
   * @param {object} opportunity - The opportunity to check
   * @returns {object} { allowed, reason, adjustments }
   */
  check(opportunity) {
    this._cleanupOld();

    // 1. Max concurrent trades total
    if (this.activePositions.length >= this.config.maxConcurrentTotal) {
      return { allowed: false, reason: `Max concurrent trades (${this.config.maxConcurrentTotal}) reached` };
    }

    // 2. Max concurrent on same pool
    const poolKey = this._getPoolKey(opportunity);
    const poolCount = this.activePositions.filter(
      (p) => this._getPoolKey(p) === poolKey
    ).length;
    if (poolCount >= this.config.maxConcurrentPerPool) {
      return { allowed: false, reason: `Max concurrent trades on pool ${poolKey} reached` };
    }

    // 3. Token concentration
    const tokens = this._extractTokens(opportunity);
    for (const token of tokens) {
      const tokenTradeCount = this.recentTrades.filter((t) => {
        const tTokens = this._extractTokens(t);
        return tTokens.includes(token);
      }).length;
      const totalTrades = this.recentTrades.length || 1;
      const concentration = tokenTradeCount / totalTrades;

      if (concentration > this.config.maxExposurePerToken && totalTrades >= 5) {
        return {
          allowed: true,
          reason: `High token concentration: ${(concentration * 100).toFixed(0)}%`,
          adjustments: { reduceSize: 0.5, reason: `Token ${token.slice(0, 10)}... at ${(concentration * 100).toFixed(0)}% concentration` },
        };
      }
    }

    return { allowed: true, reason: "OK" };
  }

  /**
   * Record start of a trade
   */
  addActivePosition(opportunity) {
    this.activePositions.push({
      ...opportunity,
      startedAt: Date.now(),
    });
  }

  /**
   * Record end of a trade
   */
  removeActivePosition(opportunity) {
    const idx = this.activePositions.findIndex(
      (p) => p.tokenIn === opportunity.tokenIn && p.timestamp === opportunity.timestamp
    );
    if (idx !== -1) {
      this.activePositions.splice(idx, 1);
    }
  }

  /**
   * Record completed trade for concentration tracking
   */
  recordResult(opportunity) {
    this.recentTrades.push({
      ...opportunity,
      completedAt: Date.now(),
    });

    // Keep only last hour
    this._cleanupOld();
  }

  _cleanupOld() {
    const oneHourAgo = Date.now() - 3600000;
    this.recentTrades = this.recentTrades.filter((t) => (t.completedAt || t.timestamp) > oneHourAgo);

    // Clean stale active positions (>5 min = probably done)
    const fiveMinAgo = Date.now() - 300000;
    this.activePositions = this.activePositions.filter((p) => p.startedAt > fiveMinAgo);
  }

  _getPoolKey(opportunity) {
    const tokens = this._extractTokens(opportunity).sort();
    const dex = opportunity.steps?.[0]?.dex || "unknown";
    return `${dex}:${tokens.join("-")}`;
  }

  _extractTokens(opportunity) {
    const tokens = new Set();
    if (opportunity.tokenIn) tokens.add(opportunity.tokenIn);
    if (opportunity.steps) {
      for (const step of opportunity.steps) {
        if (step.tokenIn) tokens.add(step.tokenIn);
        if (step.tokenOut) tokens.add(step.tokenOut);
      }
    }
    return Array.from(tokens);
  }

  getStatus() {
    return {
      activePositions: this.activePositions.length,
      recentTradesHour: this.recentTrades.length,
      maxConcurrent: this.config.maxConcurrentTotal,
    };
  }
}

module.exports = CorrelationRisk;
