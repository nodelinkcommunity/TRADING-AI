/**
 * FLASHLOAN-AI: Whale Tracker
 * Track large wallet movements in the mempool and recent blocks
 * Detect whale swaps that may create arbitrage opportunities
 */

const { ethers } = require("ethers");

class WhaleTracker {
  constructor(provider) {
    this.provider = provider;
    this.whaleThreshold = ethers.parseEther("10"); // 10+ ETH value swaps
    this.recentSwaps = [];
    this.maxSwaps = 500;
    this.knownWhales = new Set();
    this.isMonitoring = false;
    this._listeners = [];
    this.accumulationTracker = new Map();
  }

  /**
   * Monitor pending transactions for large swaps
   * Listens for pending transactions and filters for large DEX router calls
   */
  async startMonitoring(dexRouters) {
    if (this.isMonitoring) return;
    this.isMonitoring = true;

    const routerAddresses = (dexRouters || []).map(r => r.toLowerCase());

    try {
      // Listen for new blocks and check for large transfers
      const blockHandler = async (blockNumber) => {
        try {
          const block = await this.provider.getBlock(blockNumber, true);
          if (!block || !block.transactions) return;

          for (const txHash of block.transactions) {
            try {
              const tx = typeof txHash === "string"
                ? await this.provider.getTransaction(txHash)
                : txHash;

              if (!tx || !tx.to || !tx.value) continue;

              const toAddr = tx.to.toLowerCase();

              // Check if transaction is to a known DEX router
              const isDexSwap = routerAddresses.length > 0
                ? routerAddresses.includes(toAddr)
                : false;

              // Check if transaction value exceeds whale threshold
              const isLargeValue = tx.value >= this.whaleThreshold;

              if (isLargeValue || isDexSwap) {
                const swap = {
                  txHash: tx.hash,
                  from: tx.from,
                  to: tx.to,
                  value: tx.value.toString(),
                  valueEth: parseFloat(ethers.formatEther(tx.value)),
                  isDexSwap,
                  blockNumber,
                  timestamp: Date.now(),
                };

                this.recentSwaps.push(swap);
                if (this.recentSwaps.length > this.maxSwaps) {
                  this.recentSwaps.shift();
                }

                if (isLargeValue) {
                  this.knownWhales.add(tx.from.toLowerCase());
                }
              }
            } catch (_) {
              // Skip individual tx errors silently
            }
          }
        } catch (_) {
          // Skip block processing errors silently
        }
      };

      this.provider.on("block", blockHandler);
      this._listeners.push({ event: "block", handler: blockHandler });
    } catch (error) {
      console.warn("[WhaleTracker] Failed to start monitoring:", error.message);
      this.isMonitoring = false;
    }
  }

  /**
   * Clean up accumulation entries older than 2 hours
   */
  _cleanupAccumulation() {
    const cutoff = Date.now() - 2 * 3600 * 1000; // 2 hours
    for (const [key, data] of this.accumulationTracker.entries()) {
      if (data.lastSeen < cutoff) {
        this.accumulationTracker.delete(key);
      }
    }
  }

  /**
   * Track accumulation patterns for a whale address
   */
  _trackAccumulation(swap) {
    if (!swap || !swap.from) return;
    const key = swap.from.toLowerCase();
    const existing = this.accumulationTracker.get(key) || { count: 0, totalValue: 0, lastSeen: 0 };
    existing.count++;
    existing.totalValue += swap.valueEth || 0;
    existing.lastSeen = Date.now();
    this.accumulationTracker.set(key, existing);
  }

  /**
   * Analyze recent whale activity
   */
  analyzeActivity() {
    try {
      // Clean up old accumulation entries to prevent memory leak
      this._cleanupAccumulation();
      const now = Date.now();
      const last5min = this.recentSwaps.filter(s => now - s.timestamp < 300000);
      const last1min = this.recentSwaps.filter(s => now - s.timestamp < 60000);

      if (last5min.length === 0) {
        return {
          totalVolume: 0,
          swapCount: 0,
          buyPressure: 50,
          sellPressure: 50,
          topWhales: [],
          recentCount1m: 0,
          recentCount5m: 0,
          impactEstimate: "NONE",
        };
      }

      // Calculate total volume
      const totalVolume = last5min.reduce((sum, s) => sum + s.valueEth, 0);

      // Count unique whales
      const whaleAddresses = [...new Set(last5min.map(s => s.from.toLowerCase()))];

      // Estimate buy/sell pressure (simplified: based on DEX interaction patterns)
      const dexSwaps = last5min.filter(s => s.isDexSwap);
      const nonDexSwaps = last5min.filter(s => !s.isDexSwap);
      const buyPressure = dexSwaps.length > 0
        ? Math.round((dexSwaps.length / last5min.length) * 100)
        : 50;

      // Estimate market impact
      let impactEstimate = "LOW";
      if (totalVolume > 1000) impactEstimate = "EXTREME";
      else if (totalVolume > 100) impactEstimate = "HIGH";
      else if (totalVolume > 10) impactEstimate = "MEDIUM";

      return {
        totalVolume: Math.round(totalVolume * 100) / 100,
        swapCount: last5min.length,
        buyPressure,
        sellPressure: 100 - buyPressure,
        topWhales: whaleAddresses.slice(0, 5),
        recentCount1m: last1min.length,
        recentCount5m: last5min.length,
        impactEstimate,
      };
    } catch (error) {
      return {
        totalVolume: 0,
        swapCount: 0,
        buyPressure: 50,
        sellPressure: 50,
        topWhales: [],
        recentCount1m: 0,
        recentCount5m: 0,
        impactEstimate: "NONE",
      };
    }
  }

  /**
   * Check if a whale swap just created an arb opportunity
   * Large swap on DEX A -> price shifted -> check DEX B for arb
   */
  detectOpportunity(swap) {
    try {
      if (!swap || !swap.isDexSwap) return null;

      // If a large swap happened, it likely moved the price on that DEX
      // This creates a potential arb between that DEX and others
      if (swap.valueEth >= 10) {
        return {
          trigger: "WHALE_SWAP",
          txHash: swap.txHash,
          whale: swap.from,
          value: swap.valueEth,
          router: swap.to,
          timestamp: swap.timestamp,
          suggestion: "Large swap detected. Check price divergence across DEXs.",
        };
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get whale count
   */
  getKnownWhaleCount() {
    return this.knownWhales.size;
  }

  /**
   * Stop monitoring
   */
  stop() {
    this.isMonitoring = false;
    for (const listener of this._listeners) {
      try {
        this.provider.off(listener.event, listener.handler);
      } catch (_) {}
    }
    this._listeners = [];
  }
}

module.exports = { WhaleTracker };
