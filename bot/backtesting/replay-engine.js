/**
 * FLASHLOAN-AI: Replay Engine
 * Replays stored opportunities with different parameters to find optimal settings.
 * "What if we had used X min profit instead of Y?"
 */

const fs = require("fs");
const path = require("path");
const ss = require("simple-statistics");

class ReplayEngine {
  constructor() {
    this.opportunitiesPath = path.join(__dirname, "..", "..", "server", "data", "opportunities.json");
    this.resultsPath = path.join(__dirname, "..", "..", "server", "data", "backtest-results");
  }

  /**
   * Replay opportunities with different parameters
   * @param {object} params - { minProfitBps, maxSlippageBps, flashAmountMultiplier, timeRange }
   * @returns {object} Replay results
   */
  async replay(params = {}) {
    const opportunities = this._loadOpportunities();
    if (opportunities.length === 0) {
      return { error: "No stored opportunities to replay", count: 0 };
    }

    const {
      minProfitBps = 30,
      maxSlippageBps = 50,
      flashAmountMultiplier = 1.0,
      timeRange = null, // { start, end } in ms
    } = params;

    // Filter by time range
    let filtered = opportunities;
    if (timeRange) {
      filtered = filtered.filter(
        (o) => o.storedAt >= timeRange.start && o.storedAt <= timeRange.end
      );
    }

    // Simulate each opportunity
    const results = {
      totalOpportunities: filtered.length,
      wouldExecute: 0,
      wouldSkip: 0,
      estimatedProfit: 0,
      estimatedLoss: 0,
      winCount: 0,
      lossCount: 0,
      profitDistribution: [],
      byHour: {},
      byDex: {},
      byPair: {},
      params: { minProfitBps, maxSlippageBps, flashAmountMultiplier },
      timestamp: Date.now(),
    };

    for (const opp of filtered) {
      const profitBps = opp.profitBps || opp.estimatedProfitBps || 0;

      // Would this opportunity pass the filter?
      if (profitBps >= minProfitBps) {
        results.wouldExecute++;

        // Simulate outcome based on whether it was actually executed
        if (opp.executed && opp.result) {
          // We have real outcome data
          if (opp.result.success) {
            results.winCount++;
            results.estimatedProfit += parseFloat(opp.result.profit || 0);
          } else {
            results.lossCount++;
            results.estimatedLoss += parseFloat(opp.result.loss || 0);
          }
        } else {
          // Estimate: assume 60% win rate for non-executed opportunities
          // with profit proportional to profitBps
          const estimated = profitBps * flashAmountMultiplier * 0.01;
          if (Math.random() < 0.6) {
            results.winCount++;
            results.estimatedProfit += estimated;
          } else {
            results.lossCount++;
            results.estimatedLoss += estimated * 0.3;
          }
        }

        results.profitDistribution.push(profitBps);

        // Track by hour
        const hour = new Date(opp.storedAt || opp.timestamp).getUTCHours();
        if (!results.byHour[hour]) results.byHour[hour] = { count: 0, profit: 0 };
        results.byHour[hour].count++;
        results.byHour[hour].profit += profitBps;

        // Track by DEX
        const dex = opp.steps?.[0]?.dex || "unknown";
        if (!results.byDex[dex]) results.byDex[dex] = { count: 0, profit: 0 };
        results.byDex[dex].count++;
        results.byDex[dex].profit += profitBps;

        // Track by pair
        const pair = `${opp.tokenIn?.slice(0, 8) || "?"}-${opp.steps?.[opp.steps.length - 1]?.tokenOut?.slice(0, 8) || "?"}`;
        if (!results.byPair[pair]) results.byPair[pair] = { count: 0, profit: 0 };
        results.byPair[pair].count++;
        results.byPair[pair].profit += profitBps;
      } else {
        results.wouldSkip++;
      }
    }

    // Calculate statistics
    const totalTrades = results.winCount + results.lossCount;
    results.winRate = totalTrades > 0 ? results.winCount / totalTrades : 0;
    results.netProfit = results.estimatedProfit - results.estimatedLoss;
    results.avgProfitBps = results.profitDistribution.length > 0
      ? ss.mean(results.profitDistribution)
      : 0;
    results.medianProfitBps = results.profitDistribution.length > 0
      ? ss.median(results.profitDistribution)
      : 0;

    if (results.profitDistribution.length >= 2) {
      results.stdDevProfitBps = ss.standardDeviation(results.profitDistribution);
    }

    // Count how many results are based on real vs simulated data
    const realOutcomes = filtered.filter(o => o.executed && o.result).length;
    const simulatedOutcomes = totalTrades - realOutcomes;
    results.dataQuality = {
      realOutcomes,
      simulatedOutcomes,
      simulatedPct: totalTrades > 0 ? Math.round((simulatedOutcomes / totalTrades) * 100) : 0,
      disclaimer: simulatedOutcomes > 0
        ? `${simulatedOutcomes}/${totalTrades} outcomes are simulated (heuristic 60% win rate). Results should NOT be treated as proof of strategy effectiveness. Only real executed trades provide reliable performance data.`
        : "All outcomes are based on real executed trade data.",
    };

    // Save result
    this._saveResult(results);

    return results;
  }

