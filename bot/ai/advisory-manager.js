/**
 * FLASHLOAN-AI: Advisory Manager
 * Generates strategic recommendations that require human review.
 * Recommendations appear on Dashboard for approve/reject.
 */

const fs = require("fs");
const path = require("path");

class AdvisoryManager {
  constructor() {
    this.advisories = [];
    this.maxAdvisories = 200;
    this.filePath = path.join(__dirname, "..", "..", "server", "data", "advisories.json");
    this.autoExecuteThreshold = 90; // confidence threshold for auto-execute
    this.analysisInterval = null;
    this.lastAnalysis = 0;
    this.analysisIntervalMs = 300000; // 5 minutes
  }

  initialize(config) {
    this.autoExecuteThreshold = config.ai?.autoExecuteThreshold || 90;
    this._load();
    console.log(`[AdvisoryManager] Initialized with ${this.advisories.length} existing advisories`);
  }

  /**
   * Analyze market state and generate advisories
   * Called periodically (every 5 min) from AI Engine
   */
  analyze(marketState) {
    const now = Date.now();
    if (now - this.lastAnalysis < this.analysisIntervalMs) return;
    this.lastAnalysis = now;

    const newAdvisories = [];

    // 1. Token pair recommendations
    const pairAdvisory = this._analyzeTokenPairs(marketState);
    if (pairAdvisory) newAdvisories.push(pairAdvisory);

    // 2. Chain allocation recommendation
    const chainAdvisory = this._analyzeChainAllocation(marketState);
    if (chainAdvisory) newAdvisories.push(chainAdvisory);

    // 3. Risk level adjustment
    const riskAdvisory = this._analyzeRiskLevel(marketState);
    if (riskAdvisory) newAdvisories.push(riskAdvisory);

    // 4. Strategy suggestions
    const strategyAdvisory = this._analyzeStrategies(marketState);
    if (strategyAdvisory) newAdvisories.push(strategyAdvisory);

    // 5. Performance-based suggestions
    const perfAdvisory = this._analyzePerformance(marketState);
    if (perfAdvisory) newAdvisories.push(perfAdvisory);

    // Add new advisories
    for (const advisory of newAdvisories) {
      // Deduplicate: don't create same type advisory within 1 hour
      const isDuplicate = this.advisories.some(
        (a) => a.type === advisory.type && a.status === "pending" && now - a.createdAt < 3600000
      );
      if (!isDuplicate) {
        this.advisories.push(advisory);
      }
    }

    // Trim old
    if (this.advisories.length > this.maxAdvisories) {
      this.advisories = this.advisories.slice(-this.maxAdvisories);
    }

    this._save();
  }

  /**
   * Analyze token pair performance
   */
  _analyzeTokenPairs(marketState) {
    const bestPairs = marketState?.historical?.bestPairs || [];
    const worstPairs = bestPairs.filter((p) => p.winRate < 0.3 && p.trades >= 5);

    if (worstPairs.length > 0) {
      return this._createAdvisory({
        type: "REMOVE_TOKEN_PAIR",
        title: `Consider removing underperforming pair: ${worstPairs[0].pair}`,
        reasoning: `Win rate: ${(worstPairs[0].winRate * 100).toFixed(0)}% over ${worstPairs[0].trades} trades. Removing this pair would improve overall performance.`,
        impact: `Estimated: avoid ${worstPairs[0].trades - worstPairs[0].wins} losing trades`,
        risk: "LOW",
        confidence: 0.7,
        data: { pair: worstPairs[0].pair, stats: worstPairs[0] },
      });
    }

    // Suggest high-performing pairs
    const topPools = marketState?.pools?.topPools || [];
    const highVolumePools = topPools.filter(
      (p) => p.volumeUsd1d > 1000000 && !p.stablecoin
    );

    if (highVolumePools.length > 0) {
      const suggestion = highVolumePools[0];
      return this._createAdvisory({
        type: "ADD_TOKEN_PAIR",
        title: `High-volume pool detected: ${suggestion.symbol}`,
        reasoning: `${suggestion.project} pool ${suggestion.symbol} has $${(suggestion.volumeUsd1d / 1000000).toFixed(1)}M daily volume and $${(suggestion.tvl / 1000000).toFixed(1)}M TVL. High volume often creates arbitrage opportunities.`,
        impact: "Potential new arbitrage opportunities",
        risk: "LOW",
        confidence: 0.6,
        data: { pool: suggestion },
      });
    }

    return null;
  }

  /**
   * Analyze chain allocation
   */
  _analyzeChainAllocation(marketState) {
    const protocolTVL = marketState?.pools?.protocolTVL;
    if (!protocolTVL?.tvl) return null;

    // If current chain TVL dropped significantly, suggest looking at others
    if (protocolTVL.tvl < 100000000) {
      return this._createAdvisory({
        type: "CHAIN_SUGGESTION",
        title: `Current chain TVL is low: $${(protocolTVL.tvl / 1000000).toFixed(0)}M`,
        reasoning: "Lower TVL means less liquidity and fewer arbitrage opportunities. Consider adding chains with higher TVL.",
        impact: "More opportunities on higher-TVL chains",
        risk: "MEDIUM",
        confidence: 0.5,
        data: { currentTVL: protocolTVL.tvl, chain: protocolTVL.chain },
      });
    }

    return null;
  }

