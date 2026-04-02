/**
 * ============================================================
 *  FLASHLOAN-AI: Bot Monitoring & Execution
 *  Theo doi gia real-time, phat hien co hoi arbitrage,
 *  va tu dong thuc hien giao dich flashloan
 * ============================================================
 */

const { ethers } = require("ethers");
require("dotenv").config();
const config = require("../config/config.json");

// Override config with .env values (Dashboard saves to .env)
if (process.env.PRIVATE_KEY) config.privateKey = process.env.PRIVATE_KEY;
if (process.env.ARBITRUM_RPC_URL) config.rpcUrl = process.env.ARBITRUM_RPC_URL;

// ============ ABI Definitions ============

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

const UNISWAP_V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

const UNISWAP_V2_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
];

const FLASHLOAN_CONTRACT_ABI = [
  "function executeArbitrage(address _token, uint256 _amount, bytes calldata _params) external",
  "function totalTrades() view returns (uint256)",
  "function totalProfit() view returns (uint256)",
];

// ============ Core Classes ============

class PriceMonitor {
  constructor(provider, dexConfigs) {
    this.provider = provider;
    this.dexConfigs = dexConfigs;
    this.priceCache = new Map();
    this.lastUpdate = new Map();
    this.errorCount = {};  // Track errors to suppress spam
  }

  /**
   * Log error only once per unique key, then suppress
   */
  _logErrorOnce(key, message) {
    if (!this.errorCount[key]) {
      this.errorCount[key] = 0;
    }
    this.errorCount[key]++;
    if (this.errorCount[key] <= 1) {
      console.warn(`[WARN] ${message} (further errors suppressed)`);
    }
  }

  /**
   * Lay gia tu Uniswap V3 Quoter
   */
  async getV3Price(quoterAddress, tokenIn, tokenOut, fee, amountIn) {
    try {
      const quoter = new ethers.Contract(
        quoterAddress,
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
    } catch (error) {
      const key = `v3-${quoterAddress}-${tokenIn}-${tokenOut}-${fee}`;
      this._logErrorOnce(key, `V3 quote failed: ${tokenIn.slice(0,8)}.../${tokenOut.slice(0,8)}... fee=${fee} on ${quoterAddress.slice(0,8)}...`);
      return null;
    }
  }

  /**
   * Lay gia tu Uniswap V2 Router
   */
  async getV2Price(routerAddress, tokenIn, tokenOut, amountIn) {
    try {
      const router = new ethers.Contract(
        routerAddress,
        UNISWAP_V2_ROUTER_ABI,
        this.provider
      );

      const amounts = await router.getAmountsOut(amountIn, [
        tokenIn,
        tokenOut,
      ]);

      return amounts[1];
    } catch (error) {
      const key = `v2-${routerAddress}-${tokenIn}-${tokenOut}`;
      this._logErrorOnce(key, `V2 quote failed: ${tokenIn.slice(0,8)}.../${tokenOut.slice(0,8)}... on ${routerAddress.slice(0,8)}...`);
      return null;
    }
  }

  /**
   * Lay gia tu tat ca DEX cho 1 cap token
   */
  async getAllPrices(tokenIn, tokenOut, amountIn) {
    const prices = [];

    for (const [dexName, dexConfig] of Object.entries(this.dexConfigs)) {
      let price;

      if (dexConfig.type === "v3") {
        for (const fee of dexConfig.fees || [500, 3000, 10000]) {
          price = await this.getV3Price(
            dexConfig.quoter,
            tokenIn,
            tokenOut,
            fee,
            amountIn
          );

          if (price) {
            prices.push({
              dex: dexName,
              type: "v3",
              fee,
              price: price,
              router: dexConfig.router,
            });
          }
        }
      } else {
        price = await this.getV2Price(
          dexConfig.router,
          tokenIn,
          tokenOut,
          amountIn
        );

        if (price) {
          prices.push({
            dex: dexName,
            type: "v2",
            fee: 3000, // 0.3% mac dinh cho V2
            price: price,
            router: dexConfig.router,
          });
        }
      }
    }

    return prices.sort((a, b) => {
      // Sap xep theo gia giam dan (mua re nhat truoc)
      if (a.price > b.price) return -1;
      if (a.price < b.price) return 1;
      return 0;
    });
  }
}

class OpportunityFinder {
  constructor(priceMonitor, config) {
    this.priceMonitor = priceMonitor;
    this.minProfitBps = config.minProfitBps || 10; // 0.1%
    this.flashloanFeeBps = config.flashloanFeeBps || 5; // 0.05%
    this.gasEstimateGwei = config.gasEstimateGwei || 0.1;
  }

