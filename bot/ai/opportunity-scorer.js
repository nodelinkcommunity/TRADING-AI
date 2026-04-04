/**
 * FLASHLOAN-AI: AI Opportunity Scoring
 * Scores each arbitrage opportunity 0-100 based on multiple factors
 * Learns from past execution results to improve over time
 */

class OpportunityScorer {
  constructor() {
    this.history = [];
    this.weights = {
      profit: 25,
      liquidity: 20,
      gas: 15,
      historical: 20,
      dexReliability: 10,
      time: 10,
    };
    this.maxHistory = 1000;
    this.dexStats = {};   // dexName -> { success, fail }
    this.hourStats = {};  // hour -> { success, fail }
  }

  /**
   * Score an opportunity 0-100
   * Each factor returns 0.0-1.0, multiplied by its weight.
   * Weights sum to 100, so total score is 0-100.
   */
  score(opportunity, marketConditions) {
    try {
      const profitScore     = this._profitScore(opportunity.profitBps);
      const liquidityScore  = this._liquidityScore(opportunity);
      const gasScore        = this._gasScore(opportunity, (marketConditions || {}).gasPrice || 0);
      const historicalScore = this._historicalScore(opportunity);
      const dexScore        = this._dexReliabilityScore(opportunity);
      const timeScore       = this._timeScore();

      const totalScore = Math.round(
        profitScore     * this.weights.profit +
        liquidityScore  * this.weights.liquidity +
        gasScore        * this.weights.gas +
        historicalScore * this.weights.historical +
        dexScore        * this.weights.dexReliability +
        timeScore       * this.weights.time
      );

      return Math.max(0, Math.min(100, totalScore));
    } catch (error) {
      console.error(`[OpportunityScorer] Error: ${error.message}`);
      return 30; // conservative fallback
    }
  }

  /**
   * Record execution result for learning
   */
  recordResult(opportunity, result) {
    try {
      const dex = opportunity.steps && opportunity.steps[0] ? opportunity.steps[0].dex : "unknown";
      const hour = new Date().getHours();

      const entry = {
        dex,
        type: opportunity.type || "SIMPLE",
        profitBps: opportunity.profitBps || 0,
        success: !!result.success,
        actualProfit: result.actualProfit || 0,
        gasUsed: result.gasUsed || 0,
        timestamp: Date.now(),
        hour,
      };

      this.history.push(entry);
      if (this.history.length > this.maxHistory) this.history.shift();

      // Update DEX stats
      if (!this.dexStats[dex]) this.dexStats[dex] = { success: 0, fail: 0 };
      if (result.success) {
        this.dexStats[dex].success++;
      } else {
        this.dexStats[dex].fail++;
      }

      // Update hour stats
      const hourKey = String(hour);
      if (!this.hourStats[hourKey]) this.hourStats[hourKey] = { success: 0, fail: 0 };
      if (result.success) {
        this.hourStats[hourKey].success++;
      } else {
        this.hourStats[hourKey].fail++;
      }
    } catch (error) {
      // Silently ignore recording errors
    }
  }

  /**
   * Get recommendation: EXECUTE, WATCH, or SKIP
   */
  getRecommendation(score) {
    if (score >= 75) return { action: "EXECUTE", color: "green", emoji: "green" };
    if (score >= 50) return { action: "WATCH", color: "yellow", emoji: "yellow" };
    return { action: "SKIP", color: "red", emoji: "red" };
  }

  /**
   * Profit score: 0.0 - 1.0
   * Uses logarithmic diminishing returns curve
   * 0 bps -> 0.0, 15 bps -> ~0.4, 50 bps -> ~0.7, 100+ bps -> ~0.9, 200+ bps -> 1.0
   */
  _profitScore(profitBps) {
    if (!profitBps || profitBps <= 0) return 0;
    if (profitBps < 5) return 0.1;
    // Logarithmic scale for diminishing returns, normalized to 0-1
    return Math.min(1.0, Math.log2(profitBps / 5 + 1) / Math.log2(200 / 5 + 1));
  }

  /**
   * Liquidity score: 0.0 - 1.0
   * Based on trade hops (fewer = less slippage risk)
   */
  _liquidityScore(opportunity) {
    const steps = opportunity.steps || [];
    if (steps.length <= 2) return 0.8;  // Simple arb: low risk
    if (steps.length === 3) return 0.5; // Triangular: moderate risk
    return 0.3;                         // Complex: higher risk
  }

  /**
   * Gas score: 0.0 - 1.0
   * Lower gas = higher score
   */
  _gasScore(opportunity, gasPrice) {
    if (!gasPrice || gasPrice === 0) return 0.5; // neutral if unknown

    const gasPriceNum = typeof gasPrice === "bigint" ? Number(gasPrice) : Number(gasPrice);
    const gasPriceGwei = gasPriceNum / 1e9;

    if (gasPriceGwei < 0.5) return 1.0;
    if (gasPriceGwei < 1)   return 0.85;
    if (gasPriceGwei < 5)   return 0.65;
    if (gasPriceGwei < 20)  return 0.35;
    if (gasPriceGwei < 50)  return 0.15;
    return 0;
  }

  /**
   * Historical score: 0.0 - 1.0
   * Based on success rate of similar past trades
   */
  _historicalScore(opportunity) {
    if (this.history.length === 0) return 0.5; // neutral with no data

    const type = opportunity.type || "SIMPLE";
    const similar = this.history.filter(h => h.type === type);

    if (similar.length === 0) return 0.5;

    const successCount = similar.filter(h => h.success).length;
    return successCount / similar.length; // 0.0 - 1.0
  }

  /**
   * DEX reliability score: 0.0 - 1.0
   * Per-DEX success rate tracking
   */
  _dexReliabilityScore(opportunity) {
    const dex = opportunity.steps && opportunity.steps[0] ? opportunity.steps[0].dex : null;
    if (!dex || !this.dexStats[dex]) return 0.5; // neutral

    const stats = this.dexStats[dex];
    const total = stats.success + stats.fail;
    if (total < 3) return 0.5; // not enough data

    return stats.success / total; // 0.0 - 1.0
  }

  /**
   * Time score: 0.0 - 1.0
   * Hour-based patterns from history
   */
  _timeScore() {
    const hour = new Date().getHours();
    const hourKey = String(hour);
    const stats = this.hourStats[hourKey];

    if (!stats) return 0.5; // neutral

    const total = stats.success + stats.fail;
    if (total < 3) return 0.5; // not enough data

    return stats.success / total; // 0.0 - 1.0
  }

  /**
   * Get scoring summary for dashboard
   */
  getSummary() {
    const totalTrades = this.history.length;
    const successCount = this.history.filter(h => h.success).length;
    const winRate = totalTrades > 0 ? (successCount / totalTrades * 100).toFixed(1) : "0.0";

    return {
      totalTrades,
      successCount,
      winRate: parseFloat(winRate),
      dexStats: { ...this.dexStats },
      hourStats: { ...this.hourStats },
    };
  }
}

module.exports = { OpportunityScorer };
