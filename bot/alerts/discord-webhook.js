/**
 * FLASHLOAN-AI: Discord Webhook Integration
 * Sends alerts via Discord webhook embeds.
 */

const axios = require("axios");

class DiscordAlert {
  constructor() {
    this.webhookUrl = null;
    this.isReady = false;
  }

  async initialize(config) {
    this.webhookUrl = config.webhookUrl;
    if (this.webhookUrl && this.webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
      this.isReady = true;
      console.log("[Discord] Webhook configured");
    } else {
      console.warn("[Discord] Invalid webhook URL");
      this.isReady = false;
    }
  }

  /**
   * Send a formatted message as Discord embed
   * @param {object} formatted - { title, message, priority, time, type }
   */
  async send(formatted) {
    if (!this.isReady || !this.webhookUrl) return;

    try {
      const embed = this._buildEmbed(formatted);
      await axios.post(this.webhookUrl, {
        username: "FLASHLOAN-AI",
        embeds: [embed],
      }, { timeout: 10000 });
    } catch (error) {
      console.warn(`[Discord] Send error: ${error.message}`);
    }
  }

  _buildEmbed(formatted) {
    const colors = {
      CRITICAL: 0xFF0000, // Red
      HIGH: 0xFF8C00,     // Orange
      MEDIUM: 0x3498DB,   // Blue
      LOW: 0x2ECC71,      // Green
    };

    const embed = {
      title: formatted.title,
      description: formatted.message,
      color: colors[formatted.priority] || colors.MEDIUM,
      timestamp: new Date().toISOString(),
      footer: {
        text: `FLASHLOAN-AI | ${formatted.priority}`,
      },
    };

    // Add fields for trade data
    if (formatted.type === "TRADE_EXECUTED" && formatted.data) {
      const d = formatted.data;
      embed.fields = [
        { name: "Chain", value: d.chain || "?", inline: true },
        { name: "DEX", value: d.dex || "?", inline: true },
        { name: "Profit", value: `$${d.profit?.toFixed(2) || "?"}`, inline: true },
      ];
      if (d.txHash) {
        embed.fields.push({ name: "TX", value: `[View](https://arbiscan.io/tx/${d.txHash})`, inline: false });
      }
    }

    if (formatted.type === "DAILY_SUMMARY" && formatted.data) {
      const d = formatted.data;
      embed.fields = [
        { name: "Trades", value: `${d.totalTrades || 0}`, inline: true },
        { name: "Win Rate", value: `${d.winRate || "N/A"}`, inline: true },
        { name: "Net Profit", value: `$${d.netProfit?.toFixed(2) || "0"}`, inline: true },
      ];
    }

    return embed;
  }

  async shutdown() {
    this.isReady = false;
  }
}

module.exports = DiscordAlert;
