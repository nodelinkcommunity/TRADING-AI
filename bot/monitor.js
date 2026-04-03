/**
 * ============================================================
 *  FLASHLOAN-AI: Bot Monitoring & Execution
 *  Theo doi gia real-time, phat hien co hoi arbitrage,
 *  va tu dong thuc hien giao dich flashloan
 * ============================================================
 */

const { ethers } = require("ethers");
require("dotenv").config();
const { AIEngine } = require("./ai");

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
      paperTrades: 0,
      paperProfit: 0,
    };
  }

  async initialize() {
    console.log("\n====================================");
    console.log("   FLASHLOAN-AI Bot v1.0");
    console.log("   Arbitrage Monitoring System");
    console.log("====================================\n");

    // Override config with environment variables
    if (process.env.PRIVATE_KEY) this.config.privateKey = process.env.PRIVATE_KEY;
    if (process.env.CONTRACT_ADDRESS) this.config.contractAddress = process.env.CONTRACT_ADDRESS;
    if (process.env.BOT_CHAIN) this.config.chain = process.env.BOT_CHAIN;
    if (process.env.FLASH_AMOUNT_USD) this.config.flashAmountUsd = parseInt(process.env.FLASH_AMOUNT_USD);

    // Load RPC URL for the correct chain
    const rpcEnvMap = {
      arbitrum: "ARBITRUM_RPC_URL",
      arbitrumSepolia: "ARBITRUM_RPC_URL",
      base: "BASE_RPC_URL",
      baseSepolia: "BASE_RPC_URL",
      polygon: "POLYGON_RPC_URL",
      bsc: "BSC_RPC_URL",
      avalanche: "AVAX_RPC_URL",
      mantle: "MANTLE_RPC_URL",
      scroll: "SCROLL_RPC_URL",
    };
    const chain = this.config.chain || "arbitrumSepolia";
    const rpcEnvKey = rpcEnvMap[chain] || "ARBITRUM_RPC_URL";
    if (process.env[rpcEnvKey]) this.config.rpcUrl = process.env[rpcEnvKey];
    else if (process.env.ARBITRUM_RPC_URL) this.config.rpcUrl = process.env.ARBITRUM_RPC_URL;

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

    // Load chain-specific DEX and token configs if not testnet
    if (!isTestnet) {
      try {
        const dexModule = require("../config/dex.js");
        const tokenModule = require("../config/tokens.js");
        const chainsModule = require("../config/chains.js");

        const chainInfo = Object.values(chainsModule.CHAINS || chainsModule).find(c => c.chainId === chainId);

        // Load DEX configs for this chain
        if (dexModule.DEX && dexModule.DEX[chainId]) {
          const chainDexes = dexModule.DEX[chainId];
          this.config.dexConfigs = {};
          for (const [name, dex] of Object.entries(chainDexes)) {
            this.config.dexConfigs[name] = {
              type: dex.type || (dex.quoter ? "v3" : "v2"),
              router: dex.router,
              quoter: dex.quoter,
              fees: dex.fees || (dex.quoter ? [500, 3000, 10000] : [3000]),
            };
          }
          console.log(`DEXes: ${Object.keys(this.config.dexConfigs).join(", ")}`);
        }

        // Load token pairs for this chain
        if (tokenModule.TOKENS && tokenModule.TOKENS[chainId]) {
          const chainTokens = tokenModule.TOKENS[chainId];
          const tokenList = Object.entries(chainTokens);
          if (tokenList.length >= 2) {
            this.config.tokenPairs = [];
            // Create pairs from first token (usually WETH/WBNB) with stablecoins
            const [baseSymbol, baseToken] = tokenList[0];
            for (let i = 1; i < Math.min(tokenList.length, 4); i++) {
              const [quoteSymbol, quoteToken] = tokenList[i];
              this.config.tokenPairs.push({
                name: `${baseSymbol}/${quoteSymbol}`,
                tokenA: baseToken.address,
                tokenB: quoteToken.address,
                decimals: baseToken.decimals || 18,
                amounts: [0.01, 0.05, 0.1],
              });
            }
            console.log(`Pairs: ${this.config.tokenPairs.map(p => p.name).join(", ")}`);
          }
        }
      } catch (e) {
        console.warn(`[WARN] Could not load chain-specific configs: ${e.message}`);
        console.warn("[WARN] Using default config.json DEX/token settings");
      }
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

    // Initialize AI Engine
    try {
      this.ai = new AIEngine(this.provider);
      await this.ai.initialize();
    } catch (aiError) {
      console.warn("[AI] AI Engine failed to initialize:", aiError.message);
      this.ai = null;
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

      // AI Analysis
      let aiAnalysis = null;
      if (this.ai) {
        try {
          const feeData = await this.provider.getFeeData();
          aiAnalysis = await this.ai.analyze(best, {
            gasPrice: feeData.gasPrice ? Number(feeData.gasPrice) : 0,
            maxSlippage: this.config.maxSlippageBps || 50,
          });

          console.log(
            `[AI] Score: ${aiAnalysis.score}/100 | ${aiAnalysis.recommendation.action} | ${aiAnalysis.reasoning}`
          );

          // Feed price data to market analyzer
          for (const step of best.steps) {
            if (step.expectedOut) {
              this.ai.marketAnalyzer.addPrice(
                step.tokenOut,
                step.expectedOut,
                Date.now()
              );
            }
          }
        } catch (aiErr) {
          console.warn("[AI] Analysis error:", aiErr.message);
        }
      }

      // Paper Trading: simulate without executing on-chain
      if (best.profitBps >= this.config.minProfitBps) {
        await this.simulatePaperTrade(best, aiAnalysis);
      }

      // Thuc hien neu vuot nguong (with AI gate when available)
      const aiApproved = !aiAnalysis || aiAnalysis.shouldExecute;
      if (this.executor && this.config.autoExecute && best.profitBps >= this.config.minProfitBps && aiApproved) {
        const result = await this.executor.execute(best);
        if (result && result.success) {
          this.stats.tradesExecuted++;
        }
        // Record result for AI learning
        if (this.ai && result) {
          this.ai.recordResult(best, result);
        }
      } else if (this.executor && this.config.autoExecute && !aiApproved) {
        console.log("[AI] Execution blocked by AI analysis (score too low or risk too high)");
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

  async simulatePaperTrade(opportunity, aiAnalysis) {
    try {
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice || 0n;
      const estimatedGas = 350000n; // typical flashloan arb gas
      const gasCostWei = gasPrice * estimatedGas;
      const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));

      // Get ETH price estimate (use default, will be refined with oracle data)
      const ethPriceUsd = 3500;
      const gasCostUsd = gasCostEth * ethPriceUsd;

      // For paper trading, use configured flash amount in USD
      const volumeUsd = this.config.flashAmountUsd || 50000;

      // Scale profit based on flash amount
      const profitBps = opportunity.profitBps;
      const grossProfitUsd = (volumeUsd * profitBps) / 10000;
      const netProfitUsd = grossProfitUsd - gasCostUsd;

      // Simulate buy/sell prices
      const midPrice = ethPriceUsd;
      const spread = (midPrice * profitBps) / 10000;
      const buyPrice = midPrice - spread / 2;
      const sellPrice = midPrice + spread / 2;

      // Get pair name
      const pair = this.config.tokenPairs?.[0]?.name?.split(' ')[0] || 'WETH/USDC';
      const chain = this.config.chain || 'arbitrumSepolia';
      const aiScore = aiAnalysis?.score || 0;
      const strategy = opportunity.type === 'TRIANGULAR' ? 'triangular' : 'dexArbitrage';

      // Determine success: net profit > 0
      const success = netProfitUsd > 0;

      // Output structured log for server to parse
      console.log(`[PAPER] ${success ? 'PROFIT' : 'LOSS'} | strategy:${strategy} | pair:${pair} | chain:${chain} | volume:${volumeUsd.toFixed(2)} | buyPrice:${buyPrice.toFixed(2)} | sellPrice:${sellPrice.toFixed(2)} | gasCost:${gasCostUsd.toFixed(4)} | profit:${netProfitUsd.toFixed(4)} | profitBps:${profitBps} | aiScore:${aiScore} | steps:${opportunity.steps.map(s => s.dex).join('>')} | dexBuy:${opportunity.steps[0]?.dex || ''} | dexSell:${opportunity.steps[1]?.dex || ''}`);

      this.stats.paperTrades = (this.stats.paperTrades || 0) + 1;
      this.stats.paperProfit = (this.stats.paperProfit || 0) + netProfitUsd;

      return { success, netProfitUsd, gasCostUsd, profitBps };
    } catch (err) {
      console.warn(`[PAPER] Simulation error: ${err.message}`);
      return null;
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
    console.log(`Paper trading: ON`);
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

    // Stop AI engine
    if (this.ai) {
      try { this.ai.stop(); } catch (_) {}
    }

    const runtime = Date.now() - this.stats.startTime;
    const minutes = Math.floor(runtime / 60000);

    console.log("\n====================================");
    console.log("   FLASHLOAN-AI Bot - Summary");
    console.log("====================================");
    console.log(`Runtime: ${minutes} minutes`);
    console.log(`Scans: ${this.stats.scansCompleted}`);
    console.log(`Opportunities: ${this.stats.opportunitiesFound}`);
    console.log(`Trades: ${this.stats.tradesExecuted}`);
    console.log(`Paper Trades: ${this.stats.paperTrades}`);
    console.log(`Paper Profit: $${this.stats.paperProfit.toFixed(4)}`);
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
