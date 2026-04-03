/**
 * FLASHLOAN-AI: AI Engine v2
 * Unified AI orchestrator integrating:
 * - Original modules: Scorer, WhaleTracker, MarketAnalyzer, GasPredictor, SandwichDetector
 * - NEW: Data Plugins (Pool Liquidity, Historical Patterns, Enhanced Whale)
 * - NEW: MarketState aggregator
 * - NEW: Risk Engine
 * - NEW: Autonomous Manager (auto-adjust params)
 * - NEW: Advisory Manager (strategic recommendations)
 * - NEW: Alert Dispatcher (Telegram/Discord)
 * - NEW: Backtesting (Replay, Historical, A/B)
 */

const { OpportunityScorer } = require("./opportunity-scorer");
const { WhaleTracker } = require("./whale-tracker");
const { MarketAnalyzer } = require("./market-analyzer");
const { GasPredictor } = require("./gas-predictor");
const { SandwichDetector } = require("./sandwich-detector");

// NEW Phase A modules
const PluginManager = require("../data-plugins/plugin-manager");
const MarketState = require("../data-plugins/market-state");
const RiskEngine = require("../risk/risk-engine");
const AutonomousManager = require("./autonomous-manager");
const AdvisoryManager = require("./advisory-manager");
const AlertDispatcher = require("../alerts/alert-dispatcher");
const ReplayEngine = require("../backtesting/replay-engine");
const HistoricalBacktester = require("../backtesting/historical-backtester");
const ABTester = require("../backtesting/ab-tester");

class AIEngine {
  constructor(provider) {
    this.provider = provider;

    // Original modules
    this.scorer = new OpportunityScorer();
    this.whaleTracker = new WhaleTracker(provider);
    this.marketAnalyzer = new MarketAnalyzer();
    this.gasPredictor = new GasPredictor(provider);
    this.sandwichDetector = new SandwichDetector(provider);

    // NEW Phase A modules
    this.pluginManager = new PluginManager();
    this.marketState = new MarketState();
    this.riskEngine = new RiskEngine();
    this.autonomousManager = new AutonomousManager();
    this.advisoryManager = new AdvisoryManager();
    this.alertDispatcher = new AlertDispatcher();
    this.replayEngine = new ReplayEngine();
    this.historicalBacktester = new HistoricalBacktester();
    this.abTester = new ABTester();

    // State
    this.isRunning = false;
    this.gasInterval = null;
    this.marketStateInterval = null;
    this.advisoryInterval = null;
    this.recentAnalyses = [];
    this.maxRecentAnalyses = 50;
    this.config = {};
  }

  /**
   * Initialize the AI engine and all sub-modules
   * @param {object} config - Full app config (optional, for Phase A modules)
   */
  async initialize(config) {
    try {
      this.config = config || {};
      console.log("[AI] AI Engine v2 initializing...");

      // Start original background tasks
      this.isRunning = true;
      this._startBackgroundTasks();

      // Initialize Phase A modules (non-blocking)
      await this._initializePhaseA(config);

      console.log("[AI] AI Engine v2 ready (Phase A enabled)");
    } catch (error) {
      console.warn("[AI] AI Engine init warning:", error.message);
      this.isRunning = false;
    }
  }

  /**
   * Initialize Phase A modules
   */
  async _initializePhaseA(config) {
    if (!config) return;

    try {
      // Data plugins
      await this.pluginManager.initialize(config, this.provider);
      const chain = config.chain || "arbitrum";
      this.pluginManager.startUpdateLoops(chain);
      console.log("[AI] Data plugins started");

      // Risk engine
      await this.riskEngine.initialize(config);
      console.log("[AI] Risk engine started");

      // Autonomous manager
      this.autonomousManager.initialize(config);
      console.log("[AI] Autonomous manager started");

      // Advisory manager
      this.advisoryManager.initialize(config);
      console.log("[AI] Advisory manager started");

      // Alert dispatcher
      await this.alertDispatcher.initialize(config);
      console.log("[AI] Alert dispatcher started");

      // MarketState update loop (every 15 seconds)
      this.marketStateInterval = setInterval(() => {
        this._updateMarketState();
      }, 15000);

      // Advisory analysis loop (every 5 minutes)
      this.advisoryInterval = setInterval(() => {
        try {
          this.advisoryManager.analyze(this.marketState.getState());
        } catch (e) {
          // Silently ignore
        }
      }, 300000);

      // Initial market state update
      setTimeout(() => this._updateMarketState(), 5000);
    } catch (error) {
      console.warn("[AI] Phase A init warning:", error.message);
    }
  }

