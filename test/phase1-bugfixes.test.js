/**
 * Phase 1 Bug Fix Verification Tests
 * Tests ONLY the 5 bugs fixed in this phase.
 */

const { expect } = require("chai");

describe("Phase 1 Bug Fixes", function () {

  describe("BUG #1: CorrelationRisk blocks high concentration", function () {
    const CorrelationRisk = require("../bot/risk/correlation-risk");

    it("should return allowed=false when token concentration > threshold", function () {
      const cr = new CorrelationRisk();
      cr.initialize({ maxExposurePerToken: 0.3, maxConcurrentTotal: 10, maxConcurrentPerPool: 3 });

      // Simulate 10 recent trades, 8 involving same token
      const token = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // USDC
      for (let i = 0; i < 10; i++) {
        cr.recentTrades.push({
          tokenIn: i < 8 ? token : "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
          tokenOut: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
          timestamp: Date.now(),
          completedAt: Date.now(),
        });
      }

      const result = cr.check({ tokenIn: token, tokenOut: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" });
      expect(result.allowed).to.equal(false);
      expect(result.reason).to.include("concentration");
    });

    it("should return allowed=true when concentration is within limits", function () {
      const cr = new CorrelationRisk();
      cr.initialize({ maxExposurePerToken: 0.3, maxConcurrentTotal: 10, maxConcurrentPerPool: 3 });

      // 2 trades for token A, 8 for various others = 20% concentration (under 30%)
      for (let i = 0; i < 10; i++) {
        cr.recentTrades.push({
          tokenIn: "0x" + i.toString().padStart(40, "0"),
          tokenOut: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
          timestamp: Date.now(),
          completedAt: Date.now(),
        });
      }

      const result = cr.check({ tokenIn: "0x0000000000000000000000000000000000000000", tokenOut: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" });
      expect(result.allowed).to.equal(true);
    });
  });

  describe("BUG #2: RiskEngine fail-closed when not initialized", function () {
    const RiskEngine = require("../bot/risk/risk-engine");

    it("should return allowed=false when not initialized", function () {
      const re = new RiskEngine();
      // Do NOT call initialize()
      const result = re.assess({}, {});
      expect(result.allowed).to.equal(false);
    });
  });

  describe("BUG #3: OpportunityScorer uses weights", function () {
    const { OpportunityScorer } = require("../bot/ai/opportunity-scorer");

    it("should return score between 0 and 100", function () {
      const scorer = new OpportunityScorer();
      const opportunity = {
        profitBps: 50,
        flashAmount: 50000n * 10n ** 18n,
        steps: [{ dex: "uniswapV3" }, { dex: "sushiswap" }],
        tokenIn: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      };
      const market = { gasPrice: 500000000n, avgGas: 300000000n };
      const score = scorer.score(opportunity, market);
      expect(score).to.be.a("number");
      expect(score).to.be.at.least(0);
      expect(score).to.be.at.most(100);
    });

    it("should score higher profit opportunities higher", function () {
      const scorer = new OpportunityScorer();
      const base = {
        steps: [{ dex: "uniswapV3" }],
        flashAmount: 50000n * 10n ** 18n,
        tokenIn: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      };
      const market = { gasPrice: 500000000n, avgGas: 300000000n };

      const lowProfit = scorer.score({ ...base, profitBps: 5 }, market);
      const highProfit = scorer.score({ ...base, profitBps: 100 }, market);
      expect(highProfit).to.be.greaterThan(lowProfit);
    });
  });

  describe("BUG #4: WhaleTracker cleans up accumulation", function () {
    const { WhaleTracker } = require("../bot/ai/whale-tracker");

    it("should have a cleanup method for accumulation tracker", function () {
      const wt = new WhaleTracker();
      expect(wt._cleanupAccumulation).to.be.a("function");
    });

    it("should remove entries older than 2 hours", function () {
      const wt = new WhaleTracker();
      // Manually add old entry
      const oldTime = Date.now() - 3 * 3600 * 1000; // 3 hours ago
      wt.accumulationTracker = wt.accumulationTracker || new Map();
      wt.accumulationTracker.set("0xOLD", { lastSeen: oldTime, count: 5 });
      wt.accumulationTracker.set("0xNEW", { lastSeen: Date.now(), count: 2 });

      wt._cleanupAccumulation();
      expect(wt.accumulationTracker.has("0xOLD")).to.equal(false);
      expect(wt.accumulationTracker.has("0xNEW")).to.equal(true);
    });
  });

  describe("BUG #5: GasPredictor uses actual sample interval", function () {
    const { GasPredictor } = require("../bot/ai/gas-predictor");

    it("should track sample interval", function () {
      const gp = new GasPredictor();
      expect(gp).to.have.property("sampleIntervalSec");
    });
  });

});