  /**
   * Analyze if risk level should be adjusted
   */
  _analyzeRiskLevel(marketState) {
    const regime = marketState?.market?.regime || "";
    const whaleAlert = marketState?.whales?.alertLevel || "NONE";
    const volatility = marketState?.market?.volatility || 0;

    // Suggest conservative during extreme conditions
    if ((whaleAlert === "EXTREME" || volatility > 0.08) && regime.includes("VOLATILE")) {
      return this._createAdvisory({
        type: "ADJUST_RISK_LEVEL",
        title: "Consider switching to CONSERVATIVE mode",
        reasoning: `Market conditions are extreme: ${regime}, volatility ${(volatility * 100).toFixed(1)}%, whale activity ${whaleAlert}. Conservative mode reduces position sizes and increases safety margins.`,
        impact: "Reduced risk of losses, slightly fewer trades",
        risk: "LOW",
        confidence: 0.8,
        data: { suggestedLevel: "conservative", currentConditions: { regime, volatility, whaleAlert } },
      });
    }

    // Suggest aggressive during calm + profitable conditions
    const winRate = marketState?.historical?.localStats?.overallWinRate || 0;
    if (regime === "SIDEWAYS" && volatility < 0.01 && winRate > 0.7) {
      return this._createAdvisory({
        type: "ADJUST_RISK_LEVEL",
        title: "Consider switching to AGGRESSIVE mode",
        reasoning: `Market is calm (${regime}, vol ${(volatility * 100).toFixed(1)}%) and win rate is strong (${(winRate * 100).toFixed(0)}%). Aggressive mode increases position sizes for higher returns.`,
        impact: "Higher potential returns, slightly increased risk",
        risk: "MEDIUM",
        confidence: 0.6,
        data: { suggestedLevel: "aggressive", currentConditions: { regime, volatility, winRate } },
      });
    }

    return null;
  }

  /**
   * Strategy suggestions based on market conditions
   */
  _analyzeStrategies(marketState) {
    const bestStrategies = marketState?.market?.bestStrategies || [];
    if (bestStrategies.length === 0) return null;

    const topStrategy = bestStrategies[0];
    if (topStrategy && topStrategy !== "dexArbitrage") {
      return this._createAdvisory({
        type: "STRATEGY_SUGGESTION",
        title: `Consider enabling ${topStrategy} strategy`,
        reasoning: `Current market regime (${marketState?.market?.regime}) favors ${topStrategy} strategy. This could complement existing DEX arbitrage.`,
        impact: "Additional profit source",
        risk: "MEDIUM",
        confidence: 0.5,
        data: { strategy: topStrategy, regime: marketState?.market?.regime },
      });
    }

    return null;
  }

  /**
   * Performance-based suggestions
   */
  _analyzePerformance(marketState) {
    const localStats = marketState?.historical?.localStats;
    if (!localStats || localStats.totalTrades < 10) return null;

    if (localStats.overallWinRate < 0.4) {
      return this._createAdvisory({
        type: "PERFORMANCE_ALERT",
        title: "Win rate below 40% — review strategy parameters",
        reasoning: `Overall win rate is ${(localStats.overallWinRate * 100).toFixed(0)}% over ${localStats.totalTrades} trades. Consider increasing min profit threshold or narrowing token pairs to best performers.`,
        impact: "Improved win rate and profitability",
        risk: "LOW",
        confidence: 0.85,
        data: { winRate: localStats.overallWinRate, totalTrades: localStats.totalTrades },
      });
    }

    return null;
  }

  /**
   * Create advisory object
   */
  _createAdvisory({ type, title, reasoning, impact, risk, confidence, data }) {
    return {
      id: `adv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      title,
      reasoning,
      impact,
      risk,
      confidence,
      data,
      status: "pending", // pending | approved | rejected | expired
      autoExecutable: confidence >= this.autoExecuteThreshold / 100,
      createdAt: Date.now(),
      respondedAt: null,
    };
  }

  /**
   * Approve an advisory
   */
  approve(advisoryId) {
    const advisory = this.advisories.find((a) => a.id === advisoryId);
    if (advisory) {
      advisory.status = "approved";
      advisory.respondedAt = Date.now();
      this._save();
      return advisory;
    }
    return null;
  }

  /**
   * Reject an advisory
   */
  reject(advisoryId) {
    const advisory = this.advisories.find((a) => a.id === advisoryId);
    if (advisory) {
      advisory.status = "rejected";
      advisory.respondedAt = Date.now();
      this._save();
      return advisory;
    }
    return null;
  }

  /**
   * Get pending advisories
   */
  getPending() {
    // Expire old ones (>24h)
    const now = Date.now();
    for (const a of this.advisories) {
      if (a.status === "pending" && now - a.createdAt > 86400000) {
        a.status = "expired";
      }
    }
    return this.advisories.filter((a) => a.status === "pending");
  }

  /**
   * Get all advisories
   */
  getAll(limit = 50) {
    return this.advisories.slice(-limit);
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.advisories = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        if (!Array.isArray(this.advisories)) this.advisories = [];
      }
    } catch (error) {
      this.advisories = [];
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.advisories, null, 2), "utf8");
    } catch (error) {
      console.warn(`[AdvisoryManager] Save error: ${error.message}`);
    }
  }
}

module.exports = AdvisoryManager;