  /**
   * Start background sampling tasks
   */
  _startBackgroundTasks() {
    // Gas sampling every 3 seconds
    this.gasInterval = setInterval(async () => {
      try {
        await this.gasPredictor.sample();
      } catch (_) {}
    }, 3000);

    this.gasPredictor.sample().catch(() => {});
  }

  /**
   * Update MarketState from all data sources
   */
  async _updateMarketState() {
    try {
      const pluginData = await this.pluginManager.getAllData();
      const regime = this.marketAnalyzer.detectRegime();
      const gasPrediction = this.gasPredictor.predict(30);

      this.marketState.update(pluginData, {
        regime,
        gas: gasPrediction,
      });
    } catch (error) {
      // Silently ignore update errors
    }
  }

  /**
   * Main AI analysis for an opportunity — ENHANCED with Phase A data
   * @param {object} opportunity - The arbitrage opportunity
   * @param {object} marketConditions - Market conditions from bot
   * @returns {object} Comprehensive analysis
   */
  async analyze(opportunity, marketConditions) {
    try {
      marketConditions = marketConditions || {};
      const mState = this.marketState.getState();

      // 1. Score the opportunity (enhanced with market state data)
      const enrichedConditions = {
        gasPrice: marketConditions.gasPrice || mState.market?.gasPrice || 0,
        regime: mState.market?.regime,
        volatility: mState.market?.volatility,
        whaleAlert: mState.whales?.alertLevel,
        poolHealth: this._getPoolHealthForOpportunity(opportunity),
        historicalWinRate: this._getHistoricalWinRate(opportunity),
        ...marketConditions,
      };

      const score = this.scorer.score(opportunity, enrichedConditions);
      const recommendation = this.scorer.getRecommendation(score);

      // 2. Market regime
      const regime = this.marketAnalyzer.detectRegime();

      // 3. Gas prediction
      const gasPrediction = this.gasPredictor.predict(30);

      // 4. Sandwich risk
      const sandwichRisk = this.sandwichDetector.assessRisk({
        value: opportunity.flashAmount,
        slippage: marketConditions.maxSlippage || 50,
      });

      // 5. Whale activity
      const whaleActivity = this.whaleTracker.analyzeActivity();

      // 6. Risk engine assessment (NEW)
      const riskAssessment = this.riskEngine.assess(opportunity, mState);

      // 7. Autonomous parameter adjustments (NEW)
      const adjustedParams = this.autonomousManager.adjustParams(mState);

      // Determine if we should execute (enhanced logic)
      const shouldExecute =
        recommendation.action === "EXECUTE" &&
        gasPrediction.recommendation !== "WAIT" &&
        sandwichRisk.score < 70 &&
        riskAssessment.allowed;

      // Get market signals
      const signals = this.marketState.getActionableSignals();
      const sentiment = this.marketState.getMarketSentiment();

      const analysis = {
        score,
        recommendation,
        regime,
        gasPrediction,
        sandwichRisk,
        whaleActivity,
        riskAssessment,
        adjustedParams,
        shouldExecute,
        reasoning: this._generateReasoning(score, recommendation, regime, gasPrediction, sandwichRisk, riskAssessment),
        signals: signals.slice(0, 5),
        sentiment,
        timestamp: Date.now(),
        opportunityType: opportunity.type || "SIMPLE",
        profitBps: opportunity.profitBps || 0,
      };

      // Store for dashboard
      this.recentAnalyses.push(analysis);
      if (this.recentAnalyses.length > this.maxRecentAnalyses) {
        this.recentAnalyses.shift();
      }

      // Store opportunity for backtesting replay
      try {
        const histPlugin = this.pluginManager.getPlugin("historical-patterns");
        if (histPlugin) {
          histPlugin.storeOpportunity(opportunity, false, null, shouldExecute);
        }
      } catch (_) {}

      // A/B test evaluation
      if (this.abTester.isRunning) {
        this.abTester.evaluate(opportunity);
      }

      // Alert on high-confidence opportunities
      if (score >= 85 && shouldExecute) {
        this.alertDispatcher.highConfidenceOpportunity(opportunity, score).catch(() => {});
      }

      return analysis;
    } catch (error) {
      // Fallback analysis
      return {
        score: 50,
        recommendation: { action: "WATCH", color: "yellow", emoji: "yellow" },
        regime: { regime: "UNKNOWN", volatility: 0, trend: 0, confidence: 0, bestStrategies: ["dexArbitrage"], riskLevel: { level: "UNKNOWN", score: 50, action: "CAUTIOUS" } },
        gasPrediction: { predicted: 0, current: 0, avg: 0, trend: "STABLE", confidence: 0, recommendation: "NORMAL" },
        sandwichRisk: { score: 0, factors: [], recommendation: "LOW_RISK" },
        whaleActivity: { totalVolume: 0, swapCount: 0, buyPressure: 50, sellPressure: 50, impactEstimate: "NONE" },
        riskAssessment: { allowed: true, reasons: [], riskScore: 0 },
        adjustedParams: {},
        shouldExecute: false,
        reasoning: "AI analysis unavailable - defaulting to WATCH",
        signals: [],
        sentiment: 0,
        timestamp: Date.now(),
        opportunityType: opportunity ? opportunity.type : "UNKNOWN",
        profitBps: opportunity ? opportunity.profitBps : 0,
      };
    }
  }