  /**
   * Parameter sweep: test multiple minProfitBps values
   */
  async parameterSweep(sweepParams = {}) {
    const {
      minProfitRange = [10, 20, 30, 50, 75, 100],
      flashMultipliers = [0.5, 1.0, 1.5, 2.0],
    } = sweepParams;

    const results = [];

    for (const minProfit of minProfitRange) {
      for (const mult of flashMultipliers) {
        const result = await this.replay({
          minProfitBps: minProfit,
          flashAmountMultiplier: mult,
        });
        results.push({
          minProfitBps: minProfit,
          flashAmountMultiplier: mult,
          wouldExecute: result.wouldExecute,
          winRate: result.winRate,
          netProfit: result.netProfit,
          avgProfitBps: result.avgProfitBps,
        });
      }
    }

    // Sort by net profit
    results.sort((a, b) => b.netProfit - a.netProfit);

    return {
      bestParams: results[0],
      allResults: results,
      recommendation: results[0]
        ? `Optimal: minProfitBps=${results[0].minProfitBps}, flashMultiplier=${results[0].flashAmountMultiplier}`
        : "Insufficient data",
    };
  }

  _loadOpportunities() {
    try {
      if (!fs.existsSync(this.opportunitiesPath)) return [];
      return JSON.parse(fs.readFileSync(this.opportunitiesPath, "utf8"));
    } catch {
      return [];
    }
  }

  _saveResult(result) {
    try {
      if (!fs.existsSync(this.resultsPath)) {
        fs.mkdirSync(this.resultsPath, { recursive: true });
      }
      const filename = `replay-${Date.now()}.json`;
      fs.writeFileSync(
        path.join(this.resultsPath, filename),
        JSON.stringify(result, null, 2),
        "utf8"
      );
    } catch (error) {
      console.warn(`[ReplayEngine] Save error: ${error.message}`);
    }
  }

  /**
   * List past replay results
   */
  listResults() {
    try {
      if (!fs.existsSync(this.resultsPath)) return [];
      const files = fs.readdirSync(this.resultsPath)
        .filter((f) => f.startsWith("replay-") && f.endsWith(".json"))
        .sort()
        .slice(-20);

      return files.map((f) => {
        const data = JSON.parse(fs.readFileSync(path.join(this.resultsPath, f), "utf8"));
        return {
          file: f,
          timestamp: data.timestamp,
          params: data.params,
          wouldExecute: data.wouldExecute,
          winRate: data.winRate,
          netProfit: data.netProfit,
        };
      });
    } catch {
      return [];
    }
  }
}

module.exports = ReplayEngine;
