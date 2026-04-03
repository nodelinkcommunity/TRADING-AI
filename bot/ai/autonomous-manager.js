/**
 * FLASHLOAN-AI: Autonomous Manager
 * Handles operational decisions WITHOUT human approval:
 * - Gas optimization
 * - Slippage adjustment
 * - Min profit threshold tuning
 * - Flash amount sizing
 * - Pool skip decisions
 */

class AutonomousManager {
  constructor() {
    this.decisions = []; // log of all decisions
    this.maxDecisions = 500;
    this.currentParams = {};
    this.baseParams = {};
    this.isRunning = false;
  }

  /**
   * Initialize with base config
   */
  initialize(config) {
    this.baseParams = {
      minProfitBps: config.minProfitBps || 30,
      maxSlippageBps: config.maxSlippageBps || 50,
      scanIntervalMs: config.scanIntervalMs || 3000,
      flashAmountMultiplier: 1.0,
    };
    this.currentParams = { ...this.baseParams };
    this.riskLevel = config.ai?.riskLevel || "balanced";
    this.isRunning = true;

    console.log("[AutonomousManager] Initialized");
  }

  /**
   * Adjust parameters based on current market state
   * Called every scan cycle
   * @param {object} marketState - Current MarketState
   * @returns {object} Adjusted parameters
   */
  adjustParams(marketState) {
    if (!this.isRunning) return this.currentParams;

    const adjustments = {};
    const reasons = [];

    // 1. Gas-based min profit adjustment
    const gasAdjustment = this._adjustForGas(marketState);
    if (gasAdjustment) {
      adjustments.minProfitBps = gasAdjustment.minProfitBps;
      reasons.push(gasAdjustment.reason);
    }

    // 2. Volatility-based slippage adjustment
    const slippageAdjustment = this._adjustSlippage(marketState);
    if (slippageAdjustment) {
      adjustments.maxSlippageBps = slippageAdjustment.maxSlippageBps;
      reasons.push(slippageAdjustment.reason);
    }

    // 3. Market regime-based scan interval
    const intervalAdjustment = this._adjustScanInterval(marketState);
    if (intervalAdjustment) {
      adjustments.scanIntervalMs = intervalAdjustment.scanIntervalMs;
      reasons.push(intervalAdjustment.reason);
    }

    // 4. Flash amount multiplier based on conditions
    const sizeAdjustment = this._adjustFlashSize(marketState);
    if (sizeAdjustment) {
      adjustments.flashAmountMultiplier = sizeAdjustment.multiplier;
      reasons.push(sizeAdjustment.reason);
    }

    // Apply adjustments
    if (Object.keys(adjustments).length > 0) {
      Object.assign(this.currentParams, adjustments);

      this._logDecision("PARAM_ADJUSTMENT", {
        adjustments,
        reasons,
        marketContext: this._getMarketContext(marketState),
      });
    }

    return this.currentParams;
  }

  /**
   * Adjust min profit based on gas conditions
   */
  _adjustForGas(marketState) {
    const gasPrice = marketState?.market?.gasPrice || 0;
    const gasTrend = marketState?.market?.gasTrend || "STABLE";
    const gasRec = marketState?.market?.gasRecommendation;

    if (!gasPrice) return null;

    let newMinProfit = this.baseParams.minProfitBps;

    if (gasRec === "WAIT" || gasTrend === "RISING") {
      // High gas: increase min profit to ensure profitability after gas costs
      newMinProfit = Math.min(100, this.baseParams.minProfitBps * 1.5);
      return {
        minProfitBps: Math.round(newMinProfit),
        reason: `Gas ${gasTrend.toLowerCase()}: raised min profit to ${Math.round(newMinProfit)} bps`,
      };
    } else if (gasRec === "GOOD_TIME") {
      // Low gas: can afford lower profit threshold
      newMinProfit = Math.max(10, this.baseParams.minProfitBps * 0.7);
      return {
        minProfitBps: Math.round(newMinProfit),
        reason: `Gas low: lowered min profit to ${Math.round(newMinProfit)} bps`,
      };
    }

    return null;
  }

