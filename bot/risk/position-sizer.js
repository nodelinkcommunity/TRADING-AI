/**
 * FLASHLOAN-AI: Position Sizer
 * Dynamically calculates optimal flash loan amount based on
 * pool liquidity, volatility, risk level, and daily budget.
 */

class PositionSizer {
  constructor() {
    this.config = {};
    this.riskLevel = "balanced";
    this.dailyBudgetUsed = 0;
    this.dailyBudgetResetAt = 0;
  }

  initialize(config) {
    this.config = {
      maxLossPerTrade: config.maxLossPerTrade || 50,        // USD
      dailyLossLimit: config.dailyLossLimit || 500,         // USD
      maxCapitalPerTrade: config.maxCapitalPerTrade || 50000, // USD
      ...config,
    };
    this.riskLevel = config.riskLevel || "balanced";
    this._resetDailyBudget();
  }

  /**
   * Calculate maximum flash amount for an opportunity
   * @param {object} opportunity - The arbitrage opportunity
   * @param {object} marketState - Current market state
   * @returns {object} { maxFlashAmount, reason, factors }
   */
  calculate(opportunity, marketState) {
    this._checkDailyReset();

    const factors = {};
    const limits = [];

    // 1. Pool liquidity factor
    const poolTVL = this._getPoolTVL(opportunity, marketState);
    if (poolTVL > 0) {
      const liquidityFactor = this._getLiquidityFactor(poolTVL);
      const liquidityLimit = poolTVL * liquidityFactor;
      factors.poolTVL = poolTVL;
      factors.liquidityFactor = liquidityFactor;
      limits.push({ value: liquidityLimit, reason: `Pool TVL $${(poolTVL / 1000).toFixed(0)}K × ${(liquidityFactor * 100).toFixed(1)}%` });
    }

    // 2. Absolute max per trade
    const maxPerTrade = this.config.maxCapitalPerTrade;
    limits.push({ value: maxPerTrade, reason: `Max per trade: $${(maxPerTrade / 1000).toFixed(0)}K` });

    // 3. Daily budget remaining
    const dailyRemaining = this.config.dailyLossLimit - this.dailyBudgetUsed;
    if (dailyRemaining <= 0) {
      return { maxFlashAmount: 0, reason: "Daily loss limit reached", factors };
    }
    // Scale position so max possible loss stays within budget
    // Assume max loss = 2% of flash amount (worst case slippage + gas)
    const budgetLimit = dailyRemaining / 0.02;
    limits.push({ value: budgetLimit, reason: `Daily budget: $${dailyRemaining.toFixed(0)} remaining` });

    // 4. Volatility adjustment
    const volatility = marketState?.market?.volatility || 0;
    let volMultiplier = 1.0;
    if (volatility > 0.05) volMultiplier = 0.5;
    else if (volatility > 0.03) volMultiplier = 0.7;
    else if (volatility > 0.01) volMultiplier = 0.85;
    factors.volatility = volatility;
    factors.volMultiplier = volMultiplier;

    // 5. Risk level multiplier
    const riskMultipliers = {
      conservative: 0.5,
      balanced: 1.0,
      aggressive: 1.5,
    };
    const riskMultiplier = riskMultipliers[this.riskLevel] || 1.0;
    factors.riskMultiplier = riskMultiplier;

    // Calculate final max
    const baseMax = Math.min(...limits.map((l) => l.value));
    const adjustedMax = baseMax * volMultiplier * riskMultiplier;
    const bindingLimit = limits.find((l) => l.value === baseMax);

    return {
      maxFlashAmount: Math.max(0, Math.floor(adjustedMax)),
      reason: bindingLimit?.reason || "Default limit",
      factors,
      limits,
    };
  }

  /**
   * Get pool TVL from market state
   */
  _getPoolTVL(opportunity, marketState) {
    if (!marketState?.pools?.topPools) return 0;

    // Try to find matching pool by tokens
    const tokenIn = opportunity.tokenIn?.toLowerCase();
    const tokenOut = opportunity.steps?.[0]?.tokenOut?.toLowerCase();

    for (const pool of marketState.pools.topPools) {
      const symbol = pool.symbol?.toLowerCase() || "";
      if (tokenIn && tokenOut && symbol.includes(tokenIn) && symbol.includes(tokenOut)) {
        return pool.tvl || 0;
      }
    }

    // Default: assume medium pool
    return 1000000;
  }

  /**
   * Liquidity factor based on pool TVL
   */
  _getLiquidityFactor(tvl) {
    if (tvl > 10000000) return 0.005;    // >$10M: max 0.5%
    if (tvl > 1000000) return 0.003;     // >$1M: max 0.3%
    if (tvl > 100000) return 0.001;      // >$100K: max 0.1%
    return 0.0005;                        // <$100K: max 0.05%
  }

  /**
   * Record a loss against daily budget
   */
  recordLoss(amountUsd) {
    this.dailyBudgetUsed += amountUsd;
  }

  /**
   * Set risk level
   */
  setRiskLevel(level) {
    this.riskLevel = level;
  }

  /**
   * Check if daily budget needs reset
   */
  _checkDailyReset() {
    const now = Date.now();
    if (now > this.dailyBudgetResetAt) {
      this._resetDailyBudget();
    }
  }

  _resetDailyBudget() {
    this.dailyBudgetUsed = 0;
    // Reset at next midnight UTC
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    this.dailyBudgetResetAt = tomorrow.getTime();
  }

  getStatus() {
    return {
      riskLevel: this.riskLevel,
      dailyBudgetUsed: this.dailyBudgetUsed,
      dailyBudgetLimit: this.config.dailyLossLimit,
      dailyBudgetRemaining: Math.max(0, this.config.dailyLossLimit - this.dailyBudgetUsed),
      maxCapitalPerTrade: this.config.maxCapitalPerTrade,
    };
  }
}

module.exports = PositionSizer;
