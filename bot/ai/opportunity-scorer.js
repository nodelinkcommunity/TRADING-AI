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
   */
  score(opportunity, marketConditions) {
    try {
      let score = 50; // base score

      // Factor 1: Profit margin (0-25 points)
      score += this._profitScore(opportunity.profitBps);

      // Factor 2: Liquidity depth (0-20 points)
      score += this._liquidityScore(opportunity);

      // Factor 3: Gas efficiency (0-15 points)
      score += this._gasScore(opportunity, marketConditions.gasPrice || 0);

      // Factor 4: Historical success rate (0-20 points)
      score += this._historicalScore(opportunity);

      // Factor 5: DEX reliability (-10 to +10 points)
      score += this._dexReliabilityScore(opportunity);

      // Factor 6: Time-of-day pattern (0-10 points)
      score += this._timeScore();

      return Math.min(100, Math.max(0, Math.round(score)));
    } catch (error) {
      // If scoring fails, return a conservative score
      return 40;
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
   * Profit score: 0-25 points
   * 15bps=5pts, 30bps=12pts, 50bps=18pts, 100+bps=25pts
   * Uses diminishing returns curve
   */
  _profitScore(profitBps) {
    if (!profitBps || profitBps <= 0) return -10;
    if (profitBps < 5) return -5;
    if (profitBps < 10) return 0;
    // Logarithmic scale for diminishing returns
    // 15bps -> ~5, 30bps -> ~12, 50bps -> ~18, 100bps -> ~23, 200+bps -> ~25
    const score = Math.min(25, 5 * Math.log2(profitBps / 10 + 1));
    return Math.round(score);
  }

  /**
   * Liquidity score: 0-20 points
   * Based on flash amount relative to estimated pool size
   */
  _liquidityScore(opportunity) {
    // Without on-chain pool data, score based on flash amount size
    // Smaller amounts relative to typical pool depth = less slippage risk
    const flashAmount = opportunity.flashAmount || 0n;
    const amountNum = typeof flashAmount === "bigint" ? Number(flashAmount) : Number(flashAmount);

    if (amountNum === 0) return 10; // neutral

    // Assume typical pool has ~$1M liquidity in terms of raw token amounts
    // Smaller trades relative to pool = higher score
    const steps = opportunity.steps || [];
    if (steps.length <= 2) {
      // Simple arb: less hops = less risk
      return 15;
    } else if (steps.length === 3) {
      // Triangular: moderate risk
      return 10;
    }
    return 8;
  }

  /**
   * Gas score: 0-15 points
   * Lower gas relative to profit = better
   */
  _gasScore(opportunity, gasPrice) {
    if (!gasPrice || gasPrice === 0) return 8; // neutral if unknown

    const gasPriceNum = typeof gasPrice === "bigint" ? Number(gasPrice) : Number(gasPrice);
    const gasPriceGwei = gasPriceNum / 1e9;

    // Lower gas = higher score
    if (gasPriceGwei < 0.5) return 15;   // Very cheap gas
    if (gasPriceGwei < 1) return 13;
    if (gasPriceGwei < 5) return 10;
    if (gasPriceGwei < 20) return 5;
    if (gasPriceGwei < 50) return 2;
    return 0; // Very expensive gas
  }

  /**
   * Historical score: 0-20 points
   * Based on success rate of similar past trades
   */
  _historicalScore(opportunity) {
    if (this.history.length === 0) return 10; // neutral with no data

    const type = opportunity.type || "SIMPLE";
    const similar = this.history.filter(h => h.type === type);

    if (similar.length === 0) return 10;

    const successCount = similar.filter(h => h.success).length;
    const successRate = successCount / similar.length;

    // Scale: 0% success -> 0pts, 50% -> 10pts, 100% -> 20pts
    return Math.round(successRate * 20);
  }

  /**
   * DEX reliability score: -10 to +10 points
   * Per-DEX success rate tracking
   */
  _dexReliabilityScore(opportunity) {
    const dex = opportunity.steps && opportunity.steps[0] ? opportunity.steps[0].dex : null;
    if (!dex || !this.dexStats[dex]) return 0; // neutral

    const stats = this.dexStats[dex];
    const total = stats.success + stats.fail;
    if (total < 3) return 0; // not enough data

    const rate = stats.success / total;
    // Scale: 0% -> -10, 50% -> 0, 100% -> +10
    return Math.round((rate - 0.5) * 20);
  }

  /**
   * Time score: 0-10 points
   * Hour-based patterns from history
   */
  _timeScore() {
    const hour = new Date().getHours();
    const hourKey = String(hour);
    const stats = this.hourStats[hourKey];

    if (!stats) return 5; // neutral

    const total = stats.success + stats.fail;
    if (total < 3) return 5; // not enough data

    const rate = stats.success / total;
    return Math.round(rate * 10);
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