  /**
   * Tim co hoi DEX-to-DEX Arbitrage
   */
  async findSimpleArbitrage(tokenA, tokenB, amounts) {
    const opportunities = [];

    for (const amount of amounts) {
      // Lay gia A -> B tren tat ca DEX
      const pricesAB = await this.priceMonitor.getAllPrices(
        tokenA,
        tokenB,
        amount
      );

      if (pricesAB.length < 2) continue;

      // Voi moi cap DEX, kiem tra co hoi
      for (let i = 0; i < pricesAB.length; i++) {
        // Gia cao nhat de ban (A -> B)
        const bestSell = pricesAB[i];

        // Lay gia B -> A tren cac DEX khac
        const pricesBA = await this.priceMonitor.getAllPrices(
          tokenB,
          tokenA,
          bestSell.price
        );

        for (const buyBack of pricesBA) {
          if (buyBack.dex === bestSell.dex && buyBack.fee === bestSell.fee)
            continue;

          const returnAmount = buyBack.price;
          const flashloanFee = (amount * BigInt(this.flashloanFeeBps)) / 10000n;
          const totalCost = amount + flashloanFee;

          if (returnAmount > totalCost) {
            const profit = returnAmount - totalCost;
            const profitBps = Number((profit * 10000n) / amount);

            if (profitBps >= this.minProfitBps) {
              opportunities.push({
                type: "SIMPLE",
                tokenIn: tokenA,
                flashAmount: amount,
                steps: [
                  {
                    dex: bestSell.dex,
                    type: bestSell.type,
                    fee: bestSell.fee,
                    tokenIn: tokenA,
                    tokenOut: tokenB,
                    expectedOut: bestSell.price,
                  },
                  {
                    dex: buyBack.dex,
                    type: buyBack.type,
                    fee: buyBack.fee,
                    tokenIn: tokenB,
                    tokenOut: tokenA,
                    expectedOut: returnAmount,
                  },
                ],
                estimatedProfit: profit,
                profitBps,
                timestamp: Date.now(),
              });
            }
          }
        }
      }
    }

    return opportunities.sort((a, b) => b.profitBps - a.profitBps);
  }

  /**
   * Tim co hoi Triangular Arbitrage
   */
  async findTriangularArbitrage(tokenA, tokenB, tokenC, amount) {
    const opportunities = [];

    // Lay gia A -> B
    const pricesAB = await this.priceMonitor.getAllPrices(
      tokenA,
      tokenB,
      amount
    );

    for (const stepAB of pricesAB) {
      // Lay gia B -> C
      const pricesBC = await this.priceMonitor.getAllPrices(
        tokenB,
        tokenC,
        stepAB.price
      );

      for (const stepBC of pricesBC) {
        // Lay gia C -> A
        const pricesCA = await this.priceMonitor.getAllPrices(
          tokenC,
          tokenA,
          stepBC.price
        );

        for (const stepCA of pricesCA) {
          const returnAmount = stepCA.price;
          const flashloanFee =
            (amount * BigInt(this.flashloanFeeBps)) / 10000n;
          const totalCost = amount + flashloanFee;

          if (returnAmount > totalCost) {
            const profit = returnAmount - totalCost;
            const profitBps = Number((profit * 10000n) / amount);

            if (profitBps >= this.minProfitBps) {
              opportunities.push({
                type: "TRIANGULAR",
                tokenIn: tokenA,
                flashAmount: amount,
                steps: [
                  {
                    dex: stepAB.dex,
                    type: stepAB.type,
                    fee: stepAB.fee,
                    tokenIn: tokenA,
                    tokenOut: tokenB,
                    expectedOut: stepAB.price,
                  },
                  {
                    dex: stepBC.dex,
                    type: stepBC.type,
                    fee: stepBC.fee,
                    tokenIn: tokenB,
                    tokenOut: tokenC,
                    expectedOut: stepBC.price,
                  },
                  {
                    dex: stepCA.dex,
                    type: stepCA.type,
                    fee: stepCA.fee,
                    tokenIn: tokenC,
                    tokenOut: tokenA,
                    expectedOut: stepCA.price,
                  },
                ],
                estimatedProfit: profit,
                profitBps,
                timestamp: Date.now(),
              });
            }
          }
        }
      }
    }

    return opportunities.sort((a, b) => b.profitBps - a.profitBps);
  }
}

class ArbitrageExecutor {
  constructor(provider, wallet, contractAddress, config) {
    this.provider = provider;
    this.wallet = wallet;
    this.contract = new ethers.Contract(
      contractAddress,
      FLASHLOAN_CONTRACT_ABI,
      wallet
    );
    this.config = config;
    this.executionLog = [];
  }

