/**
 * FLASHLOAN-AI: Telegram Bot Integration
 * Sends alerts and notifications via Telegram Bot API.
 */

const TelegramBot = require("node-telegram-bot-api");

class TelegramAlert {
  constructor() {
    this.bot = null;
    this.chatId = null;
    this.isReady = false;
  }

  async initialize(config) {
    try {
      this.chatId = config.chatId;

      // Polling mode disabled — we only send messages, no need to receive
      this.bot = new TelegramBot(config.botToken, { polling: false });

      // Verify connection
      const me = await this.bot.getMe();
      console.log(`[Telegram] Connected as @${me.username}`);
      this.isReady = true;
    } catch (error) {
      console.warn(`[Telegram] Init failed: ${error.message}`);
      this.isReady = false;
    }
  }

  /**
   * Send a formatted message
   * @param {object} formatted - { title, message, priority, time, type }
   */
  async send(formatted) {
    if (!this.isReady || !this.bot || !this.chatId) return;

    try {
      const text = this._buildMessage(formatted);
      await this.bot.sendMessage(this.chatId, text, { parse_mode: "HTML" });
    } catch (error) {
      console.warn(`[Telegram] Send error: ${error.message}`);
    }
  }

  _buildMessage(formatted) {
    const lines = [
      `<b>${formatted.title}</b>`,
      "",
      formatted.message,
      "",
      `<i>${formatted.time} UTC | ${formatted.priority}</i>`,
    ];

    // Add data details for certain types
    if (formatted.type === "TRADE_EXECUTED" && formatted.data) {
      const d = formatted.data;
      lines.splice(2, 0, ...[
        `Chain: ${d.chain || "?"}`,
        `DEX: ${d.dex || "?"}`,
        `TX: ${d.txHash ? `<a href="https://arbiscan.io/tx/${d.txHash}">${d.txHash.slice(0, 16)}...</a>` : "N/A"}`,
      ]);
    }

    return lines.join("\n");
  }

  async shutdown() {
    this.isReady = false;
    this.bot = null;
  }
}

module.exports = TelegramAlert;
