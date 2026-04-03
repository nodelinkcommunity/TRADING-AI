/**
 * FLASHLOAN-AI: Plugin Manager
 * Manages lifecycle of all data plugins, runs update loops, aggregates health.
 */

const PoolLiquidityPlugin = require("./pool-liquidity");
const HistoricalPatternsPlugin = require("./historical-patterns");
const WhaleEnhancedPlugin = require("./whale-enhanced");

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.updateIntervals = new Map();
    this.isRunning = false;
  }

  /**
   * Initialize all Phase A plugins
   * @param {object} config - Full app config
   * @param {object} provider - Ethers provider
   */
  async initialize(config, provider) {
    const pluginConfig = config.plugins || {};

    // Phase A plugins
    const pluginsToLoad = [
      { Plugin: PoolLiquidityPlugin, key: "pool-liquidity", cfg: pluginConfig.defiLlama },
      { Plugin: HistoricalPatternsPlugin, key: "historical-patterns", cfg: pluginConfig.dune },
      { Plugin: WhaleEnhancedPlugin, key: "whale-enhanced", cfg: pluginConfig.whaleTracker },
    ];

    for (const { Plugin, key, cfg } of pluginsToLoad) {
      try {
        const plugin = new Plugin();
        const pluginCfg = { ...cfg, provider, chain: config.chain, chains: config.chains };
        await plugin.initialize(pluginCfg);
        this.plugins.set(key, plugin);
        console.log(`[PluginManager] Loaded: ${key}`);
      } catch (error) {
        console.warn(`[PluginManager] Failed to load ${key}: ${error.message}`);
      }
    }

    this.isRunning = true;
    console.log(`[PluginManager] ${this.plugins.size} plugins initialized`);
  }

  /**
   * Start periodic data fetching for all plugins
   * @param {string} chain - Active chain name
   */
  startUpdateLoops(chain) {
    // Pool liquidity: every 30 seconds
    this._startLoop("pool-liquidity", chain, 30000);

    // Historical patterns: every 1 hour
    this._startLoop("historical-patterns", chain, 3600000);

    // Whale enhanced: every 60 seconds (aggregation; real-time via events)
    this._startLoop("whale-enhanced", chain, 60000);

    console.log("[PluginManager] Update loops started");
  }

  _startLoop(pluginKey, chain, intervalMs) {
    const plugin = this.plugins.get(pluginKey);
    if (!plugin || !plugin.enabled) return;

    // Immediate first fetch
    plugin.fetchData(chain).catch((e) =>
      console.warn(`[PluginManager] Initial fetch error for ${pluginKey}: ${e.message}`)
    );

    // Periodic fetch
    const interval = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await plugin.fetchData(chain);
      } catch (error) {
        console.warn(`[PluginManager] Update error for ${pluginKey}: ${error.message}`);
      }
    }, intervalMs);

    this.updateIntervals.set(pluginKey, interval);
  }

  /**
   * Get plugin by name
   */
  getPlugin(name) {
    return this.plugins.get(name);
  }

  /**
   * Get aggregated data from all plugins for MarketState
   */
  async getAllData(chain) {
    const data = {};
    for (const [key, plugin] of this.plugins) {
      if (plugin.enabled && plugin.healthStatus !== "down") {
        try {
          data[key] = plugin.getLatestData ? plugin.getLatestData() : null;
        } catch (error) {
          console.warn(`[PluginManager] getData error for ${key}: ${error.message}`);
          data[key] = null;
        }
      }
    }
    return data;
  }

  /**
   * Health status of all plugins
   */
  getHealthStatus() {
    const status = {};
    for (const [key, plugin] of this.plugins) {
      status[key] = plugin.getMetrics();
    }
    return status;
  }

  /**
   * Stop all plugins
   */
  async stop() {
    this.isRunning = false;

    for (const [key, interval] of this.updateIntervals) {
      clearInterval(interval);
    }
    this.updateIntervals.clear();

    for (const [key, plugin] of this.plugins) {
      await plugin.shutdown();
    }

    console.log("[PluginManager] All plugins stopped");
  }
}

module.exports = PluginManager;
