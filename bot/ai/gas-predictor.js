/**
 * FLASHLOAN-AI: Gas Price Predictor
 * Predict gas prices for optimal execution timing
 * Uses moving average + trend analysis for short-term predictions
 */

class GasPredictor {
  constructor(provider) {
    this.provider = provider;
    this.history = [];      // {gasPrice, maxFee, timestamp}
    this.maxHistory = 500;
    this.predictions = [];
  }

  /**
   * Sample current gas price from the provider
   */
  async sample() {
    try {
      const feeData = await this.provider.getFeeData();

      this.history.push({
        gasPrice: Number(feeData.gasPrice || 0),
        maxFee: Number(feeData.maxFeePerGas || 0),
        timestamp: Date.now(),
      });

      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
    } catch (error) {
      // Silently skip failed samples
    }
  }

  /**
   * Predict gas price for next N seconds
   */
  predict(secondsAhead) {
    secondsAhead = secondsAhead || 30;

    try {
      if (this.history.length === 0) {
        return {
          predicted: 0,
          current: 0,
          avg: 0,
          trend: "STABLE",
          confidence: 0,
          recommendation: "NORMAL",
        };
      }

      if (this.history.length < 10) {
        const latest = this.history[this.history.length - 1];
        return {
          predicted: latest.gasPrice,
          current: latest.gasPrice,
          avg: latest.gasPrice,
          trend: "STABLE",
          confidence: 0,
          recommendation: "NORMAL",
        };
      }

      // Simple moving average + trend
      const recent = this.history.slice(-20);
      const avg = recent.reduce((s, h) => s + h.gasPrice, 0) / recent.length;
      const trendSlope = (recent[recent.length - 1].gasPrice - recent[0].gasPrice) / recent.length;

      // Predict: average + trend extrapolation
      // ~3s per sample interval
      const predicted = avg + trendSlope * (secondsAhead / 3);

      // Confidence based on variance (lower variance = higher confidence)
      const variance = recent.reduce((s, h) => s + (h.gasPrice - avg) ** 2, 0) / recent.length;
      const stdDev = Math.sqrt(variance);
      const confidence = avg > 0
        ? Math.max(0, Math.min(100, 100 - (stdDev / avg * 100)))
        : 0;

      // Trend classification
      let trend = "STABLE";
      if (trendSlope > avg * 0.01) trend = "RISING";
      else if (trendSlope < -avg * 0.01) trend = "FALLING";

      // Recommendation
      let recommendation = "NORMAL";
      if (predicted < avg * 0.9) recommendation = "GOOD_TIME";
      else if (predicted > avg * 1.2) recommendation = "WAIT";

      return {
        predicted: Math.max(0, Math.round(predicted)),
        current: this.history[this.history.length - 1].gasPrice,
        avg: Math.round(avg),
        trend,
        confidence: Math.round(confidence),
        recommendation,
      };
    } catch (error) {
      const latest = this.history.length > 0 ? this.history[this.history.length - 1] : null;
      return {
        predicted: latest ? latest.gasPrice : 0,
        current: latest ? latest.gasPrice : 0,
        avg: 0,
        trend: "STABLE",
        confidence: 0,
        recommendation: "NORMAL",
      };
    }
  }

  /**
   * Should we execute now or wait for better gas?
   */
  shouldExecuteNow(profitWei) {
    try {
      const prediction = this.predict(30);

      if (prediction.recommendation === "WAIT" && prediction.confidence > 60) {
        return {
          execute: false,
          reason: "Gas predicted to drop. Wait ~30s.",
          prediction,
        };
      }

      return {
        execute: true,
        reason: "Gas price favorable.",
        prediction,
      };
    } catch (error) {
      return {
        execute: true,
        reason: "Unable to predict gas. Proceeding.",
        prediction: null,
      };
    }
  }

  /**
   * Get formatted gas stats for display
   */
  getStats() {
    if (this.history.length === 0) {
      return { samples: 0, current: 0, avg: 0, min: 0, max: 0 };
    }

    const prices = this.history.map(h => h.gasPrice);
    return {
      samples: this.history.length,
      current: prices[prices.length - 1],
      avg: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
      min: Math.min(...prices),
      max: Math.max(...prices),
    };
  }
}

module.exports = { GasPredictor };
