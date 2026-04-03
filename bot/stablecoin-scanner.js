/**
 * ============================================================
 *  FLASHLOAN-AI: Stablecoin Depeg Arbitrage Scanner
 *  Theo doi chenh lech gia giua cac stablecoin tren nhieu DEX
 *  Rui ro THAP - Loi nhuan on dinh
 * ============================================================
 */

const { ethers } = require("ethers");
require("dotenv").config();

// ============ Curve Pool ABI (toi uu cho stable swap) ============

const CURVE_POOL_ABI = [
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
  "function get_dy_underlying(int128 i, int128 j, uint256 dx) view returns (uint256)",
  "function coins(uint256) view returns (address)",
  "function balances(uint256) view returns (uint256)",
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

// ============ Stablecoin Registry ============

const STABLECOINS = {
  arbitrum: {
    USDC:  { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    USDT:  { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    DAI:   { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    FRAX:  { address: "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F", decimals: 18 },
    MIM:   { address: "0xFEa7a6a0B346362BF88A9e4A88416B77a57D6c2A", decimals: 18 },
    USDCe: { address: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", decimals: 6 },
  },
  base: {
    USDC:  { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    USDbC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
    DAI:   { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18 },
  },
};

const DEX_CONFIGS = {
  arbitrum: {
    uniswapV3Quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
    curveStablePool: "0x7f90122BF0700F9E7e1F688fe926940E8839F353",
    sushiRouter: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
  },
  base: {
    uniswapV3Quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    aerodromeRouter: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
  },
};

// Use shared capability matrix for chain validation
const { supportsStrategy, getSupportedChains } = require("../config/chain-capabilities");

// ============ Core Scanner ============

class StablecoinScanner {
  constructor(chain = "arbitrum") {
    if (!supportsStrategy(chain, "stablecoin")) {
      const supported = getSupportedChains("stablecoin").join(", ");
      throw new Error(`Stablecoin scanner does not support chain "${chain}". Supported chains: ${supported}. Chain must have stablecoin registries configured.`);
    }
    this.chain = chain;
    this.stables = STABLECOINS[chain];
    this.dexConfig = DEX_CONFIGS[chain];
    this.provider = null;
    this.priceHistory = []; // Luu tru lich su gia de phan tich
    this.opportunities = [];
  }

  async initialize(rpcUrl) {
    this.provider = new ethers.JsonRpcProvider(
      rpcUrl || (this.chain === "arbitrum"
        ? "https://arb1.arbitrum.io/rpc"
        : "https://mainnet.base.org")
    );

    const network = await this.provider.getNetwork();
    console.log(`\nStablecoin Scanner initialized on ${this.chain} (chainId: ${network.chainId})`);
    console.log(`Tracking ${Object.keys(this.stables).length} stablecoins\n`);
  }

  /**
   * Lay gia cua 1 cap stable tren Uniswap V3
   */
  async getV3Price(tokenIn, tokenOut, amountIn, fee = 500) {
    try {
      const quoter = new ethers.Contract(
        this.dexConfig.uniswapV3Quoter,
        UNISWAP_V3_QUOTER_ABI,
        this.provider
      );

      const amountOut = await quoter.quoteExactInputSingle.staticCall(
        tokenIn,
        tokenOut,
        fee,
        amountIn,
        0
      );

      return amountOut;
    } catch {
      return null;
    }
  }

  /**
   * Lay gia cua 1 cap stable tren Curve
   */
  async getCurvePrice(poolAddress, indexIn, indexOut, amountIn) {
    try {
      const pool = new ethers.Contract(
        poolAddress,
        CURVE_POOL_ABI,
        this.provider
      );

      const amountOut = await pool.get_dy(indexIn, indexOut, amountIn);
      return amountOut;
    } catch {
      return null;
    }
  }

  /**
   * Quet tat ca cac cap stable tim chenh lech
   */
  async scanAllPairs() {
    const results = [];
    const stableNames = Object.keys(this.stables);
    const scanAmount = ethers.parseUnits("10000", 6); // 10,000 USDC equivalent

    for (let i = 0; i < stableNames.length; i++) {
      for (let j = i + 1; j < stableNames.length; j++) {
        const nameA = stableNames[i];
        const nameB = stableNames[j];
        const tokenA = this.stables[nameA];
        const tokenB = this.stables[nameB];

        // Dieu chinh amount theo decimals
        const amountA = ethers.parseUnits("10000", tokenA.decimals);

        const amountB = ethers.parseUnits("10000", tokenB.decimals);

        // Lay gia A -> B tren V3
        const priceAB_v3 = await this.getV3Price(
          tokenA.address,
          tokenB.address,
          amountA,
          500 // 0.05% fee tier (tot cho stables)
        );

        // Lay gia B -> A tren V3 (fixed 10000 input, for deviation metric)
        const priceBA_v3 = await this.getV3Price(
          tokenB.address,
          tokenA.address,
          amountB,
          500
        );

        // True round-trip: use actual A->B output as input for B->A
        const roundTripBA = priceAB_v3
          ? await this.getV3Price(
              tokenB.address,
              tokenA.address,
              priceAB_v3,
              500
            )
          : null;

        // Tinh chenh lech
        if (priceAB_v3 && priceBA_v3) {
          // Normalize ve cung decimals
          const normalizedAB = this.normalizeAmount(priceAB_v3, tokenB.decimals);
          const normalizedBA = this.normalizeAmount(priceBA_v3, tokenA.decimals);

          // Chenh lech % so voi 10,000 (gia ly tuong)
          const deviationAB = Math.abs(normalizedAB - 10000) / 100;
          const deviationBA = Math.abs(normalizedBA - 10000) / 100;

          // Kiem tra co hoi 2 chieu (round-trip)
          // Mua A->B roi B->A, kiem tra con du tra flashloan khong
          const roundTrip = roundTripBA
            ? this.calculateRoundTrip(
                amountA,
                priceAB_v3,
                roundTripBA,
                tokenA.decimals,
                tokenB.decimals
              )
            : "0.00";

          results.push({
            pair: `${nameA}/${nameB}`,
            priceAB: normalizedAB,
            priceBA: normalizedBA,
            deviationAB: deviationAB.toFixed(3),
            deviationBA: deviationBA.toFixed(3),
            roundTripProfit: roundTrip,
            timestamp: Date.now(),
          });
        }
      }
    }

    // Luu lich su
    this.priceHistory.push({
      timestamp: Date.now(),
      results,
    });

    // Giu toi da 1000 snapshots
    if (this.priceHistory.length > 1000) {
      this.priceHistory = this.priceHistory.slice(-500);
    }

    return results;
  }

  normalizeAmount(amount, decimals) {
    return Number(ethers.formatUnits(amount, decimals));
  }

  calculateRoundTrip(amountIn, priceAB, priceBA, decimalsA, decimalsB) {
    // True round-trip: A->B then B->A
    const normalizedIn = Number(ethers.formatUnits(amountIn, decimalsA));
    const amountB = Number(ethers.formatUnits(priceAB, decimalsB)); // A->B gives amountB
    const amountBackA = Number(ethers.formatUnits(priceBA, decimalsA)); // B->A gives amountBackA

    if (normalizedIn === 0) return "0.00";

    // Profit ratio from round-trip
    const ratio = amountBackA / normalizedIn;

    // Flashloan fee: 0.05%, swap fee: 0.05% x 2
    const totalFees = 0.0005 + 0.0005 * 2;
    const profitBps = (ratio - 1 - totalFees) * 10000;

    return profitBps.toFixed(2);
  }

  /**
   * Phan tich xu huong depeg tu lich su
   */
  analyzeDepegTrends() {
    if (this.priceHistory.length < 10) {
      return { message: "Chua du du lieu (can >= 10 snapshots)" };
    }

    const trends = {};
    const recentHistory = this.priceHistory.slice(-100);

    for (const snapshot of recentHistory) {
      for (const result of snapshot.results) {
        if (!trends[result.pair]) {
          trends[result.pair] = {
            pair: result.pair,
            deviations: [],
            maxDeviation: 0,
            avgDeviation: 0,
            currentDeviation: 0,
          };
        }

        const dev = Math.max(
          parseFloat(result.deviationAB),
          parseFloat(result.deviationBA)
        );
        trends[result.pair].deviations.push(dev);
      }
    }

    // Tinh toan thong ke
    for (const [pair, data] of Object.entries(trends)) {
      const devs = data.deviations;
      data.maxDeviation = Math.max(...devs);
      data.avgDeviation = devs.reduce((a, b) => a + b, 0) / devs.length;
      data.currentDeviation = devs[devs.length - 1] || 0;
      data.isDepegRisk = data.currentDeviation > data.avgDeviation * 2;
      data.dataPoints = devs.length;
    }

    return trends;
  }

  /**
   * Tim co hoi arbitrage tu ket qua scan
   */
  findOpportunities(scanResults, minProfitBps = 5) {
    const opps = [];

    for (const result of scanResults) {
      const profit = parseFloat(result.roundTripProfit);

      if (profit > minProfitBps) {
        opps.push({
          pair: result.pair,
          profitBps: profit,
          direction: parseFloat(result.deviationAB) > parseFloat(result.deviationBA)
            ? "A->B->A"
            : "B->A->B",
          deviation: Math.max(
            parseFloat(result.deviationAB),
            parseFloat(result.deviationBA)
          ),
          timestamp: result.timestamp,
        });
      }
    }

    return opps.sort((a, b) => b.profitBps - a.profitBps);
  }

  /**
   * In bao cao trang thai
   */
  printReport(scanResults) {
    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║   STABLECOIN DEPEG MONITOR               ║");
    console.log(`║   ${new Date().toISOString()}    ║`);
    console.log("╠══════════════════════════════════════════╣");

    for (const result of scanResults) {
      const devMax = Math.max(
        parseFloat(result.deviationAB),
        parseFloat(result.deviationBA)
      );

      let status = "OK";
      if (devMax > 0.5) status = "** DEPEG **";
      else if (devMax > 0.2) status = "* WATCH *";
      else if (devMax > 0.1) status = "~ drift ~";

      console.log(
        `║ ${result.pair.padEnd(12)} | Dev: ${devMax.toFixed(3)}% | RT: ${result.roundTripProfit}bps | ${status}`
      );
    }

    console.log("╚══════════════════════════════════════════╝");

    // In co hoi
    const opps = this.findOpportunities(scanResults);
    if (opps.length > 0) {
      console.log(`\n>>> ${opps.length} ARBITRAGE OPPORTUNITIES:`);
      for (const opp of opps) {
        console.log(
          `    ${opp.pair} | +${opp.profitBps.toFixed(1)} bps | ${opp.direction}`
        );
      }
    }
  }
}

// ============ Main Bot ============

class StablecoinBot {
  constructor(chain = "arbitrum") {
    this.scanner = new StablecoinScanner(chain);
    this.isRunning = false;
    this.scanCount = 0;
  }

  async start(intervalMs = 10000) {
    console.log("\n====================================");
    console.log("  FLASHLOAN-AI: Stablecoin Scanner");
    console.log("====================================\n");

    await this.scanner.initialize();

    this.isRunning = true;
    process.on("SIGINT", () => this.stop());

    console.log(`Scan interval: ${intervalMs}ms`);
    console.log("Press Ctrl+C to stop\n");

    while (this.isRunning) {
      try {
        const results = await this.scanner.scanAllPairs();
        this.scanCount++;
        this.scanner.printReport(results);

        // In trend analysis moi 20 scan
        if (this.scanCount % 20 === 0) {
          const trends = this.scanner.analyzeDepegTrends();
          console.log("\n--- Depeg Trend Analysis ---");
          for (const [pair, data] of Object.entries(trends)) {
            if (data.avgDeviation) {
              console.log(
                `${pair}: avg ${data.avgDeviation.toFixed(3)}% | max ${data.maxDeviation.toFixed(3)}% | risk: ${data.isDepegRisk ? "HIGH" : "low"}`
              );
            }
          }
        }
      } catch (error) {
        console.error(`Scan error: ${error.message}`);
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  stop() {
    this.isRunning = false;
    console.log(`\nCompleted ${this.scanCount} scans.`);
    process.exit(0);
  }
}

// ============ Entry Point ============

async function main() {
  const chain = process.env.BOT_CHAIN || process.argv[2] || "arbitrum";
  const bot = new StablecoinBot(chain);
  await bot.start(10000);
}

main();

module.exports = { StablecoinScanner, StablecoinBot };
