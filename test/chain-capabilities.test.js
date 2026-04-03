/**
 * Unit tests for config/chain-capabilities.js
 * Verifies the single-source-of-truth capability matrix.
 */

const { expect } = require("chai");
const { CHAIN_CAPABILITIES, getCapabilities, supportsStrategy, getSupportedChains } = require("../config/chain-capabilities");

describe("Chain Capabilities", function () {

  describe("CHAIN_CAPABILITIES matrix", function () {
    it("should have entries for mainnet chains", function () {
      expect(CHAIN_CAPABILITIES).to.have.property("arbitrum");
      expect(CHAIN_CAPABILITIES).to.have.property("base");
      expect(CHAIN_CAPABILITIES).to.have.property("polygon");
      expect(CHAIN_CAPABILITIES).to.have.property("bsc");
    });

    it("should have entries for testnet chains", function () {
      expect(CHAIN_CAPABILITIES).to.have.property("arbitrumSepolia");
      expect(CHAIN_CAPABILITIES).to.have.property("baseSepolia");
    });

    it("should only allow liquidation on chains with Aave V3 + CHAIN_CONFIG", function () {
      // Only arbitrum and base have full liquidation support
      expect(CHAIN_CAPABILITIES.arbitrum.liquidation).to.equal(true);
      expect(CHAIN_CAPABILITIES.base.liquidation).to.equal(true);

      // Testnets and other chains should NOT support liquidation
      expect(CHAIN_CAPABILITIES.arbitrumSepolia.liquidation).to.equal(false);
      expect(CHAIN_CAPABILITIES.polygon.liquidation).to.equal(false);
      expect(CHAIN_CAPABILITIES.bsc.liquidation).to.equal(false);
    });

    it("should only allow stablecoin on chains with registries", function () {
      expect(CHAIN_CAPABILITIES.arbitrum.stablecoin).to.equal(true);
      expect(CHAIN_CAPABILITIES.base.stablecoin).to.equal(true);

      expect(CHAIN_CAPABILITIES.arbitrumSepolia.stablecoin).to.equal(false);
      expect(CHAIN_CAPABILITIES.polygon.stablecoin).to.equal(false);
    });

    it("should allow arbitrage on all chains", function () {
      for (const [chain, caps] of Object.entries(CHAIN_CAPABILITIES)) {
        expect(caps.arbitrage, `${chain} should support arbitrage`).to.equal(true);
      }
    });
  });

  describe("getCapabilities()", function () {
    it("should return capabilities for known chains", function () {
      const arb = getCapabilities("arbitrum");
      expect(arb.arbitrage).to.equal(true);
      expect(arb.liquidation).to.equal(true);
      expect(arb.stablecoin).to.equal(true);
    });

    it("should return all-false for unknown chains", function () {
      const unknown = getCapabilities("someFakeChain");
      expect(unknown.arbitrage).to.equal(false);
      expect(unknown.liquidation).to.equal(false);
      expect(unknown.stablecoin).to.equal(false);
    });
  });

  describe("supportsStrategy()", function () {
    it("should return true for supported combos", function () {
      expect(supportsStrategy("arbitrum", "liquidation")).to.equal(true);
      expect(supportsStrategy("base", "stablecoin")).to.equal(true);
      expect(supportsStrategy("arbitrumSepolia", "arbitrage")).to.equal(true);
    });

    it("should return false for unsupported combos", function () {
      expect(supportsStrategy("arbitrumSepolia", "liquidation")).to.equal(false);
      expect(supportsStrategy("bsc", "stablecoin")).to.equal(false);
      expect(supportsStrategy("unknownChain", "arbitrage")).to.equal(false);
    });
  });

  describe("getSupportedChains()", function () {
    it("should return only chains supporting liquidation", function () {
      const liqChains = getSupportedChains("liquidation");
      expect(liqChains).to.include("arbitrum");
      expect(liqChains).to.include("base");
      expect(liqChains).to.not.include("arbitrumSepolia");
      expect(liqChains).to.not.include("bsc");
    });

    it("should return only chains supporting stablecoin", function () {
      const stableChains = getSupportedChains("stablecoin");
      expect(stableChains).to.include("arbitrum");
      expect(stableChains).to.include("base");
      expect(stableChains).to.not.include("polygon");
    });

    it("should return all chains for arbitrage", function () {
      const arbChains = getSupportedChains("arbitrage");
      expect(arbChains.length).to.equal(Object.keys(CHAIN_CAPABILITIES).length);
    });
  });
});
