/**
 * FLASHLOAN-AI: Base Data Plugin
 * All data source plugins extend this class.
 */

class BasePlugin {
  constructor(name, phase = "A") {
    this.name = name;
    this.phase = phase;
    this.enabled = false;
    this.lastUpdate = 0;
    this.errorCount = 0;
    this.maxErrors = 10; // disable after 10 consecutive errors
    this.healthStatus = "unknown"; // unknown | healthy | degraded | down
    this._cache = new Map();
    this._cacheTTL = 30000; // 30 seconds default
  }

  /**
   * Initialize the plugin with config (API keys, etc.)
   * @param {object} config
   */
  async initialize(config) {
    this.config = config || {};
    this.enabled = true;
    this.healthStatus = "healthy";
    console.log(`[Plugin:${this.name}] Initialized`);
  }

  /**
   * Fetch data from the source — override in subclass
   * @param {string} chain - Chain name (arbitrum, base, polygon, etc.)
   * @param {object} params - Query parameters
   * @returns {object} Fetched data
   */
  async fetchData(chain, params = {}) {
    throw new Error(`[Plugin:${this.name}] fetchData() not implemented`);
  }

  /**
   * Fetch with caching + error handling
   */
  async fetchWithCache(cacheKey, fetchFn, ttl) {
    const cached = this._cache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < (ttl || this._cacheTTL)) {
      return cached.data;
    }

    try {
      const data = await fetchFn();
      this._cache.set(cacheKey, { data, timestamp: now });
      this.errorCount = 0;
      this.healthStatus = "healthy";
      this.lastUpdate = now;
      return data;
    } catch (error) {
      this.errorCount++;
      if (this.errorCount >= this.maxErrors) {
        this.healthStatus = "down";
        console.error(`[Plugin:${this.name}] Too many errors (${this.errorCount}), marking as DOWN`);
      } else if (this.errorCount >= 3) {
        this.healthStatus = "degraded";
      }

      // Return stale cache if available
      if (cached) {
        console.warn(`[Plugin:${this.name}] Fetch error, using stale cache: ${error.message}`);
        return cached.data;
      }
      throw error;
    }
  }

  /**
   * Health check
   */
  async isHealthy() {
    return this.enabled && this.healthStatus !== "down";
  }

  /**
   * Last update timestamp
   */
  getLastUpdate() {
    return this.lastUpdate;
  }

  /**
   * Plugin metrics for dashboard
   */
  getMetrics() {
    return {
      name: this.name,
      phase: this.phase,
      enabled: this.enabled,
      healthStatus: this.healthStatus,
      lastUpdate: this.lastUpdate,
      errorCount: this.errorCount,
      cacheSize: this._cache.size,
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this._cache.clear();
  }

  /**
   * Shutdown plugin
   */
  async shutdown() {
    this.enabled = false;
    this.clearCache();
    console.log(`[Plugin:${this.name}] Shut down`);
  }
}

module.exports = BasePlugin;
