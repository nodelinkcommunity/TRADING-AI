/**
 * FLASHLOAN-AI: Enhanced Whale Tracker Plugin
 * Upgrades basic WhaleTracker with labeled wallets, accumulation detection,
 * impact prediction, and token-specific whale alerts.
 */

const { ethers } = require("ethers");
const BasePlugin = require("./base-plugin");

// Known DeFi whale/smart money labels (public data)
const LABELED_WALLETS = {
  // Major DeFi protocols & funds
  "0x28C6c06298d514Db089934071355E5743bf21d60": { label: "Binance Hot Wallet", type: "exchange" },
  "0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549": { label: "Binance Hot Wallet 2", type: "exchange" },
  "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d": { label: "Binance Hot Wallet 3", type: "exchange" },
  "0x56Eddb7aa87536c09CCc2793473599fD21A8b17F": { label: "Binance Deposit", type: "exchange" },
  "0x2FAF487A4414Fe77e2327F0bf4AE2a264a776AD2": { label: "FTX (Alameda)", type: "whale" },
  "0x0716a17FBAEe714f1E6aB0f9d59edbC5f09815C0": { label: "Jump Trading", type: "market_maker" },
  "0xA7A93fd0a276fc1C0197a5B5623eD117786eeD06": { label: "Cumberland DRW", type: "market_maker" },
  "0x1B3cB81E51011b549d78bf720b0d924ac763A7C2": { label: "Wintermute", type: "market_maker" },
  "0xdbF5E9c5206d0dB70a90108bf936DA60221dC080": { label: "Wintermute 2", type: "market_maker" },
  "0x46340b20830761efd32832A74d7169B29FEB9758": { label: "Celsius", type: "whale" },
  "0xBE0eB53F46cd790Cd13851d5EFf43D12404d33E8": { label: "Binance Cold", type: "exchange" },
};

// Whale thresholds by token (in USD equivalent)
const WHALE_THRESHOLDS = {
  default: 100000, // $100K
  stablecoin: 500000, // $500K for stablecoins
  eth: 50000, // $50K for ETH
};

class WhaleEnhancedPlugin extends BasePlugin {
  constructor() {
    super("whale-enhanced", "A");
    this._cacheTTL = 10000; // 10s cache
    this.provider = null;
    this.recentMoves = [];
    this.maxMoves = 1000;
    this.whaleProfiles = new Map(); // address -> profile
    this.accumulationTracker = new Map(); // address+token -> accumulation data
    this.latestData = {
      recentMoves: [],
      topWhales: [],
      accumulationSignals: [],
      distributionSignals: [],
      alertLevel: "NONE",
      impactEstimate: "NONE",
      timestamp: 0,
    };
    this.blockListener = null;
  }

  async initialize(config) {
    await super.initialize(config);
    this.provider = config.provider;
    this.chain = config.chain || "arbitrum";

    // Load labeled wallets
    for (const [address, info] of Object.entries(LABELED_WALLETS)) {
      this.whaleProfiles.set(address.toLowerCase(), {
        ...info,
        totalVolume: 0,
        tradeCount: 0,
        lastSeen: 0,
      });
    }

    console.log(`[Plugin:whale-enhanced] Tracking ${this.whaleProfiles.size} labeled wallets`);
  }

  /**
   * Fetch whale data — combines real-time monitoring + aggregation
   */
  async fetchData(chain) {
    // Start block monitoring if not already running
    if (!this.blockListener && this.provider) {
      this._startBlockMonitoring();
    }

    // Analyze recent moves
    this._analyzeRecentMoves();

    this.latestData.timestamp = Date.now();
    this.lastUpdate = Date.now();
    return this.latestData;
  }