  /**
   * Get pool health score for an opportunity
   */
  _getPoolHealthForOpportunity(opportunity) {
    try {
      const poolPlugin = this.pluginManager.getPlugin("pool-liquidity");
      if (!poolPlugin) return null;

      // Try to find pool by token pair
      const tokenA = opportunity.steps?.[0]?.tokenIn;
      const tokenB = opportunity.steps?.[0]?.tokenOut;
      if (tokenA && tokenB) {
        const pools = poolPlugin.getTopPoolsForPair(tokenA, tokenB);
        return pools?.[0]?.healthScore || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get historical win rate for similar opportunities
   */
  _getHistoricalWinRate(opportunity) {
    try {
      const histPlugin = this.pluginManager.getPlugin("historical-patterns");
      if (!histPlugin) return null;

      const data = histPlugin.getLatestData();
      const dex = opportunity.steps?.[0]?.dex;
      if (dex && data.dexPatterns?.[dex]) {
        return data.dexPatterns[dex].winRate;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Generate human-readable reasoning string (enhanced)
   */
  _generateReasoning(score, rec, regime, gas, sandwich, risk) {
    const reasons = [];
    reasons.push(`Score: ${score}/100 (${rec.action})`);
    reasons.push(`Market: ${regime.regime} | Risk: ${regime.riskLevel.level}`);
    reasons.push(`Gas: ${gas.trend} | ${gas.recommendation}`);
    reasons.push(`Sandwich: ${sandwich.score}/100`);
    if (risk) {
      reasons.push(`Risk: ${risk.riskScore}/100 ${risk.allowed ? "PASS" : "BLOCKED"}`);
      if (risk.reasons.length > 0) {
        reasons.push(`(${risk.reasons.join(", ")})`);
      }
    }
    return reasons.join(" | ");
  }

  /**
   * Record execution result for learning
   */
  recordResult(opportunity, result) {
    try {
      this.scorer.recordResult(opportunity, result);
      this.riskEngine.recordResult(opportunity, result);

      // Alert on trade execution
      if (result.success) {
        this.alertDispatcher.tradeExecuted({
          pair: `${opportunity.tokenIn?.slice(0, 8) || "?"}`,
          profit: result.profit,
          gasCost: result.gasCost,
          txHash: result.txHash,
          chain: this.config.chain,
          dex: opportunity.steps?.[0]?.dex,
        }).catch(() => {});
      }

      // Alert on circuit breaker
      const cbStatus = this.riskEngine.circuitBreaker.getStatus();
      if (cbStatus.tripped) {
        this.alertDispatcher.circuitBreakerTripped(cbStatus.tripReason).catch(() => {});
      }
    } catch (error) {
      // Silently ignore
    }
  }

  /**
   * Get comprehensive AI status for dashboard
   */
  getStatus() {
    try {
      return {
        isRunning: this.isRunning,
        version: "2.0 (Phase A)",

        // Original modules
        regime: this.marketAnalyzer.detectRegime(),
        gasPrediction: this.gasPredictor.predict(30),
        gasStats: this.gasPredictor.getStats(),
        scorerSummary: this.scorer.getSummary(),
        whaleActivity: this.whaleTracker.analyzeActivity(),
        sandwichSummary: this.sandwichDetector.getSummary(),
        recentAnalyses: this.recentAnalyses.slice(-10),
        trackedTokens: this.marketAnalyzer.getTrackedTokens(),

        // Phase A modules
        marketState: this.marketState.getSummary(),
        marketSignals: this.marketState.getActionableSignals(),
        marketSentiment: this.marketState.getMarketSentiment(),
        pluginHealth: this.pluginManager.getHealthStatus(),
        riskStatus: this.riskEngine.getStatus(),
        autonomousStatus: this.autonomousManager.getStatus(),
        pendingAdvisories: this.advisoryManager.getPending(),
        alertStatus: this.alertDispatcher.getStatus(),
        abTestStatus: this.abTester.getStatus(),
      };
    } catch (error) {
      return {
        isRunning: this.isRunning,
        error: error.message,
      };
    }
  }

  // ============ Public API for Server Routes ============

  /** Get full market state */
  getMarketState() {
    return this.marketState.getState();
  }

  /** Get risk status */
  getRiskStatus() {
    return this.riskEngine.getStatus();
  }

  /** Get advisories */
  getAdvisories(limit) {
    return this.advisoryManager.getAll(limit);
  }

  /** Get pending advisories */
  getPendingAdvisories() {
    return this.advisoryManager.getPending();
  }

  /** Approve advisory */
  approveAdvisory(id) {
    return this.advisoryManager.approve(id);
  }

  /** Reject advisory */
  rejectAdvisory(id) {
    return this.advisoryManager.reject(id);
  }

  /** Get audit trail */
  getAuditTrail(params) {
    return this.riskEngine.auditTrail.query(params || { limit: 50 });
  }

  /** Run replay backtest */
  async runReplay(params) {
    return this.replayEngine.replay(params);
  }

  /** Run parameter sweep */
  async runParameterSweep(params) {
    return this.replayEngine.parameterSweep(params);
  }

  /** Run historical backtest */
  async runHistoricalBacktest(params) {
    return this.historicalBacktester.run(params);
  }

  /** List backtest results */
  listBacktests() {
    return {
      replays: this.replayEngine.listResults(),
      historical: this.historicalBacktester.listResults(),
    };
  }

  /** Get backtest result by ID */
  getBacktestResult(id) {
    return this.historicalBacktester.getResult(id);
  }

  /** Start A/B test */
  startABTest(params) {
    return this.abTester.start(params);
  }

  /** Stop A/B test */
  stopABTest() {
    return this.abTester.stop();
  }

  /** Get A/B test status */
  getABTestStatus() {
    return this.abTester.getStatus();
  }

  /** Update alert config */
  async updateAlertConfig(config) {
    return this.alertDispatcher.updateConfig(config);
  }

  /** Send test alert */
  async sendTestAlert() {
    return this.alertDispatcher.sendTestAlert();
  }

  /** Set risk level */
  setRiskLevel(level) {
    this.riskEngine.setRiskLevel(level);
    if (this.autonomousManager) this.autonomousManager.riskLevel = level;
  }

  /** Get plugin health */
  getPluginHealth() {
    return this.pluginManager.getHealthStatus();
  }

  /** Reset circuit breaker */
  resetCircuitBreaker() {
    this.riskEngine.circuitBreaker.manualReset();
  }

  /**
   * Stop the AI engine and all modules
   */
  async stop() {
    this.isRunning = false;

    if (this.gasInterval) {
      clearInterval(this.gasInterval);
      this.gasInterval = null;
    }
    if (this.marketStateInterval) {
      clearInterval(this.marketStateInterval);
      this.marketStateInterval = null;
    }
    if (this.advisoryInterval) {
      clearInterval(this.advisoryInterval);
      this.advisoryInterval = null;
    }

    this.whaleTracker.stop();
    this.autonomousManager.stop();

    await this.pluginManager.stop();
    await this.alertDispatcher.shutdown();
    this.riskEngine.auditTrail.shutdown();

    console.log("[AI] AI Engine v2 stopped");
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
