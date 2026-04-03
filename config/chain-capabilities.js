/**
 * QIRA Protocol: Chain Capability Matrix
 * Single source of truth — which chains support which bot strategies.
 *
 * Rules:
 *   liquidation = true  → chain has Aave V3 + liquidation bot has CHAIN_CONFIG entry
 *   stablecoin  = true  → chain has stablecoin registries in stablecoin-scanner.js
 *   arbitrage   = true  → chain has DEX routers for arbitrage scanning
 *
 * All bots, server, and UI must import this module instead of maintaining
 * their own chain-support lists.
 */

const CHAIN_CAPABILITIES = {
  // ============ Mainnets ============
  arbitrum:   { arbitrage: true,  liquidation: true,  stablecoin: true  },
  base:       { arbitrage: true,  liquidation: true,  stablecoin: true  },
  polygon:    { arbitrage: true,  liquidation: false, stablecoin: false },
  bsc:        { arbitrage: true,  liquidation: false, stablecoin: false },
  avalanche:  { arbitrage: true,  liquidation: false, stablecoin: false },
  mantle:     { arbitrage: true,  liquidation: false, stablecoin: false },
  scroll:     { arbitrage: true,  liquidation: false, stablecoin: false },

  // ============ Testnets ============
  arbitrumSepolia: { arbitrage: true,  liquidation: false, stablecoin: false },
  baseSepolia:     { arbitrage: true,  liquidation: false, stablecoin: false },
};

/**
 * Get capabilities for a chain. Returns all-false for unknown chains.
 * @param {string} chain
 * @returns {{ arbitrage: boolean, liquidation: boolean, stablecoin: boolean }}
 */
function getCapabilities(chain) {
  return CHAIN_CAPABILITIES[chain] || { arbitrage: false, liquidation: false, stablecoin: false };
}

/**
 * Check if a chain supports a specific strategy.
 * @param {string} chain
 * @param {"arbitrage"|"liquidation"|"stablecoin"} strategy
 * @returns {boolean}
 */
function supportsStrategy(chain, strategy) {
  const caps = getCapabilities(chain);
  return !!caps[strategy];
}

/**
 * Get all chains that support a given strategy.
 * @param {"arbitrage"|"liquidation"|"stablecoin"} strategy
 * @returns {string[]}
 */
function getSupportedChains(strategy) {
  return Object.entries(CHAIN_CAPABILITIES)
    .filter(([, caps]) => caps[strategy])
    .map(([chain]) => chain);
}

module.exports = { CHAIN_CAPABILITIES, getCapabilities, supportsStrategy, getSupportedChains };