  /**
   * Encode cac buoc swap thanh bytes de truyen vao contract
   */
  encodeSwapSteps(steps) {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

    const encodedSteps = steps.map((step) => ({
      dexName: step.dex,
      tokenIn: step.tokenIn,
      tokenOut: step.tokenOut,
      fee: step.fee,
      isV3: step.type === "v3",
      amountOutMin: (step.expectedOut * 995n) / 1000n, // 0.5% slippage
    }));

    return abiCoder.encode(
      [
        "tuple(string dexName, address tokenIn, address tokenOut, uint24 fee, bool isV3, uint256 amountOutMin)[]",
      ],
      [encodedSteps]
    );
  }

  /**
   * Thuc hien giao dich arbitrage
   */
  async execute(opportunity) {
    console.log("\n========================================");
    console.log(`EXECUTING ${opportunity.type} ARBITRAGE`);
    console.log(`Estimated Profit: ${opportunity.profitBps} bps`);
    console.log("========================================\n");

    try {
      // Encode params
      const params = this.encodeSwapSteps(opportunity.steps);

      // Uoc tinh gas
      const gasEstimate = await this.contract.executeArbitrage.estimateGas(
        opportunity.tokenIn,
        opportunity.flashAmount,
        params
      );

      const feeData = await this.provider.getFeeData();
      const gasCost = gasEstimate * feeData.gasPrice;

      console.log(`Gas estimate: ${gasEstimate.toString()}`);
      console.log(
        `Gas cost: ${ethers.formatEther(gasCost)} ETH`
      );

      // Kiem tra loi nhuan sau gas
      // (Don gian hoa - thuc te can convert gas cost sang token)
      if (opportunity.profitBps < this.config.minProfitBps) {
        console.log("Profit too low after gas. Skipping.");
        return null;
      }

      // Gui transaction
      const tx = await this.contract.executeArbitrage(
        opportunity.tokenIn,
        opportunity.flashAmount,
        params,
        {
          gasLimit: (gasEstimate * 120n) / 100n, // +20% buffer
          maxFeePerGas: feeData.maxFeePerGas,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        }
      );

      console.log(`Transaction sent: ${tx.hash}`);

      // Doi xac nhan
      const receipt = await tx.wait(1);

      const result = {
        success: receipt.status === 1,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber,
        opportunity,
        timestamp: Date.now(),
      };

      this.executionLog.push(result);

      if (result.success) {
        console.log(`SUCCESS! Block: ${receipt.blockNumber}`);
      } else {
        console.log("Transaction FAILED (reverted)");
      }

      return result;
    } catch (error) {
      console.error(`Execution error: ${error.message}`);

      this.executionLog.push({
        success: false,
        error: error.message,
        opportunity,
        timestamp: Date.now(),
      });

      return null;
    }
  }
}

// ============ Main Bot Loop ============

class FlashloanBot {
  constructor(configPath) {
    this.config = require(configPath || "../config/config.json");
    this.isRunning = false;
    this.stats = {
      scansCompleted: 0,
      opportunitiesFound: 0,
      tradesExecuted: 0,
      totalProfit: 0n,
      startTime: null,
    };
  }

