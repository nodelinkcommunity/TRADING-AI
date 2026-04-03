/**
 * FLASHLOAN-AI: A/B Tester
 * Runs 2 strategies in parallel (Paper Trading mode) to compare performance.
 * Both strategies analyze the same opportunities independently.
 */

const fs = require("fs");
const path = require("path");
const ss = require("simple-statistics");

class ABTester {
  constructor() {
    this.isRunning = false;
    this.test = null;
    this.filePath = path.join(__dirname, "..", "..", "server", "data", "ab-test.json");
  }

  /**
   * Start an A/B test
   * @param {object} params - {
   *   nameA, nameB,
   *   strategyA: { minProfitBps, maxSlippageBps, ... },
   *   strategyB: { minProfitBps, maxSlippageBps, ... },
   *   durationHours
   * }
   */
  start(params) {
    if (this.isRunning) {
      return { error: "A/B test already running. Stop it first." };
    }

    this.test = {
      id: `ab-${Date.now()}`,
      nameA: params.nameA || "Strategy A",
      nameB: params.nameB || "Strategy B",
      strategyA: params.strategyA || { minProfitBps: 30 },
      strategyB: params.strategyB || { minProfitBps: 50 },
      durationHours: params.durationHours || 24,
      startedAt: Date.now(),
      endsAt: Date.now() + (params.durationHours || 24) * 3600000,
      resultsA: [],
      resultsB: [],
    };

    this.isRunning = true;
    this._save();
    console.log(`[ABTester] Started: ${this.test.nameA} vs ${this.test.nameB} for ${this.test.durationHours}h`);

    return {
      id: this.test.id,
      message: `A/B test started: ${this.test.nameA} vs ${this.test.nameB}`,
    };
  }

  /**
   * Evaluate an opportunity against both strategies
   * Called for each opportunity during Paper Trading
   * @param {object} opportunity - The arbitrage opportunity
   * @returns {object} { strategyA: decision, strategyB: decision }
   */
  evaluate(opportunity) {
    if (!this.isRunning || !this.test) return null;

    // Check if test has expired
    if (Date.now() > this.test.endsAt) {
      this.stop();
      return null;
    }

    const profitBps = opportunity.profitBps || 0;

    // Strategy A decision
    const decisionA = this._applyStrategy(opportunity, this.test.strategyA);
    this.test.resultsA.push({
      timestamp: Date.now(),
      profitBps,
      decision: decisionA.action,
      estimatedProfit: decisionA.estimatedProfit,
    });

    // Strategy B decision
    const decisionB = this._applyStrategy(opportunity, this.test.strategyB);
    this.test.resultsB.push({
      timestamp: Date.now(),
      profitBps,
      decision: decisionB.action,
      estimatedProfit: decisionB.estimatedProfit,
    });

    this._save();

    return { strategyA: decisionA, strategyB: decisionB };
  }

  /**
   * Apply strategy rules to an opportunity
   */
  _applyStrategy(opportunity, strategy) {
    const profitBps = opportunity.profitBps || 0;
    const minProfit = strategy.minProfitBps || 30;

    if (profitBps >= minProfit) {
      return {
        action: "EXECUTE",
        estimatedProfit: profitBps,
        reason: `Profit ${profitBps} bps >= threshold ${minProfit} bps`,
      };
    }
    return {
      action: "SKIP",
      estimatedProfit: 0,
      reason: `Profit ${profitBps} bps < threshold ${minProfit} bps`,
    };
  }

  /**
   * Stop the A/B test and return final comparison
   */
  stop() {
    if (!this.isRunning || !this.test) {
      return { error: "No A/B test running" };
    }

    this.isRunning = false;
    this.test.stoppedAt = Date.now();
    this.test.comparison = this._compare();
    this._save();

    console.log(`[ABTester] Stopped. Winner: ${this.test.comparison.winner}`);
    return this.test.comparison;
  }

  /**
   * Compare strategy results
   */
  _compare() {
    const a = this.test.resultsA;
    const b = this.test.resultsB;

    const statsA = this._calcStats(a, this.test.nameA);
    const statsB = this._calcStats(b, this.test.nameB);

    // Determine winner
    let winner = "TIE";
    let reason = "";

    if (statsA.estimatedTotalProfit > statsB.estimatedTotalProfit * 1.1) {
      winner = this.test.nameA;
      reason = `${this.test.nameA} has ${((statsA.estimatedTotalProfit / Math.max(1, statsB.estimatedTotalProfit) - 1) * 100).toFixed(0)}% more profit`;
    } else if (statsB.estimatedTotalProfit > statsA.estimatedTotalProfit * 1.1) {
      winner = this.test.nameB;
      reason = `${this.test.nameB} has ${((statsB.estimatedTotalProfit / Math.max(1, statsA.estimatedTotalProfit) - 1) * 100).toFixed(0)}% more profit`;
    } else {
      // Within 10%: prefer higher win rate
      if (statsA.executeRate > statsB.executeRate) {
        winner = this.test.nameA;
        reason = "Similar profit, but more trades executed";
      } else if (statsB.executeRate > statsA.executeRate) {
        winner = this.test.nameB;
        reason = "Similar profit, but more trades executed";
      } else {
        reason = "Both strategies perform similarly";
      }
    }

    return {
      winner,
      reason,
      strategyA: statsA,
      strategyB: statsB,
      duration: this.test.stoppedAt - this.test.startedAt,
      totalOpportunities: a.length,
    };
  }

  _calcStats(results, name) {
    const executed = results.filter((r) => r.decision === "EXECUTE");
    const profits = executed.map((r) => r.estimatedProfit);

    return {
      name,
      totalEvaluated: results.length,
      executed: executed.length,
      skipped: results.length - executed.length,
      executeRate: results.length > 0 ? executed.length / results.length : 0,
      estimatedTotalProfit: profits.length > 0 ? ss.sum(profits) : 0,
      avgProfitBps: profits.length > 0 ? ss.mean(profits) : 0,
      medianProfitBps: profits.length > 0 ? ss.median(profits) : 0,
    };
  }

  /**
   * Get current status
   */
  getStatus() {
    if (!this.test) return { isRunning: false };

    const elapsed = Date.now() - this.test.startedAt;
    const remaining = Math.max(0, this.test.endsAt - Date.now());

    return {
      isRunning: this.isRunning,
      id: this.test.id,
      nameA: this.test.nameA,
      nameB: this.test.nameB,
      strategyA: this.test.strategyA,
      strategyB: this.test.strategyB,
      elapsed: Math.round(elapsed / 60000) + " min",
      remaining: Math.round(remaining / 60000) + " min",
      currentA: this._calcStats(this.test.resultsA, this.test.nameA),
      currentB: this._calcStats(this.test.resultsB, this.test.nameB),
      comparison: this.test.comparison || null,
    };
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.test, null, 2), "utf8");
    } catch (error) {
      console.warn(`[ABTester] Save error: ${error.message}`);
    }
  }
}

module.exports = ABTester;
