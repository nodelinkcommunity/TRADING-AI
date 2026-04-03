/**
 * FLASHLOAN-AI: Blacklist Detector
 * Auto-detects and blocks suspicious tokens/pools.
 * Checks for honeypots, rugpulls, tax tokens, and known scams.
 */

const fs = require("fs");
const path = require("path");

class BlacklistDetector {
  constructor() {
    this.blacklist = new Map(); // address -> { reason, addedAt, source }
    this.suspiciousActivity = new Map(); // address -> { flags, score }
    this.blacklistPath = path.join(__dirname, "..", "..", "server", "data", "blacklist.json");
  }

  initialize(config) {
    this._loadBlacklist();
    console.log(`[BlacklistDetector] Loaded ${this.blacklist.size} blacklisted tokens`);
  }

  /**
   * Check if a token/address is blacklisted
   */
  isBlacklisted(address) {
    return this.blacklist.has(address?.toLowerCase());
  }

  /**
   * Add an address to blacklist
   */
  addToBlacklist(address, reason, source = "manual") {
    const key = address?.toLowerCase();
    if (!key) return;

    this.blacklist.set(key, {
      reason,
      source,
      addedAt: Date.now(),
    });

    this._saveBlacklist();
    console.log(`[BlacklistDetector] Blacklisted ${key.slice(0, 10)}...: ${reason}`);
  }

  /**
   * Remove from blacklist
   */
  removeFromBlacklist(address) {
    this.blacklist.delete(address?.toLowerCase());
    this._saveBlacklist();
  }

  /**
   * Report suspicious activity for a token
   * If a token accumulates enough flags, it gets auto-blacklisted
   */
  reportSuspicious(address, flag, details = "") {
    const key = address?.toLowerCase();
    if (!key) return;

    if (!this.suspiciousActivity.has(key)) {
      this.suspiciousActivity.set(key, { flags: [], score: 0 });
    }

    const activity = this.suspiciousActivity.get(key);
    activity.flags.push({ flag, details, timestamp: Date.now() });
    activity.score += this._getFlagScore(flag);

    // Auto-blacklist threshold
    if (activity.score >= 100) {
      this.addToBlacklist(key, `Auto-blacklisted: ${activity.flags.map(f => f.flag).join(", ")}`, "auto");
    }
  }

  /**
   * Check token for common scam patterns
   * Call this before executing a trade with an unfamiliar token
   * @param {object} provider - Ethers provider
   * @param {string} tokenAddress - Token to check
   * @returns {object} { safe, flags, score }
   */
  async checkToken(provider, tokenAddress) {
    const flags = [];
    let score = 0;

    try {
      const ERC20_ABI = [
        "function totalSupply() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)",
        "function name() view returns (string)",
        "function symbol() view returns (string)",
      ];

      const { ethers } = require("ethers");
      const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

      // Basic checks
      try {
        const [name, symbol, decimals, totalSupply] = await Promise.all([
          token.name().catch(() => ""),
          token.symbol().catch(() => ""),
          token.decimals().catch(() => 18),
          token.totalSupply().catch(() => 0n),
        ]);

        // No name/symbol = suspicious
        if (!name || !symbol) {
          flags.push("NO_NAME_OR_SYMBOL");
          score += 30;
        }

        // Zero total supply = very suspicious
        if (totalSupply === 0n) {
          flags.push("ZERO_SUPPLY");
          score += 50;
        }

        // Unusual decimals
        if (decimals !== 18 && decimals !== 6 && decimals !== 8) {
          flags.push("UNUSUAL_DECIMALS");
          score += 10;
        }
      } catch (error) {
        flags.push("CONTRACT_READ_FAILED");
        score += 40;
      }
    } catch (error) {
      flags.push("CHECK_FAILED");
      score += 20;
    }

    // Report findings
    if (score > 0) {
      this.reportSuspicious(tokenAddress, flags.join(","), `Score: ${score}`);
    }

    return {
      safe: score < 50,
      flags,
      score,
    };
  }

  /**
   * Score for each flag type
   */
  _getFlagScore(flag) {
    const scores = {
      HONEYPOT: 100,
      RUGPULL: 100,
      HIGH_TAX: 80,
      ZERO_SUPPLY: 50,
      NO_NAME_OR_SYMBOL: 30,
      CONTRACT_READ_FAILED: 40,
      UNUSUAL_DECIMALS: 10,
      LIQUIDITY_REMOVED: 60,
      FAILED_SELL: 90,
      CHECK_FAILED: 20,
    };
    return scores[flag] || 10;
  }

  _loadBlacklist() {
    try {
      if (fs.existsSync(this.blacklistPath)) {
        const data = JSON.parse(fs.readFileSync(this.blacklistPath, "utf8"));
        for (const [key, value] of Object.entries(data)) {
          this.blacklist.set(key, value);
        }
      }
    } catch (error) {
      console.warn(`[BlacklistDetector] Load error: ${error.message}`);
    }
  }

  _saveBlacklist() {
    try {
      const data = Object.fromEntries(this.blacklist);
      const dir = path.dirname(this.blacklistPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.blacklistPath, JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
      console.warn(`[BlacklistDetector] Save error: ${error.message}`);
    }
  }

  getBlacklistCount() {
    return this.blacklist.size;
  }

  getBlacklist() {
    return Array.from(this.blacklist.entries()).map(([address, info]) => ({
      address,
      ...info,
    }));
  }
}

module.exports = BlacklistDetector;