  async initialize() {
    console.log("\n====================================");
    console.log("   FLASHLOAN-AI Bot v1.0");
    console.log("   Arbitrage Monitoring System");
    console.log("====================================\n");

    // Override config with .env values (Dashboard saves credentials to .env)
    if (process.env.PRIVATE_KEY) this.config.privateKey = process.env.PRIVATE_KEY;
    if (process.env.ARBITRUM_RPC_URL) this.config.rpcUrl = process.env.ARBITRUM_RPC_URL;
    if (process.env.CONTRACT_ADDRESS) this.config.contractAddress = process.env.CONTRACT_ADDRESS;

    // Validate required config
    if (!this.config.privateKey || this.config.privateKey.includes("YOUR_")) {
      throw new Error("Private key not configured. Go to Dashboard → Setup to enter your private key.");
    }

    // Setup provider
    this.provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    const network = await this.provider.getNetwork();
    const chainId = Number(network.chainId);
    console.log(`Connected to: ${network.name} (chainId: ${chainId})`);

    // Detect testnet and load appropriate config
    const isTestnet = [421614, 84532, 11155111].includes(chainId);
    if (isTestnet) {
      console.log("⚠️  TESTNET MODE — Using testnet DEX addresses");
      this._loadTestnetConfig(chainId);
    }

    // Setup wallet
    this.wallet = new ethers.Wallet(this.config.privateKey, this.provider);
    console.log(`Wallet: ${this.wallet.address}`);

    const balance = await this.provider.getBalance(this.wallet.address);
    console.log(`ETH Balance: ${ethers.formatEther(balance)}`);

    // Setup monitors
    this.priceMonitor = new PriceMonitor(
      this.provider,
      this.config.dexConfigs
    );
    this.finder = new OpportunityFinder(this.priceMonitor, this.config);

    // Setup executor only if contract address is valid
    if (this.config.contractAddress && !this.config.contractAddress.includes("YOUR_")) {
      this.executor = new ArbitrageExecutor(
        this.provider,
        this.wallet,
        this.config.contractAddress,
        this.config
      );
      console.log(`Contract: ${this.config.contractAddress}`);
    } else {
      this.executor = null;
      console.log("⚠️  No contract address — Monitor-only mode (no execution)");
    }

    console.log("\nBot initialized successfully!\n");
  }

  /**
   * Load testnet-specific DEX and token addresses
   * Testnet co it DEX va token, chi co Uniswap V3 tren Arbitrum Sepolia
   */
  _loadTestnetConfig(chainId) {
    if (chainId === 421614) {
      // Arbitrum Sepolia - Uniswap V3 testnet deployment
      this.config.dexConfigs = {
        uniswapV3: {
          type: "v3",
          router: "0x101F443B4d1b059569D643917553c771E1b9663E",
          quoter: "0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B",
          fees: [500, 3000, 10000],
        },
      };
      // Testnet tokens (Aave V3 testnet faucet tokens)
      this.config.tokenPairs = [
        {
          name: "WETH/USDC (Testnet)",
          tokenA: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73", // WETH on Arb Sepolia
          tokenB: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // USDC on Arb Sepolia
          decimals: 18,
          amounts: [0.01, 0.05, 0.1],
        },
      ];
      console.log("Loaded Arbitrum Sepolia testnet config");
      console.log("DEXes: Uniswap V3 (testnet)");
      console.log("Pairs: WETH/USDC (testnet tokens)");
    }
  }

