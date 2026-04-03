/**
 * FLASHLOAN-AI: Alert Dispatcher
 * Unified alert routing to Telegram, Discord, or both.
 * Rate limiting, priority levels, quiet hours support.
 */

const TelegramAlert = require("./telegram-bot");
const DiscordAlert = require("./discord-webhook");

const PRIORITY_LEVELS = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

class AlertDispatcher {
  constructor() {
    this.telegram = null;
    this.discord = null;
    this.config = {};
    this.rateLimitMap = new Map(); // key -> last sent timestamp
    this.rateLimitMs = 300000; // 5 min between same alert type
    this.alertHistory = [];
    this.maxHistory = 500;
    this.isInitialized = false;
  }

  /**
   * Initialize alert channels
   */
  async initialize(config) {
    this.config = config.alerts || {};

    // Telegram
    if (this.config.telegram?.enabled && this.config.telegram?.botToken && this.config.telegram?.chatId) {
      this.telegram = new TelegramAlert();
      await this.telegram.initialize(this.config.telegram);
      console.log("[AlertDispatcher] Telegram enabled");
    }

    // Discord
    if (this.config.discord?.enabled && this.config.discord?.webhookUrl) {
      this.discord = new DiscordAlert();
      await this.discord.initialize(this.config.discord);
      console.log("[AlertDispatcher] Discord enabled");
    }

    this.minPriority = this.config.minPriority || "MEDIUM";
    this.quietHours = this.config.quietHours || { enabled: false };

    this.isInitialized = true;
    const channels = [this.telegram && "Telegram", this.discord && "Discord"].filter(Boolean);
    console.log(`[AlertDispatcher] Initialized: ${channels.join(", ") || "No channels configured"}`);
  }

