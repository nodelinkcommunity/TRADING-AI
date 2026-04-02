/**
 * FLASHLOAN-AI: AI Engine
 * Combines all AI modules into a unified analysis engine
 * Provides scoring, market analysis, gas prediction, and risk assessment
 */

const { OpportunityScorer } = require("./opportunity-scorer");
const { WhaleTracker } = require("./whale-tracker");
const { MarketAnalyzer } = require("./market-analyzer");
const { GasPredictor } = require("./gas-predictor");
const { SandwichDetector } = require("./sandwich-detector");

class AIEngine {
  constructor(provider) {
    this.provider = provider;
    this.scorer = new OpportunityScorer();
    this.whaleTracker = new WhaleTracker(provider);
    this.marketAnalyzer = new MarketAnalyzer();
    this.gasPredictor = new GasPredictor(provider);
    this.sandwichDetector = new SandwichDetector(provider);
    this.isRunning = false;
    this.gasInterval = null;
    this.recentAnalyses = []; // Last 10 scored opportunities
    this.maxRecentAnalyses = 10;
  }

  /**
   * Initialize the AI engine and start background tasks
   */
  async initialize() {
    try {
      console.log("[AI] AI Engine initializing...");
      this.isRunning = true;
      this._startBackgroundTasks();
      console.log("[AI] AI Engine ready");
    } catch (error) {
      console.warn("[AI] AI Engine init warning:", error.message);
      // Don't throw - AI is optional, bot should still work
      this.isRunning = false;
    }
  }

  /**
   * Start background sampling and analysis tasks
   */
  _startBackgroundTasks() {
    // Gas sampling every 3 seconds
    this.gasInterval = setInterval(async () => {
      try {
        await this.gasPredictor.sample();
      } catch (_) {}
    }, 3000);

    // Initial gas sample
    this.gasPredictor.sample().catch(() => {});
  }

  /**
   * Main AI analysis for an opportunity
   * Returns comprehensive analysis with score, recommendation, and reasoning
   */
  async analyze(opportunity, marketConditions) {
    try {
      marketConditions = marketConditions || {};

      // 1. Score the opportunity
      const score = this.scorer.score(opportunity, {
        gasPrice: marketConditions.gasPrice || 0,
        ...marketConditions,
      });
      const recommendation = this.scorer.getRecommendation(score);

      // 2. Check market regime
      const regime = this.marketAnalyzer.detectRegime();

      // 3. Predict gas
      const gasPrediction = this.gasPredictor.predict(30);

      // 4. Check sandwich risk
      const sandwichRisk = this.sandwichDetector.assessRisk({
        value: opportunity.flashAmount,
        slippage: marketConditions.maxSlippage || 50,
      });

      // 5. Whale activity context
      const whaleActivity = this.whaleTracker.analyzeActivity();

      // Determine if we should execute
      const shouldExecute =
        recommendation.action === "EXECUTE" &&
        gasPrediction.recommendation !== "WAIT" &&
        sandwichRisk.score < 70;

      const analysis = {
        score,
        recommendation,
        regime,
        gasPrediction,
        sandwichRisk,
        whaleActivity,
        shouldExecute,
        reasoning: this._generateReasoning(score, recommendation, regime, gasPrediction, sandwichRisk),
        timestamp: Date.now(),
        opportunityType: opportunity.type || "SIMPLE",
        profitBps: opportunity.profitBps || 0,
      };

      // Store for dashboard
      this.recentAnalyses.push(analysis);
      if (this.recentAnalyses.length > this.maxRecentAnalyses) {
        this.recentAnalyses.shift();
      }

      return analysis;
    } catch (error) {
      // Fallback analysis - don't block the bot
      return {
        score: 50,
        recommendation: { action: "WATCH", color: "yellow", emoji: "yellow" },
        regime: { regime: "UNKNOWN", volatility: 0, trend: 0, confidence: 0, bestStrategies: ["dexArbitrage"], riskLevel: { level: "UNKNOWN", score: 50, action: "CAUTIOUS" } },
        gasPrediction: { predicted: 0, current: 0, avg: 0, trend: "STABLE", confidence: 0, recommendation: "NORMAL" },
        sandwichRisk: { score: 0, factors: [], recommendation: "LOW_RISK" },
        whaleActivity: { totalVolume: 0, swapCount: 0, buyPressure: 50, sellPressure: 50, impactEstimate: "NONE" },
        shouldExecute: false,
        reasoning: "AI analysis unavailable - defaulting to WATCH",
        timestamp: Date.now(),
        opportunityType: opportunity ? opportunity.type : "UNKNOWN",
        profitBps: opportunity ? opportunity.profitBps : 0,
      };
    }
  }

  /**
   * Generate human-readable reasoning string
   */
  _generateReasoning(score, rec, regime, gas, sandwich) {
    const reasons = [];
    reasons.push("Score: " + score + "/100 (" + rec.action + ")");
    reasons.push("Market: " + regime.regime + " | Risk: " + regime.riskLevel.level);
    reasons.push("Gas: " + gas.trend + " | " + gas.recommendation);
    reasons.push("Sandwich risk: " + sandwich.score + "/100");
    return reasons.join(" | ");
  }

  /**
   * Record execution result for AI learning
   */
  recordResult(opportunity, result) {
    try {
      this.scorer.recordResult(opportunity, result);
    } catch (error) {
      // Silently ignore
    }
  }

  /**
   * Get AI status for dashboard
   */
  getStatus() {
    try {
      return {
        isRunning: this.isRunning,
        regime: this.marketAnalyzer.detectRegime(),
        gasPrediction: this.gasPredictor.predict(30),
        gasStats: this.gasPredictor.getStats(),
        scorerSummary: this.scorer.getSummary(),
        whaleActivity: this.whaleTracker.analyzeActivity(),
        sandwichSummary: this.sandwichDetector.getSummary(),
        recentAnalyses: this.recentAnalyses.slice(-10),
        trackedTokens: this.marketAnalyzer.getTrackedTokens(),
      };
    } catch (error) {
      return {
        isRunning: this.isRunning,
        error: error.message,
      };
    }
  }

  /**
   * Stop the AI engine and clean up
   */
  stop() {
    this.isRunning = false;
    if (this.gasInterval) {
      clearInterval(this.gasInterval);
      this.gasInterval = null;
    }
    this.whaleTracker.stop();
  }
}

module.exports = {
  AIEngine,
  OpportunityScorer,
  WhaleTracker,
  MarketAnalyzer,
  GasPredictor,
  SandwichDetector,
};