  async scanOnce() {
    const startTime = Date.now();
    let foundOpportunities = [];

    for (const pair of this.config.tokenPairs) {
      // Simple arbitrage
      const simpleOpps = await this.finder.findSimpleArbitrage(
        pair.tokenA,
        pair.tokenB,
        pair.amounts.map((a) => ethers.parseUnits(a.toString(), pair.decimals))
      );
      foundOpportunities.push(...simpleOpps);

      // Triangular arbitrage (neu co token C)
      if (pair.tokenC) {
        const triOpps = await this.finder.findTriangularArbitrage(
          pair.tokenA,
          pair.tokenB,
          pair.tokenC,
          ethers.parseUnits(pair.amounts[0].toString(), pair.decimals)
        );
        foundOpportunities.push(...triOpps);
      }
    }

    const scanTime = Date.now() - startTime;
    this.stats.scansCompleted++;

    if (foundOpportunities.length > 0) {
      console.log(
        `\n[SCAN #${this.stats.scansCompleted}] Found ${foundOpportunities.length} opportunities (${scanTime}ms)`
      );
      this.stats.opportunitiesFound += foundOpportunities.length;

      // Sap xep theo loi nhuan va thuc hien co hoi tot nhat
      foundOpportunities.sort((a, b) => b.profitBps - a.profitBps);

      const best = foundOpportunities[0];
      console.log(
        `Best: ${best.type} | Profit: ${best.profitBps} bps | Steps: ${best.steps.length}`
      );

      // Thuc hien neu vuot nguong
      if (this.executor && this.config.autoExecute && best.profitBps >= this.config.minProfitBps) {
        const result = await this.executor.execute(best);
        if (result && result.success) {
          this.stats.tradesExecuted++;
        }
      }
    } else {
      // In trang thai moi 5 lan scan
      if (this.stats.scansCompleted % 5 === 0) {
        const uptime = Math.floor((Date.now() - this.stats.startTime) / 1000);
        const mins = Math.floor(uptime / 60);
        const secs = uptime % 60;
        console.log(
          `[SCAN #${this.stats.scansCompleted}] Scanning... no opportunities yet | ${scanTime}ms | uptime ${mins}m${secs}s | found: ${this.stats.opportunitiesFound}`
        );
      }
    }
  }

  async start() {
    await this.initialize();

    this.isRunning = true;
    this.stats.startTime = Date.now();

    console.log("Starting monitoring loop...");
    console.log(`Scan interval: ${this.config.scanIntervalMs}ms`);
    console.log(`Min profit: ${this.config.minProfitBps} bps`);
    console.log(`Auto execute: ${this.config.autoExecute}`);
    console.log("Press Ctrl+C to stop\n");

    // Signal handlers
    process.on("SIGINT", () => {
      console.log("\n\nStopping bot...");
      this.stop();
    });

    process.on("SIGTERM", () => {
      this.stop();
    });

    // Main loop
    while (this.isRunning) {
      try {
        await this.scanOnce();
      } catch (error) {
        console.error(`Scan error: ${error.message}`);
      }

      // Doi truoc khi scan tiep
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.scanIntervalMs || 3000)
      );
    }
  }

  stop() {
    this.isRunning = false;

    const runtime = Date.now() - this.stats.startTime;
    const minutes = Math.floor(runtime / 60000);

    console.log("\n====================================");
    console.log("   FLASHLOAN-AI Bot - Summary");
    console.log("====================================");
    console.log(`Runtime: ${minutes} minutes`);
    console.log(`Scans: ${this.stats.scansCompleted}`);
    console.log(`Opportunities: ${this.stats.opportunitiesFound}`);
    console.log(`Trades: ${this.stats.tradesExecuted}`);
    console.log("====================================\n");

    process.exit(0);
  }

  /**
   * In trang thai hien tai
   */
  printStatus() {
    console.log("\n--- Current Status ---");
    console.log(`Running: ${this.isRunning}`);
    console.log(`Scans: ${this.stats.scansCompleted}`);
    console.log(`Opportunities found: ${this.stats.opportunitiesFound}`);
    console.log(`Trades executed: ${this.stats.tradesExecuted}`);
    console.log("---\n");
  }
}

// ============ Entry Point ============

async function main() {
  const bot = new FlashloanBot();

  try {
    await bot.start();
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

// Chay bot
main();

module.exports = { FlashloanBot, PriceMonitor, OpportunityFinder, ArbitrageExecutor };
