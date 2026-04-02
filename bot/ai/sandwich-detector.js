/**
 * FLASHLOAN-AI: Sandwich Attack Detector
 * Detect and avoid sandwich attacks on pending transactions
 * Analyzes transaction data to assess the risk of being sandwiched
 */

const { ethers } = require("ethers");

class SandwichDetector {
  constructor(provider) {
    this.provider = provider;
    this.suspiciousPatterns = [];
    this.knownAttackers = new Set();
    this.maxPatterns = 200;
  }

  /**
   * Analyze if our pending tx might get sandwiched
   * Returns a risk assessment with score 0-100
   */
  assessRisk(txData) {
    try {
      const risk = {
        score: 0,
        factors: [],
        recommendation: "",
      };

      if (!txData) {
        risk.recommendation = "LOW_RISK: No transaction data to assess";
        return risk;
      }

      // Factor 1: Transaction size (larger = more attractive target)
      const value = txData.value || 0;
      const valueNum = typeof value === "bigint" ? Number(value) : Number(value);
      const valueEth = valueNum / 1e18;

      if (valueEth > 100) {
        risk.score += 30;
        risk.factors.push("Very large transaction (>100 ETH equivalent)");
      } else if (valueEth > 10) {
        risk.score += 20;
        risk.factors.push("Large transaction (>10 ETH equivalent)");
      } else if (valueEth > 1) {
        risk.score += 10;
        risk.factors.push("Medium transaction (>1 ETH equivalent)");
      } else {
        risk.factors.push("Small transaction - less attractive target");
      }

      // Factor 2: Slippage tolerance (higher = more extractable)
      const slippage = txData.slippage || 50; // bps
      if (slippage > 100) {
        risk.score += 25;
        risk.factors.push("High slippage tolerance (>" + slippage + " bps)");
      } else if (slippage > 50) {
        risk.score += 15;
        risk.factors.push("Moderate slippage tolerance (" + slippage + " bps)");
      } else {
        risk.score += 5;
        risk.factors.push("Tight slippage tolerance (" + slippage + " bps)");
      }

      // Factor 3: Known attacker addresses active
      if (this.knownAttackers.size > 0) {
        risk.score += 10;
        risk.factors.push(this.knownAttackers.size + " known attackers tracked");
      }

      // Factor 4: Recent suspicious patterns
      const recentPatterns = this.suspiciousPatterns.filter(
        p => Date.now() - p.timestamp < 600000 // last 10 minutes
      );
      if (recentPatterns.length > 3) {
        risk.score += 15;
        risk.factors.push(recentPatterns.length + " suspicious patterns in last 10 min");
      } else if (recentPatterns.length > 0) {
        risk.score += 5;
        risk.factors.push(recentPatterns.length + " suspicious pattern(s) detected recently");
      }

      // Cap score at 100
      risk.score = Math.min(100, risk.score);

      // Generate recommendation
      if (risk.score > 70) {
        risk.recommendation = "HIGH_RISK: Consider using Flashbots or reducing size";
      } else if (risk.score > 40) {
        risk.recommendation = "MEDIUM_RISK: Reduce slippage tolerance";
      } else {
        risk.recommendation = "LOW_RISK: Safe to proceed";
      }

      return risk;
    } catch (error) {
      return {
        score: 0,
        factors: ["Unable to assess risk"],
        recommendation: "LOW_RISK: Assessment failed, defaulting to safe",
      };
    }
  }

  /**
   * Learn from a detected sandwich attack
   */
  recordAttack(frontrunTx, victimTx, backrunTx) {
    try {
      if (frontrunTx && frontrunTx.from) {
        this.knownAttackers.add(frontrunTx.from.toLowerCase());
      }

      this.suspiciousPatterns.push({
        frontrun: frontrunTx ? frontrunTx.hash : null,
        victim: victimTx ? victimTx.hash : null,
        backrun: backrunTx ? backrunTx.hash : null,
        attacker: frontrunTx ? frontrunTx.from : null,
        timestamp: Date.now(),
      });

      if (this.suspiciousPatterns.length > this.maxPatterns) {
        this.suspiciousPatterns.shift();
      }
    } catch (error) {
      // Silently ignore
    }
  }

  /**
   * Check if an address is a known attacker
   */
  isKnownAttacker(address) {
    if (!address) return false;
    return this.knownAttackers.has(address.toLowerCase());
  }

  /**
   * Get summary for dashboard
   */
  getSummary() {
    return {
      knownAttackers: this.knownAttackers.size,
      recentPatterns: this.suspiciousPatterns.filter(
        p => Date.now() - p.timestamp < 600000
      ).length,
      totalPatterns: this.suspiciousPatterns.length,
    };
  }
}

module.exports = { SandwichDetector };
