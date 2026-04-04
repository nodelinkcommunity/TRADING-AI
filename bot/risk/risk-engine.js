/**
 * FLASHLOAN-AI: Risk Engine
 * Orchestrates all risk management components:
 * - Position Sizer
 * - Circuit Breaker
 * - Correlation Risk
 * - Blacklist Detector
 * - Audit Trail
 */

const PositionSizer = require("./position-sizer");
const CircuitBreaker = require("./circuit-breaker");
const CorrelationRisk = require("./correlation-risk");
const BlacklistDetector = require("./blacklist-detector");
const AuditTrail = require("./audit-trail");

class RiskEngine {
  constructor() {
    this.positionSizer = new PositionSizer();
    this.circuitBreaker = new CircuitBreaker();
    this.correlationRisk = new CorrelationRisk();
    this.blacklistDetector = new BlacklistDetector();
    this.auditTrail = new AuditTrail();
    this.riskLevel = "balanced"; // conservative | balanced | aggressive
    this.isInitialized = false;
  }

  /**
   * Initialize all risk components
   */
  async initialize(config) {
    const riskConfig = config.risk || {};
    this.riskLevel = config.ai?.riskLevel || "balanced";

    this.positionSizer.initialize({
      ...riskConfig,
      riskLevel: this.riskLevel,
    });

    this.circuitBreaker.initialize(riskConfig.circuitBreaker || {});
    this.correlationRisk.initialize(riskConfig);
    this.blacklistDetector.initialize(config);
    this.auditTrail.initialize();

    this.isInitialized = true;
    console.log(`[RiskEngine] Initialized (risk level: ${this.riskLevel})`);
  }

  /**
   * Full risk assessment for an opportunity
   * @param {object} opportunity - The arbitrage opportunity
   * @param {object} marketState - Current market state
   * @returns {object} Risk assessment with allow/deny + reasoning
   */
  assess(opportunity, marketState) {
    if (!this.isInitialized) {
      return { allowed: false, reasoning: "Risk engine not initialized", adjustments: {} };
    }

    const assessment = {
      allowed: true,
      reasons: [],
      adjustments: {},
      riskScore: 0, // 0-100, higher = riskier
    };

    // 1. Circuit breaker check
    const cbStatus = this.circuitBreaker.check();
    if (!cbStatus.allowed) {
      assessment.allowed = false;
      assessment.reasons.push(`Circuit breaker: ${cbStatus.reason}`);
      assessment.riskScore = 100;
      this._logDecision("CIRCUIT_BREAKER_BLOCK", opportunity, assessment, marketState);
      return assessment;
    }

    // 2. Blacklist check
    const tokens = this._extractTokens(opportunity);
    for (const token of tokens) {
      if (this.blacklistDetector.isBlacklisted(token)) {
        assessment.allowed = false;
        assessment.reasons.push(`Token ${token.slice(0, 10)}... is blacklisted`);
        assessment.riskScore = 100;
        this._logDecision("BLACKLIST_BLOCK", opportunity, assessment, marketState);
        return assessment;
      }
    }

    // 3. Correlation risk check
    const corrCheck = this.correlationRisk.check(opportunity);
    if (!corrCheck.allowed) {
      assessment.allowed = false;
      assessment.reasons.push(`Correlation risk: ${corrCheck.reason}`);
      assessment.riskScore = 80;
      this._logDecision("CORRELATION_BLOCK", opportunity, assessment, marketState);
      return assessment;
    }
    if (corrCheck.adjustments) {
      Object.assign(assessment.adjustments, corrCheck.adjustments);
    }

    // 4. Position sizing
    const sizing = this.positionSizer.calculate(opportunity, marketState);
    assessment.adjustments.maxFlashAmount = sizing.maxFlashAmount;
    assessment.adjustments.sizingReason = sizing.reason;

    if (opportunity.flashAmount && sizing.maxFlashAmount) {
      const requested = typeof opportunity.flashAmount === "bigint"
        ? Number(opportunity.flashAmount / 10n ** 12n) / 1e6 // rough USD conversion
        : Number(opportunity.flashAmount);

      if (requested > sizing.maxFlashAmount) {
        assessment.adjustments.flashAmountReduced = true;
        assessment.reasons.push(`Position reduced: ${sizing.reason}`);
      }
    }

    // 5. Calculate overall risk score
    let riskScore = 0;

    // Market volatility adds risk
    if (marketState?.market?.volatility > 0.05) riskScore += 20;
    else if (marketState?.market?.volatility > 0.02) riskScore += 10;

    // Whale activity adds risk
    const whaleAlert = marketState?.whales?.alertLevel || "NONE";
    if (whaleAlert === "EXTREME") riskScore += 25;
    else if (whaleAlert === "HIGH") riskScore += 15;
    else if (whaleAlert === "MEDIUM") riskScore += 5;

    // Low profit margin = higher risk
    const profitBps = opportunity.profitBps || 0;
    if (profitBps < 20) riskScore += 20;
    else if (profitBps < 50) riskScore += 10;

    // Gas trend
    if (marketState?.market?.gasTrend === "RISING") riskScore += 10;

    // Historical bad hour
    const worstHours = marketState?.historical?.worstHours || [];
    const currentHour = new Date().getUTCHours();
    if (worstHours.includes(currentHour)) riskScore += 10;

    assessment.riskScore = Math.min(100, riskScore);

    // Apply risk level thresholds
    const maxAllowedRisk = {
      conservative: 40,
      balanced: 60,
      aggressive: 80,
    };

    if (assessment.riskScore > (maxAllowedRisk[this.riskLevel] || 60)) {
      assessment.allowed = false;
      assessment.reasons.push(`Risk score ${assessment.riskScore} exceeds ${this.riskLevel} threshold`);
    }

    this._logDecision(
      assessment.allowed ? "ALLOW" : "RISK_BLOCK",
      opportunity, assessment, marketState
    );

    return assessment;
  }