  /**
   * Adjust slippage based on volatility
   */
  _adjustSlippage(marketState) {
    const volatility = marketState?.market?.volatility || 0;
    const regime = marketState?.market?.regime || "";

    let newSlippage = this.baseParams.maxSlippageBps;

    if (volatility > 0.05 || regime.includes("VOLATILE")) {
      // High volatility: tighten slippage to protect
      newSlippage = Math.max(20, this.baseParams.maxSlippageBps * 0.6);
      return {
        maxSlippageBps: Math.round(newSlippage),
        reason: `Volatile market (${(volatility * 100).toFixed(1)}%): tightened slippage to ${Math.round(newSlippage)} bps`,
      };
    } else if (volatility < 0.01) {
      // Low volatility: can relax slippage slightly
      newSlippage = Math.min(100, this.baseParams.maxSlippageBps * 1.2);
      return {
        maxSlippageBps: Math.round(newSlippage),
        reason: `Low volatility: relaxed slippage to ${Math.round(newSlippage)} bps`,
      };
    }

    return null;
  }

  /**
   * Adjust scan interval based on market regime
   */
  _adjustScanInterval(marketState) {
    const regime = marketState?.market?.regime || "";
    const signals = marketState?.signals || [];

    // More signals / volatile market = scan faster
    const actionableSignals = signals.filter((s) => s.actionable).length;

    if (regime.includes("VOLATILE") || actionableSignals >= 3) {
      return {
        scanIntervalMs: Math.max(1000, this.baseParams.scanIntervalMs * 0.5),
        reason: `Active market: increased scan frequency to ${Math.max(1000, this.baseParams.scanIntervalMs * 0.5)}ms`,
      };
    } else if (regime === "SIDEWAYS" && actionableSignals === 0) {
      return {
        scanIntervalMs: Math.min(10000, this.baseParams.scanIntervalMs * 2),
        reason: `Quiet market: reduced scan frequency to ${Math.min(10000, this.baseParams.scanIntervalMs * 2)}ms`,
      };
    }

    return null;
  }

  /**
   * Adjust flash amount multiplier
   */
  _adjustFlashSize(marketState) {
    const whaleAlert = marketState?.whales?.alertLevel || "NONE";
    const timeRec = marketState?.historical?.timeRecommendation;
    const sentiment = marketState ? this._calculateSentiment(marketState) : 0;

    let multiplier = 1.0;
    const reasons = [];

    // Whale activity: be cautious with large whales moving
    if (whaleAlert === "EXTREME") {
      multiplier *= 0.5;
      reasons.push("extreme whale activity");
    } else if (whaleAlert === "HIGH") {
      multiplier *= 0.7;
      reasons.push("high whale activity");
    }

    // Historical best hour: increase size
    if (timeRec?.recommendation === "AGGRESSIVE") {
      multiplier *= 1.3;
      reasons.push("optimal trading hour");
    } else if (timeRec?.recommendation === "CONSERVATIVE") {
      multiplier *= 0.7;
      reasons.push("suboptimal trading hour");
    }

    // Risk level adjustment
    const riskMultipliers = { conservative: 0.7, balanced: 1.0, aggressive: 1.3 };
    multiplier *= riskMultipliers[this.riskLevel] || 1.0;

    if (Math.abs(multiplier - 1.0) > 0.05) {
      return {
        multiplier: Math.max(0.3, Math.min(2.0, multiplier)),
        reason: `Flash size ${multiplier > 1 ? "increased" : "decreased"} (${reasons.join(", ")})`,
      };
    }

    return null;
  }

  _calculateSentiment(marketState) {
    const whales = marketState.whales || {};
    const buyVol = whales.buyVolume || 0;
    const sellVol = whales.sellVolume || 0;
    const total = buyVol + sellVol;
    return total > 0 ? (buyVol - sellVol) / total : 0;
  }

  /**
   * Log an autonomous decision
   */
  _logDecision(type, details) {
    this.decisions.push({
      type,
      ...details,
      timestamp: Date.now(),
    });

    if (this.decisions.length > this.maxDecisions) {
      this.decisions = this.decisions.slice(-this.maxDecisions);
    }
  }

  _getMarketContext(marketState) {
    return {
      regime: marketState?.market?.regime,
      gasPrice: marketState?.market?.gasPrice,
      volatility: marketState?.market?.volatility,
      whaleAlert: marketState?.whales?.alertLevel,
    };
  }

  /**
   * Get current adjusted parameters
   */
  getCurrentParams() {
    return { ...this.currentParams };
  }

  /**
   * Get recent decisions for dashboard
   */
  getRecentDecisions(count = 20) {
    return this.decisions.slice(-count);
  }

  /**
   * Get status for dashboard
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      currentParams: this.currentParams,
      baseParams: this.baseParams,
      riskLevel: this.riskLevel,
      totalDecisions: this.decisions.length,
      recentDecisions: this.decisions.slice(-5),
    };
  }

  stop() {
    this.isRunning = false;
  }
}

module.exports = AutonomousManager;