  /**
   * Monitor new blocks for whale transactions
   */
  _startBlockMonitoring() {
    if (!this.provider) return;

    try {
      this.blockListener = async (blockNumber) => {
        try {
          const block = await this.provider.getBlock(blockNumber, true);
          if (!block || !block.transactions) return;

          // Check for compatible block format (some providers use prefetched txs)
          const txHashes = block.transactions;

          // Sample large transactions (check first 20 txs to avoid rate limits)
          const sampled = typeof txHashes[0] === "string"
            ? txHashes.slice(0, 20)
            : txHashes;

          for (const txOrHash of sampled) {
            try {
              const tx = typeof txOrHash === "string"
                ? await this.provider.getTransaction(txOrHash)
                : txOrHash;

              if (!tx) continue;

              const value = tx.value ? BigInt(tx.value) : 0n;
              const valueEth = Number(ethers.formatEther(value));

              // Whale threshold: 10+ ETH value
              if (valueEth >= 10) {
                this._recordWhaleMove(tx, valueEth, blockNumber);
              }

              // Check if sender/receiver is a known whale
              const fromLabel = this.whaleProfiles.get(tx.from?.toLowerCase());
              const toLabel = this.whaleProfiles.get(tx.to?.toLowerCase());

              if (fromLabel || toLabel) {
                this._recordWhaleMove(tx, valueEth, blockNumber, fromLabel || toLabel);
              }
            } catch (txError) {
              // Individual tx fetch error, skip
            }
          }
        } catch (blockError) {
          // Block fetch error, skip silently
        }
      };

      this.provider.on("block", this.blockListener);
      console.log("[Plugin:whale-enhanced] Block monitoring started");
    } catch (error) {
      console.warn(`[Plugin:whale-enhanced] Block monitoring failed: ${error.message}`);
    }
  }

  /**
   * Record a whale move
   */
  _recordWhaleMove(tx, valueEth, blockNumber, label = null) {
    const move = {
      txHash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: valueEth,
      blockNumber,
      timestamp: Date.now(),
      label: label?.label || null,
      type: label?.type || "unknown",
      direction: this._detectDirection(tx, label),
    };

    this.recentMoves.push(move);
    if (this.recentMoves.length > this.maxMoves) {
      this.recentMoves = this.recentMoves.slice(-this.maxMoves);
    }

    // Update whale profile
    const addr = tx.from?.toLowerCase();
    if (addr) {
      if (!this.whaleProfiles.has(addr) && valueEth >= 50) {
        // New whale discovered
        this.whaleProfiles.set(addr, {
          label: `Whale ${addr.slice(0, 8)}`,
          type: "whale",
          totalVolume: 0,
          tradeCount: 0,
          lastSeen: 0,
        });
      }
      const profile = this.whaleProfiles.get(addr);
      if (profile) {
        profile.totalVolume += valueEth;
        profile.tradeCount++;
        profile.lastSeen = Date.now();
      }
    }

    // Track accumulation/distribution
    this._trackAccumulation(move);
  }

  /**
   * Detect if move is buy/sell/transfer
   */
  _detectDirection(tx, label) {
    if (label?.type === "exchange") {
      // Sending TO exchange = SELL signal
      // Receiving FROM exchange = BUY signal
      if (tx.to?.toLowerCase() === Object.keys(LABELED_WALLETS).find(
        (k) => k.toLowerCase() === tx.to?.toLowerCase()
      )?.toLowerCase()) {
        return "DEPOSIT_TO_EXCHANGE"; // bearish
      }
      return "WITHDRAWAL_FROM_EXCHANGE"; // bullish
    }
    return "TRANSFER";
  }

  /**
   * Track accumulation/distribution patterns
   */
  _trackAccumulation(move) {
    const key = move.from?.toLowerCase();
    if (!key) return;

    if (!this.accumulationTracker.has(key)) {
      this.accumulationTracker.set(key, {
        buys: 0,
        sells: 0,
        netVolume: 0,
        firstSeen: Date.now(),
      });
    }

    const tracker = this.accumulationTracker.get(key);
    if (move.direction === "WITHDRAWAL_FROM_EXCHANGE") {
      tracker.buys++;
      tracker.netVolume += move.value;
    } else if (move.direction === "DEPOSIT_TO_EXCHANGE") {
      tracker.sells++;
      tracker.netVolume -= move.value;
    }
  }