  /**
   * Send an alert
   * @param {object} alert - { type, title, message, priority, data }
   */
  async send(alert) {
    if (!this.isInitialized) return;

    const { type, title, message, priority = "MEDIUM", data } = alert;

    // Priority filter
    if (PRIORITY_LEVELS[priority] > PRIORITY_LEVELS[this.minPriority]) {
      return;
    }

    // Quiet hours filter (except CRITICAL)
    if (priority !== "CRITICAL" && this._isQuietHours()) {
      return;
    }

    // Rate limiting (except CRITICAL)
    if (priority !== "CRITICAL" && this._isRateLimited(type)) {
      return;
    }

    // Format message
    const formatted = this._formatMessage(alert);

    // Send to all enabled channels
    const results = await Promise.allSettled([
      this.telegram ? this.telegram.send(formatted) : Promise.resolve(),
      this.discord ? this.discord.send(formatted) : Promise.resolve(),
    ]);

    // Log
    this.alertHistory.push({
      type,
      title,
      priority,
      timestamp: Date.now(),
      channels: {
        telegram: results[0]?.status === "fulfilled",
        discord: results[1]?.status === "fulfilled",
      },
    });
    if (this.alertHistory.length > this.maxHistory) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistory);
    }

    // Update rate limit
    this.rateLimitMap.set(type, Date.now());
  }

  // ============ Convenience Methods ============

  /**
   * Trade executed alert
   */
  async tradeExecuted(trade) {
    await this.send({
      type: "TRADE_EXECUTED",
      title: "Trade Executed",
      message: `Profit: $${trade.profit?.toFixed(2) || "?"} | Gas: $${trade.gasCost?.toFixed(2) || "?"} | Pool: ${trade.pair || "?"}`,
      priority: trade.profit > 10 ? "HIGH" : "MEDIUM",
      data: trade,
    });
  }

  /**
   * High-confidence opportunity
   */
  async highConfidenceOpportunity(opportunity, score) {
    await this.send({
      type: "HIGH_CONFIDENCE",
      title: "High-Confidence Opportunity",
      message: `Score: ${score}/100 | Profit: ${opportunity.profitBps} bps | ${opportunity.type}`,
      priority: score >= 90 ? "HIGH" : "MEDIUM",
      data: { opportunity, score },
    });
  }

  /**
   * Circuit breaker tripped
   */
  async circuitBreakerTripped(reason) {
    await this.send({
      type: "CIRCUIT_BREAKER",
      title: "Circuit Breaker Tripped",
      message: reason,
      priority: "CRITICAL",
    });
  }

  /**
   * Whale alert
   */
  async whaleAlert(whaleData) {
    await this.send({
      type: "WHALE_ALERT",
      title: "Whale Movement Detected",
      message: `Alert Level: ${whaleData.alertLevel} | Volume: ${whaleData.totalVolumeFiveMin?.toFixed(0)} ETH in 5min | Impact: ${whaleData.impactEstimate}`,
      priority: whaleData.alertLevel === "EXTREME" ? "HIGH" : "MEDIUM",
      data: whaleData,
    });
  }

  /**
   * Advisory recommendation
   */
  async advisoryCreated(advisory) {
    await this.send({
      type: "ADVISORY",
      title: `AI Recommendation: ${advisory.title}`,
      message: `${advisory.reasoning}\nConfidence: ${(advisory.confidence * 100).toFixed(0)}% | Risk: ${advisory.risk}`,
      priority: advisory.confidence > 0.8 ? "MEDIUM" : "LOW",
      data: advisory,
    });
  }

  /**
   * Daily summary
   */
  async dailySummary(stats) {
    await this.send({
      type: "DAILY_SUMMARY",
      title: "Daily Performance Summary",
      message: [
        `Trades: ${stats.totalTrades || 0}`,
        `Win Rate: ${stats.winRate || "N/A"}`,
        `Profit: $${stats.totalProfit?.toFixed(2) || "0"}`,
        `Gas Cost: $${stats.totalGas?.toFixed(2) || "0"}`,
        `Net: $${stats.netProfit?.toFixed(2) || "0"}`,
      ].join("\n"),
      priority: "LOW",
      data: stats,
    });
  }

  /**
   * Test alert
   */
  async sendTestAlert() {
    await this.send({
      type: "TEST",
      title: "Test Alert",
      message: "FLASHLOAN-AI alert system is working correctly!",
      priority: "LOW",
    });
  }

  // ============ Internal Methods ============

  _formatMessage(alert) {
    const priorityEmojis = {
      CRITICAL: "\u{1F6A8}",
      HIGH: "\u{1F525}",
      MEDIUM: "\u{1F4CA}",
      LOW: "\u{2139}\u{FE0F}",
    };
    const emoji = priorityEmojis[alert.priority] || "";
    const time = new Date().toISOString().slice(11, 19);

    return {
      title: `${emoji} ${alert.title}`,
      message: alert.message,
      priority: alert.priority,
      time,
      type: alert.type,
      data: alert.data,
    };
  }

  _isQuietHours() {
    if (!this.quietHours?.enabled) return false;

    const now = new Date();
    const hour = now.getUTCHours();
    const start = parseInt(this.quietHours.start?.split(":")[0] || 23);
    const end = parseInt(this.quietHours.end?.split(":")[0] || 7);

    if (start > end) {
      return hour >= start || hour < end;
    }
    return hour >= start && hour < end;
  }

  _isRateLimited(type) {
    const lastSent = this.rateLimitMap.get(type);
    if (!lastSent) return false;
    return Date.now() - lastSent < this.rateLimitMs;
  }

  /**
   * Get alert history
   */
  getHistory(limit = 50) {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      telegramEnabled: !!this.telegram,
      discordEnabled: !!this.discord,
      minPriority: this.minPriority,
      quietHours: this.quietHours,
      totalAlertsSent: this.alertHistory.length,
      recentAlerts: this.alertHistory.slice(-5),
    };
  }

  /**
   * Update configuration
   */
  async updateConfig(newConfig) {
    await this.initialize({ alerts: newConfig });
  }

  async shutdown() {
    if (this.telegram) await this.telegram.shutdown();
    if (this.discord) await this.discord.shutdown();
  }
}

module.exports = AlertDispatcher;
