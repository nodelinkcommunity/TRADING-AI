/**
 * FLASHLOAN-AI: Circuit Breaker
 * Auto-stops trading when anomalies are detected.
 * Prevents cascading losses from market disruptions or bugs.
 */

class CircuitBreaker {
  constructor() {
    this.config = {};
    this.state = {
      tripped: false,
      tripReason: "",
      tripTime: 0,
      cooldownUntil: 0,
      consecutiveFailures: 0,
      hourlyFailures: 0,
      hourlyFailuresResetAt: 0,
      totalTrips: 0,
    };
    this.recentResults = []; // last 100 results
  }

  initialize(config) {
    this.config = {
      consecutiveFailures: config.consecutiveFailures || 3,
      hourlyFailures: config.hourlyFailures || 5,
      gasSpikeMultiplier: config.gasSpikeMultiplier || 5,
      cooldownMinutes: config.cooldownMinutes || 5,
      maxSingleLoss: config.maxSingleLoss || 100, // USD
      ...config,
    };
  }

  /**
   * Check if trading is allowed
   * @returns {object} { allowed, reason }
   */
  check() {
    const now = Date.now();

    // Check cooldown
    if (this.state.tripped) {
      if (now < this.state.cooldownUntil) {
        const remaining = Math.ceil((this.state.cooldownUntil - now) / 60000);
        return {
          allowed: false,
          reason: `Circuit breaker tripped: ${this.state.tripReason}. Cooldown: ${remaining}min remaining`,
        };
      }
      // Cooldown expired, auto-reset
      this._reset();
    }

    // Check hourly failures
    this._checkHourlyReset();
    if (this.state.hourlyFailures >= this.config.hourlyFailures) {
      this._trip(`${this.state.hourlyFailures} failures in 1 hour`, 30);
      return { allowed: false, reason: this.state.tripReason };
    }

    return { allowed: true, reason: "OK" };
  }

  /**
   * Record a trade result
   * @param {object} result - { success, profit, gasUsed, error, gasPrice }
   */
  recordResult(result) {
    const now = Date.now();

    this.recentResults.push({ ...result, timestamp: now });
    if (this.recentResults.length > 100) {
      this.recentResults = this.recentResults.slice(-100);
    }

    if (result.success) {
      this.state.consecutiveFailures = 0;
    } else {
      this.state.consecutiveFailures++;
      this.state.hourlyFailures++;

      // Check consecutive failures
      if (this.state.consecutiveFailures >= this.config.consecutiveFailures) {
        this._trip(
          `${this.state.consecutiveFailures} consecutive failures`,
          this.config.cooldownMinutes
        );
      }
    }

    // Check single trade loss
    if (result.loss && result.loss > this.config.maxSingleLoss) {
      this._trip(`Single trade loss $${result.loss.toFixed(2)} exceeds limit`, 60);
    }
  }

  /**
   * Record gas spike
   * @param {number} currentGas - Current gas price (Gwei)
   * @param {number} avgGas - Average gas price (Gwei)
   */
  checkGasSpike(currentGas, avgGas) {
    if (avgGas > 0 && currentGas > avgGas * this.config.gasSpikeMultiplier) {
      this._trip(
        `Gas spike: ${currentGas.toFixed(1)} Gwei (${(currentGas / avgGas).toFixed(1)}x average)`,
        this.config.cooldownMinutes
      );
      return true;
    }
    return false;
  }

  /**
   * Trip the circuit breaker
   */
  _trip(reason, cooldownMinutes) {
    this.state.tripped = true;
    this.state.tripReason = reason;
    this.state.tripTime = Date.now();
    this.state.cooldownUntil = Date.now() + cooldownMinutes * 60 * 1000;
    this.state.totalTrips++;
    console.warn(`[CircuitBreaker] TRIPPED: ${reason}. Cooldown: ${cooldownMinutes} minutes`);
  }

  /**
   * Manually reset the circuit breaker
   */
  manualReset() {
    this._reset();
    console.log("[CircuitBreaker] Manually reset");
  }

  _reset() {
    this.state.tripped = false;
    this.state.tripReason = "";
    this.state.tripTime = 0;
    this.state.cooldownUntil = 0;
    this.state.consecutiveFailures = 0;
  }

  _checkHourlyReset() {
    const now = Date.now();
    if (now > this.state.hourlyFailuresResetAt) {
      this.state.hourlyFailures = 0;
      this.state.hourlyFailuresResetAt = now + 3600000;
    }
  }

  getStatus() {
    return {
      tripped: this.state.tripped,
      tripReason: this.state.tripReason,
      cooldownUntil: this.state.cooldownUntil,
      consecutiveFailures: this.state.consecutiveFailures,
      hourlyFailures: this.state.hourlyFailures,
      totalTrips: this.state.totalTrips,
      recentResults: this.recentResults.slice(-5),
    };
  }
}

module.exports = CircuitBreaker;