  /**
   * Analyze recent moves and generate signals
   */
  _analyzeRecentMoves() {
    const now = Date.now();
    const fiveMin = 5 * 60 * 1000;
    const oneHour = 60 * 60 * 1000;

    // Recent 5-min moves
    const recentFiveMin = this.recentMoves.filter((m) => now - m.timestamp < fiveMin);
    const recentHour = this.recentMoves.filter((m) => now - m.timestamp < oneHour);

    // Total volume
    const totalVolumeHour = recentHour.reduce((sum, m) => sum + m.value, 0);
    const totalVolumeFiveMin = recentFiveMin.reduce((sum, m) => sum + m.value, 0);

    // Buy/sell pressure
    const buyMoves = recentHour.filter((m) => m.direction === "WITHDRAWAL_FROM_EXCHANGE");
    const sellMoves = recentHour.filter((m) => m.direction === "DEPOSIT_TO_EXCHANGE");
    const buyVolume = buyMoves.reduce((sum, m) => sum + m.value, 0);
    const sellVolume = sellMoves.reduce((sum, m) => sum + m.value, 0);

    // Accumulation signals
    const accumulationSignals = [];
    const distributionSignals = [];

    for (const [addr, data] of this.accumulationTracker) {
      if (data.netVolume > 100 && data.buys >= 3) {
        accumulationSignals.push({
          address: addr,
          label: this.whaleProfiles.get(addr)?.label || `Whale ${addr.slice(0, 8)}`,
          netVolume: data.netVolume,
          buys: data.buys,
          period: now - data.firstSeen,
        });
      } else if (data.netVolume < -100 && data.sells >= 3) {
        distributionSignals.push({
          address: addr,
          label: this.whaleProfiles.get(addr)?.label || `Whale ${addr.slice(0, 8)}`,
          netVolume: data.netVolume,
          sells: data.sells,
          period: now - data.firstSeen,
        });
      }
    }

    // Determine alert level
    let alertLevel = "NONE";
    if (totalVolumeFiveMin > 500) alertLevel = "EXTREME";
    else if (totalVolumeFiveMin > 200) alertLevel = "HIGH";
    else if (totalVolumeFiveMin > 50) alertLevel = "MEDIUM";
    else if (totalVolumeFiveMin > 10) alertLevel = "LOW";

    // Impact estimate
    let impactEstimate = "NONE";
    if (buyVolume > sellVolume * 3) impactEstimate = "STRONG_BUY_PRESSURE";
    else if (buyVolume > sellVolume * 1.5) impactEstimate = "BUY_PRESSURE";
    else if (sellVolume > buyVolume * 3) impactEstimate = "STRONG_SELL_PRESSURE";
    else if (sellVolume > buyVolume * 1.5) impactEstimate = "SELL_PRESSURE";
    else impactEstimate = "NEUTRAL";

    // Top whales by recent activity
    const topWhales = Array.from(this.whaleProfiles.entries())
      .filter(([, p]) => p.lastSeen > now - oneHour)
      .sort((a, b) => b[1].totalVolume - a[1].totalVolume)
      .slice(0, 10)
      .map(([addr, profile]) => ({
        address: addr,
        label: profile.label,
        type: profile.type,
        totalVolume: profile.totalVolume,
        tradeCount: profile.tradeCount,
        lastSeen: profile.lastSeen,
      }));

    this.latestData = {
      recentMoves: recentFiveMin.slice(-20), // Last 20 moves in 5 min
      totalVolumeHour,
      totalVolumeFiveMin,
      buyVolume,
      sellVolume,
      buyPressure: buyMoves.length,
      sellPressure: sellMoves.length,
      topWhales,
      accumulationSignals: accumulationSignals.slice(0, 5),
      distributionSignals: distributionSignals.slice(0, 5),
      alertLevel,
      impactEstimate,
      trackedWallets: this.whaleProfiles.size,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if an address is a known whale
   */
  isKnownWhale(address) {
    return this.whaleProfiles.has(address?.toLowerCase());
  }

  /**
   * Get whale label
   */
  getWhaleLabel(address) {
    return this.whaleProfiles.get(address?.toLowerCase())?.label || null;
  }

  /**
   * Add a new address to track
   */
  addWatchAddress(address, label, type = "whale") {
    this.whaleProfiles.set(address.toLowerCase(), {
      label,
      type,
      totalVolume: 0,
      tradeCount: 0,
      lastSeen: 0,
    });
  }

  getLatestData() {
    return this.latestData;
  }

  async shutdown() {
    if (this.blockListener && this.provider) {
      this.provider.off("block", this.blockListener);
      this.blockListener = null;
    }
    await super.shutdown();
  }
}

module.exports = WhaleEnhancedPlugin;
