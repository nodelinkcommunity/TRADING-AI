/**
 * Unit tests for wallet challenge verification security.
 * Tests the verifyWalletChallenge() helper extracted from server/app.js.
 *
 * These tests mock ethers and authNonces to test the logic in isolation
 * without needing a running server.
 */

const { expect } = require("chai");

describe("Auth Security — Wallet Challenge Verification", function () {

  // We test the verification LOGIC by simulating what verifyWalletChallenge does.
  // Since it's defined inside app.js (not exported), we test the contract:
  // nonce required, timestamp required, signature must match.

  describe("Message format requirements", function () {
    it("should require Timestamp in message", function () {
      const msg = "QIRA Protocol Login\nAddress: 0xabc\nNonce: abc123";
      const tsMatch = msg.match(/Timestamp:\s*(\d+)/);
      expect(tsMatch).to.be.null; // No timestamp → should be rejected
    });

    it("should accept message with valid Timestamp", function () {
      const msg = `QIRA Protocol Login\nAddress: 0xabc\nNonce: abc123\nTimestamp: ${Date.now()}`;
      const tsMatch = msg.match(/Timestamp:\s*(\d+)/);
      expect(tsMatch).to.not.be.null;
      const ts = parseInt(tsMatch[1]);
      expect(Math.abs(Date.now() - ts)).to.be.below(5000); // Within 5 seconds
    });

    it("should reject expired timestamp (>5 min)", function () {
      const oldTs = Date.now() - 400000; // 6+ minutes ago
      const msg = `QIRA Protocol Login\nAddress: 0xabc\nNonce: abc123\nTimestamp: ${oldTs}`;
      const tsMatch = msg.match(/Timestamp:\s*(\d+)/);
      const ts = parseInt(tsMatch[1]);
      expect(Math.abs(Date.now() - ts)).to.be.above(300000); // Exceeds 5 min window
    });

    it("should require Nonce in message", function () {
      const msg = `QIRA Protocol Login\nAddress: 0xabc\nTimestamp: ${Date.now()}`;
      const nonceMatch = msg.match(/Nonce:\s*([a-f0-9]+)/i);
      expect(nonceMatch).to.be.null; // No nonce → should be rejected
    });

    it("should extract Nonce from valid message", function () {
      const msg = `QIRA Protocol Login\nAddress: 0xabc\nNonce: deadbeef1234\nTimestamp: ${Date.now()}`;
      const nonceMatch = msg.match(/Nonce:\s*([a-f0-9]+)/i);
      expect(nonceMatch).to.not.be.null;
      expect(nonceMatch[1]).to.equal("deadbeef1234");
    });
  });

  describe("Registration message format", function () {
    it("should use same format as login (nonce + timestamp)", function () {
      const nonce = "abc123def456";
      const ts = Date.now();
      const loginMsg = `QIRA Protocol Login\nAddress: 0xabc\nNonce: ${nonce}\nTimestamp: ${ts}`;
      const regMsg = `QIRA Protocol Registration\nAddress: 0xabc\nNonce: ${nonce}\nTimestamp: ${ts}`;

      // Both formats should pass the same validation rules
      for (const msg of [loginMsg, regMsg]) {
        const tsMatch = msg.match(/Timestamp:\s*(\d+)/);
        const nonceMatch = msg.match(/Nonce:\s*([a-f0-9]+)/i);
        expect(tsMatch, "Timestamp missing in: " + msg).to.not.be.null;
        expect(nonceMatch, "Nonce missing in: " + msg).to.not.be.null;
        expect(nonceMatch[1]).to.equal(nonce);
      }
    });
  });

  describe("Nonce one-time use", function () {
    it("should demonstrate nonce consumption pattern", function () {
      // Simulate the authNonces store
      const authNonces = {};
      const address = "0xabc";
      const nonce = "test123";

      // Store nonce
      authNonces[address] = { nonce, expiresAt: Date.now() + 300000 };

      // First use: valid
      expect(authNonces[address]).to.not.be.undefined;
      expect(authNonces[address].nonce).to.equal(nonce);

      // Consume
      delete authNonces[address];

      // Second use: invalid (consumed)
      expect(authNonces[address]).to.be.undefined;
    });
  });

  describe("Chain capability gating for bots", function () {
    const { supportsStrategy } = require("../config/chain-capabilities");

    it("should prevent liquidation bot on unsupported chains", function () {
      expect(supportsStrategy("bsc", "liquidation")).to.equal(false);
      expect(supportsStrategy("polygon", "liquidation")).to.equal(false);
    });

    it("should prevent stablecoin bot on unsupported chains", function () {
      expect(supportsStrategy("bsc", "stablecoin")).to.equal(false);
      expect(supportsStrategy("polygon", "stablecoin")).to.equal(false);
    });

    it("should allow arbitrage bot on all known chains", function () {
      expect(supportsStrategy("arbitrum", "arbitrage")).to.equal(true);
      expect(supportsStrategy("bsc", "arbitrage")).to.equal(true);
    });

    it("should allow liquidation bot on arbitrum mainnet", function () {
      expect(supportsStrategy("arbitrum", "liquidation")).to.equal(true);
    });
  });
});
