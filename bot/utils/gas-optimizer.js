/**
 * FLASHLOAN-AI: Gas Optimizer Module
 * Toi uu hoa gas price va gas limit cho transactions
 * Ho tro EIP-1559 (maxFeePerGas, maxPriorityFeePerGas)
 */

const { ethers } = require("ethers");
const { createLogger } = require("./logger");

const log = createLogger("GAS");

class GasOptimizer {
  constructor(provider, options = {}) {
    this.provider = provider;
    this.maxGasPrice = options.maxGasPrice
      ? BigInt(options.maxGasPrice)
      : ethers.parseUnits("50", "gwei");
    this.gasBufferPercent = options.gasBufferPercent || 20;
    this.priorityFeeMultiplier = options.priorityFeeMultiplier || 1.2;
    this.gasPriceHistory = [];
    this.maxHistoryLength = options.maxHistoryLength || 100;
  }

  /**
   * Lay gas price hien tai va phan tich
   */
  async getGasData() {
    try {
      const feeData = await this.provider.getFeeData();

      const data = {
        gasPrice: feeData.gasPrice,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        timestamp: Date.now(),
      };

      this.gasPriceHistory.push(data);
      if (this.gasPriceHistory.length > this.maxHistoryLength) {
        this.gasPriceHistory = this.gasPriceHistory.slice(-this.maxHistoryLength);
      }

      return data;
    } catch (error) {
      log.error("Failed to get gas data", error.message);
      return null;
    }
  }

  /**
   * Tinh gas params toi uu cho transaction
   */
  async getOptimalGasParams() {
    const gasData = await this.getGasData();
    if (!gasData) return null;

    // Tinh maxPriorityFeePerGas toi uu
    let optimalPriorityFee = gasData.maxPriorityFeePerGas || 0n;
    if (optimalPriorityFee > 0n) {
      optimalPriorityFee =
        (optimalPriorityFee *
          BigInt(Math.floor(this.priorityFeeMultiplier * 100))) /
        100n;
    }

    // Tinh maxFeePerGas
    let optimalMaxFee = gasData.maxFeePerGas || gasData.gasPrice || 0n;
    if (optimalMaxFee > 0n) {
      // Them buffer
      optimalMaxFee =
        (optimalMaxFee * BigInt(100 + this.gasBufferPercent)) / 100n;
    }

    // Kiem tra gas cap
    if (optimalMaxFee > this.maxGasPrice) {
      log.warn(
        `Gas price ${ethers.formatUnits(optimalMaxFee, "gwei")} gwei exceeds max ${ethers.formatUnits(this.maxGasPrice, "gwei")} gwei`
      );
      return null;
    }

    return {
      maxFeePerGas: optimalMaxFee,
      maxPriorityFeePerGas: optimalPriorityFee,
    };
  }

  /**
   * Uoc tinh gas limit voi buffer
   */
  async estimateGasWithBuffer(contract, method, args) {
    try {
      const gasEstimate = await contract[method].estimateGas(...args);
      const buffered =
        (gasEstimate * BigInt(100 + this.gasBufferPercent)) / 100n;

      log.debug(
        `Gas estimate for ${method}: ${gasEstimate} (buffered: ${buffered})`
      );

      return buffered;
    } catch (error) {
      log.error(`Gas estimation failed for ${method}`, error.message);
      return null;
    }
  }

  /**
   * Tinh chi phi gas bang ETH
   */
  async calculateGasCost(gasLimit) {
    const gasData = await this.getGasData();
    if (!gasData) return null;

    const gasPrice = gasData.maxFeePerGas || gasData.gasPrice || 0n;
    const gasCostWei = BigInt(gasLimit) * gasPrice;

    return {
      gasCostWei,
      gasCostETH: ethers.formatEther(gasCostWei),
      gasPriceGwei: ethers.formatUnits(gasPrice, "gwei"),
    };
  }

  /**
   * Kiem tra xem transaction co dang thuc hien khong (gas vs profit)
   */
  async isProfitable(gasLimit, profitWei) {
    const gasCost = await this.calculateGasCost(gasLimit);
    if (!gasCost) return { profitable: false, reason: "Cannot estimate gas" };

    const profitable = BigInt(profitWei) > gasCost.gasCostWei;
    const netProfit = BigInt(profitWei) - gasCost.gasCostWei;

    return {
      profitable,
      gasCostETH: gasCost.gasCostETH,
      profitETH: ethers.formatEther(profitWei),
      netProfitETH: profitable ? ethers.formatEther(netProfit) : "0",
      reason: profitable ? "Profitable" : "Gas cost exceeds profit",
    };
  }

  /**
   * Lay gas price trung binh tu history
   */
  getAverageGasPrice() {
    if (this.gasPriceHistory.length === 0) return null;

    const prices = this.gasPriceHistory
      .map((d) => d.maxFeePerGas || d.gasPrice || 0n)
      .filter((p) => p > 0n);

    if (prices.length === 0) return null;

    const sum = prices.reduce((a, b) => a + b, 0n);
    return sum / BigInt(prices.length);
  }

  /**
   * Kiem tra gas co vuot nguong khong
   */
  async isGasTooHigh() {
    const gasData = await this.getGasData();
    if (!gasData) return true;

    const currentGas = gasData.maxFeePerGas || gasData.gasPrice || 0n;
    return currentGas > this.maxGasPrice;
  }

  /**
   * In bao cao gas
   */
  printGasReport() {
    if (this.gasPriceHistory.length === 0) {
      log.info("No gas data collected yet");
      return;
    }

    const avg = this.getAverageGasPrice();
    const latest = this.gasPriceHistory[this.gasPriceHistory.length - 1];
    const currentGas = latest.maxFeePerGas || latest.gasPrice || 0n;

    log.info("--- Gas Report ---");
    log.info(
      `Current: ${ethers.formatUnits(currentGas, "gwei")} gwei`
    );
    if (avg) {
      log.info(`Average: ${ethers.formatUnits(avg, "gwei")} gwei`);
    }
    log.info(
      `Max allowed: ${ethers.formatUnits(this.maxGasPrice, "gwei")} gwei`
    );
    log.info(`Data points: ${this.gasPriceHistory.length}`);
  }
}

module.exports = { GasOptimizer };