  /**
   * Record trade result for risk tracking
   */
  recordResult(opportunity, result) {
    this.circuitBreaker.recordResult(result);
    this.correlationRisk.recordResult(opportunity, result);

    this.auditTrail.record({
      type: "TRADE_RESULT",
      opportunity: this._summarizeOpportunity(opportunity),
      result: {
        success: result.success,
        profit: result.profit,
        gasUsed: result.gasUsed,
        error: result.error,
      },
      timestamp: Date.now(),
    });
  }

  /**
   * Add token to blacklist
   */
  blacklistToken(address, reason) {
    this.blacklistDetector.addToBlacklist(address, reason);
  }

  /**
   * Set risk level
   */
  setRiskLevel(level) {
    if (["conservative", "balanced", "aggressive"].includes(level)) {
      this.riskLevel = level;
      this.positionSizer.setRiskLevel(level);
      console.log(`[RiskEngine] Risk level set to: ${level}`);
    }
  }

  /**
   * Get full risk status for dashboard
   */
  getStatus() {
    return {
      riskLevel: this.riskLevel,
      circuitBreaker: this.circuitBreaker.getStatus(),
      correlationRisk: this.correlationRisk.getStatus(),
      blacklistedTokens: this.blacklistDetector.getBlacklistCount(),
      recentDecisions: this.auditTrail.getRecent(10),
      positionSizer: this.positionSizer.getStatus(),
    };
  }

  /**
   * Log a risk decision to audit trail
   */
  _logDecision(type, opportunity, assessment, marketState) {
    this.auditTrail.record({
      type,
      opportunity: this._summarizeOpportunity(opportunity),
      assessment: {
        allowed: assessment.allowed,
        riskScore: assessment.riskScore,
        reasons: assessment.reasons,
        adjustments: assessment.adjustments,
      },
      marketSummary: marketState ? {
        regime: marketState.market?.regime,
        whaleAlert: marketState.whales?.alertLevel,
        gasPrice: marketState.market?.gasPrice,
      } : null,
      timestamp: Date.now(),
    });
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

  _summarizeOpportunity(opportunity) {
    return {
      type: opportunity.type,
      tokenIn: opportunity.tokenIn?.slice(0, 10),
      profitBps: opportunity.profitBps,
      flashAmount: opportunity.flashAmount?.toString(),
      dex: opportunity.steps?.[0]?.dex,
    };
  }
}

module.exports = RiskEngine;
