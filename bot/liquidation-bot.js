/**
 * ============================================================
 *  FLASHLOAN-AI: Liquidation Sniping Bot
 *  Theo doi vi tri vay tren Aave V3, tu dong thanh ly
 *  khi Health Factor < 1.0 va nhan thuong liquidation
 * ============================================================
 *
 *  Loi nhuan: 5-15% gia tri tai san thanh ly
 *  Rui ro: Thap (flashloan = khong can von)
 *  Chain: Arbitrum, Base, Polygon
 */

const { ethers } = require("ethers");
require("dotenv").config();

// ============ ABI Definitions ============

const AAVE_POOL_ABI = [
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function getReservesList() view returns (address[])",
  "function getReserveData(address asset) view returns (tuple(uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
  "function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken) external",
];

const AAVE_DATA_PROVIDER_ABI = [
  "function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)",
  "function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)",
];

const ATOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const CHAINLINK_ABI = [
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
];

// ============ Configuration ============

const CHAIN_CONFIG = {
  arbitrum: {
    chainId: 42161,
    rpc: "https://arb1.arbitrum.io/rpc",
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aaveDataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
    liquidationBonus: {
      WETH: 10500, // 5% bonus
      WBTC: 10500,
      USDC: 10450, // 4.5% bonus
      USDT: 10450,
      ARB: 11000, // 10% bonus (volatile = higher bonus!)
      LINK: 10700, // 7% bonus
    },
    tokens: {
      WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
      USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
      WBTC: { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8 },
      ARB:  { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18 },
      LINK: { address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18 },
      DAI:  { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 },
    },
  },
  base: {
    chainId: 8453,
    rpc: "https://mainnet.base.org",
    aavePool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    aaveDataProvider: "0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac",
    tokens: {
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      USDbC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
      cbETH: { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 },
    },
  },
};

// ============ Core Classes ============

class PositionTracker {
  constructor(provider, chainConfig) {
    this.provider = provider;
    this.config = chainConfig;
    this.pool = new ethers.Contract(
      chainConfig.aavePool,
      AAVE_POOL_ABI,
      provider
    );
    this.dataProvider = new ethers.Contract(
      chainConfig.aaveDataProvider,
      AAVE_DATA_PROVIDER_ABI,
      provider
    );

    // Cache cua cac vi tri dang theo doi
    this.positions = new Map();
    // Danh sach borrowers da biet
    this.knownBorrowers = new Set();
  }

  /**
   * Quet blockchain de tim borrowers moi
   * Su dung event logs tu aToken contracts
   */
  async discoverBorrowers(blocksBack = 1000) {
    console.log(`Scanning last ${blocksBack} blocks for borrowers...`);

    const currentBlock = await this.provider.getBlockNumber();
    const fromBlock = currentBlock - blocksBack;
    const newBorrowers = [];

    for (const [symbol, tokenInfo] of Object.entries(this.config.tokens)) {
      try {
        const reserveTokens = await this.dataProvider.getReserveTokensAddresses(
          tokenInfo.address
        );
        const variableDebtToken = new ethers.Contract(
          reserveTokens[2], // variableDebtTokenAddress
          ATOKEN_ABI,
          this.provider
        );

        // Tim Transfer events (minting debt = new borrow)
        const filter = variableDebtToken.filters.Transfer(
          ethers.ZeroAddress, // from = zero address = minting
          null // to = any borrower
        );

        const events = await variableDebtToken.queryFilter(
          filter,
          fromBlock,
          currentBlock
        );

        for (const event of events) {
          const borrower = event.args[1]; // 'to' address
          if (!this.knownBorrowers.has(borrower)) {
            this.knownBorrowers.add(borrower);
            newBorrowers.push(borrower);
          }
        }
      } catch (error) {
        // Skip tokens that don't have debt tokens
      }
    }

    console.log(
      `Found ${newBorrowers.length} new borrowers (total: ${this.knownBorrowers.size})`
    );
    return newBorrowers;
  }

  /**
   * Kiem tra Health Factor cua 1 user
   */
  async checkHealthFactor(userAddress) {
    try {
      const data = await this.pool.getUserAccountData(userAddress);

      return {
        user: userAddress,
        totalCollateralBase: data[0],
        totalDebtBase: data[1],
        availableBorrowsBase: data[2],
        currentLiquidationThreshold: data[3],
        ltv: data[4],
        healthFactor: data[5],
        healthFactorFormatted: Number(ethers.formatUnits(data[5], 18)),
        isLiquidatable: data[5] < ethers.parseEther("1.0"),
        isAtRisk: data[5] < ethers.parseEther("1.1"), // < 1.1 = can theo doi
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Quet tat ca borrowers va tim vi tri co the thanh ly
   */
  async scanAllPositions() {
    const liquidatable = [];
    const atRisk = [];
    let scanned = 0;

    // Chia thanh batches de khong overload RPC
    const borrowerList = Array.from(this.knownBorrowers);
    const batchSize = 50;

    for (let i = 0; i < borrowerList.length; i += batchSize) {
      const batch = borrowerList.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map((addr) => this.checkHealthFactor(addr))
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          const position = result.value;
          scanned++;

          if (position.isLiquidatable) {
            liquidatable.push(position);
          } else if (position.isAtRisk) {
            atRisk.push(position);
          }

          // Cap nhat cache
          this.positions.set(position.user, position);
        }
      }
    }

    return { liquidatable, atRisk, scanned };
  }

  /**
   * Lay chi tiet vi tri (collateral va debt tokens) cua user
   */
  async getPositionDetails(userAddress) {
    const details = {
      collaterals: [],
      debts: [],
    };

    for (const [symbol, tokenInfo] of Object.entries(this.config.tokens)) {
      try {
        const reserveData = await this.dataProvider.getUserReserveData(
          tokenInfo.address,
          userAddress
        );

        const aTokenBalance = reserveData[0];
        const stableDebt = reserveData[1];
        const variableDebt = reserveData[2];
        const usedAsCollateral = reserveData[8];

        if (aTokenBalance > 0n && usedAsCollateral) {
          details.collaterals.push({
            symbol,
            address: tokenInfo.address,
            decimals: tokenInfo.decimals,
            balance: aTokenBalance,
            balanceFormatted: ethers.formatUnits(
              aTokenBalance,
              tokenInfo.decimals
            ),
          });
        }

        const totalDebt = stableDebt + variableDebt;
        if (totalDebt > 0n) {
          details.debts.push({
            symbol,
            address: tokenInfo.address,
            decimals: tokenInfo.decimals,
            balance: totalDebt,
            balanceFormatted: ethers.formatUnits(
              totalDebt,
              tokenInfo.decimals
            ),
          });
        }
      } catch (error) {
        // Skip
      }
    }

    return details;
  }
}

class LiquidationCalculator {
  /**
   * Tinh toan loi nhuan tu viec thanh ly 1 vi tri
   */
  static calculateProfit(position, details, config) {
    if (!position.isLiquidatable || details.debts.length === 0) {
      return null;
    }

    const opportunities = [];

    for (const debt of details.debts) {
      for (const collateral of details.collaterals) {
        // Tren Aave V3, co the thanh ly toi da 50% no
        const maxDebtToCover = debt.balance / 2n;

        // Liquidation bonus (5-10% tuy token)
        const bonusBps =
          config.liquidationBonus?.[collateral.symbol] || 10500;
        const bonusPercent = (bonusBps - 10000) / 100;

        // Uoc tinh loi nhuan
        // (Don gian hoa - thuc te can price feed chinh xac)
        const estimatedBonus = (maxDebtToCover * BigInt(bonusBps - 10000)) / 10000n;

        opportunities.push({
          collateralAsset: collateral.address,
          collateralSymbol: collateral.symbol,
          debtAsset: debt.address,
          debtSymbol: debt.symbol,
          debtToCover: maxDebtToCover,
          debtToCoverFormatted: ethers.formatUnits(
            maxDebtToCover,
            debt.decimals
          ),
          bonusPercent,
          estimatedBonus,
          healthFactor: position.healthFactorFormatted,
          user: position.user,
        });
      }
    }

    // Sap xep theo bonus giam dan
    return opportunities.sort((a, b) => b.bonusPercent - a.bonusPercent);
  }
}

const LIQUIDATION_EXECUTOR_ABI = [
  "function executeLiquidation(address _debtAsset, uint256 _debtAmount, bytes calldata _params) external",
];

class LiquidationExecutor {
  constructor(provider, wallet, aavePoolAddress, flashloanContractAddress) {
    this.provider = provider;
    this.wallet = wallet;
    this.pool = new ethers.Contract(aavePoolAddress, AAVE_POOL_ABI, wallet);
    this.flashloanContractAddress = flashloanContractAddress;
    this.flashloanContract = flashloanContractAddress
      ? new ethers.Contract(flashloanContractAddress, LIQUIDATION_EXECUTOR_ABI, wallet)
      : null;
    this.executionHistory = [];
  }

  /**
   * Thuc hien thanh ly voi flashloan
   *
   * Flow:
   * 1. Flashloan debt token
   * 2. Goi liquidationCall tren Aave
   * 3. Nhan collateral + bonus
   * 4. Swap collateral -> debt token
   * 5. Tra flashloan
   * 6. Giu lai loi nhuan
   */
  async executeLiquidation(opportunity, dryRun = true) {
    console.log("\n========================================");
    console.log("  LIQUIDATION OPPORTUNITY DETECTED");
    console.log("========================================");
    console.log(`User: ${opportunity.user}`);
    console.log(`Health Factor: ${opportunity.healthFactor}`);
    console.log(
      `Debt: ${opportunity.debtToCoverFormatted} ${opportunity.debtSymbol}`
    );
    console.log(
      `Collateral: ${opportunity.collateralSymbol} (Bonus: ${opportunity.bonusPercent}%)`
    );

    if (dryRun) {
      console.log("\n[DRY RUN] Khong thuc hien giao dich that");
      console.log("Dat autoExecute: true de chay that\n");
      return { success: false, reason: "dry_run" };
    }

    try {
      const feeData = await this.provider.getFeeData();
      let tx;

      if (this.flashloanContract) {
        // Use flashloan contract: no upfront capital needed
        console.log(`Using flashloan contract: ${this.flashloanContractAddress}`);

        // Encode LiquidationParams struct for the flashloan callback
        // Must match contract struct: (address,address,address,uint256,bool,uint24,uint256)
        const minProfitBps = opportunity.minProfitBps || 50; // default 0.5% minimum profit
        const params = ethers.AbiCoder.defaultAbiCoder().encode(
          ["tuple(address,address,address,uint256,bool,uint24,uint256)"],
          [[
            opportunity.collateralAsset,
            opportunity.debtAsset,
            opportunity.user,
            opportunity.debtToCover,
            true,   // useV3
            3000,   // default fee tier
            minProfitBps, // MEV protection: minimum profit in basis points
          ]]
        );

        const gasEstimate = await this.flashloanContract.executeLiquidation.estimateGas(
          opportunity.debtAsset,
          opportunity.debtToCover,
          params
        );

        const gasCost = gasEstimate * feeData.gasPrice;
        console.log(`Gas estimate: ${gasEstimate.toString()}`);
        console.log(`Gas cost: ${ethers.formatEther(gasCost)} ETH`);

        tx = await this.flashloanContract.executeLiquidation(
          opportunity.debtAsset,
          opportunity.debtToCover,
          params,
          {
            gasLimit: (gasEstimate * 130n) / 100n,
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
          }
        );
      } else if (process.env.ALLOW_DIRECT_LIQUIDATION === "true") {
        // Direct EOA liquidation — only allowed with explicit opt-in flag
        console.warn("[EOA MODE] Direct liquidationCall from wallet. Requires holding debt tokens.");

        const gasEstimate = await this.pool.liquidationCall.estimateGas(
          opportunity.collateralAsset,
          opportunity.debtAsset,
          opportunity.user,
          opportunity.debtToCover,
          false
        );

        const gasCost = gasEstimate * feeData.gasPrice;
        console.log(`Gas estimate: ${gasEstimate.toString()}`);
        console.log(`Gas cost: ${ethers.formatEther(gasCost)} ETH`);

        tx = await this.pool.liquidationCall(
          opportunity.collateralAsset,
          opportunity.debtAsset,
          opportunity.user,
          opportunity.debtToCover,
          false,
          {
            gasLimit: (gasEstimate * 130n) / 100n,
            maxFeePerGas: feeData.maxFeePerGas,
            maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
          }
        );
      } else {
        throw new Error("No flashloan contract configured and ALLOW_DIRECT_LIQUIDATION not set. Cannot execute liquidation.");
      }

      console.log(`TX sent: ${tx.hash}`);
      const receipt = await tx.wait(1);

      const result = {
        success: receipt.status === 1,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
        opportunity,
        timestamp: Date.now(),
      };

      this.executionHistory.push(result);

      if (result.success) {
        console.log("LIQUIDATION SUCCESSFUL!");
      } else {
        console.log("LIQUIDATION FAILED (reverted)");
      }

      return result;
    } catch (error) {
      console.error(`Execution error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

// ============ Main Bot ============

// Use shared capability matrix for chain validation
const { supportsStrategy, getSupportedChains } = require("../config/chain-capabilities");

class LiquidationBot {
  constructor(chain = "arbitrum") {
    this.chainName = chain;
    this.chainConfig = CHAIN_CONFIG[chain];
    if (!this.chainConfig || !supportsStrategy(chain, "liquidation")) {
      const supported = getSupportedChains("liquidation").join(", ");
      throw new Error(`Liquidation bot does not support chain "${chain}". Supported chains: ${supported}. Liquidation requires Aave V3 + CHAIN_CONFIG entry.`);
    }
    this.isRunning = false;
    this.stats = {
      scansCompleted: 0,
      positionsScanned: 0,
      liquidationsFound: 0,
      liquidationsExecuted: 0,
      atRiskPositions: 0,
    };
  }

  async initialize() {
    console.log("\n====================================");
    console.log("  FLASHLOAN-AI: Liquidation Bot");
    console.log(`  Chain: ${this.chainName}`);
    console.log("====================================\n");

    this.provider = new ethers.JsonRpcProvider(this.chainConfig.rpc);
    const network = await this.provider.getNetwork();
    console.log(`Connected: chainId ${network.chainId}`);

    // Setup wallet (optional - chi can khi autoExecute = true)
    if (process.env.PRIVATE_KEY) {
      this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
      console.log(`Wallet: ${this.wallet.address}`);
    } else {
      console.log("No wallet configured - monitoring mode only");
    }

    // Setup tracker
    this.tracker = new PositionTracker(this.provider, this.chainConfig);

    // Setup executor — fail-closed: require flashloan contract in live mode
    if (this.wallet) {
      const flashloanAddress = process.env.FLASHLOAN_CONTRACT_ADDRESS || null;
      const isPaperTrading = process.env.PAPER_TRADING === "true";
      const allowDirectLiquidation = process.env.ALLOW_DIRECT_LIQUIDATION === "true";

      if (!flashloanAddress && !isPaperTrading && !allowDirectLiquidation) {
        throw new Error(
          "FLASHLOAN_CONTRACT_ADDRESS not set. Liquidation bot refuses to start in live mode without a flashloan executor contract. " +
          "Deploy the LiquidationExecutor first, or set PAPER_TRADING=true for monitoring, or ALLOW_DIRECT_LIQUIDATION=true for EOA mode (advanced/debug only)."
        );
      }
      if (!flashloanAddress && isPaperTrading) {
        console.log("[INFO] Paper trading mode — no flashloan contract needed, monitoring only.");
      } else if (!flashloanAddress && allowDirectLiquidation) {
        console.warn("[WARNING] ALLOW_DIRECT_LIQUIDATION=true — using direct EOA liquidation. This requires holding debt tokens and changes the risk model.");
      } else {
        console.log(`Flashloan contract: ${flashloanAddress}`);
      }
      this.executor = new LiquidationExecutor(
        this.provider,
        this.wallet,
        this.chainConfig.aavePool,
        flashloanAddress
      );
    }

    // Initial borrower discovery
    await this.tracker.discoverBorrowers(5000);

    console.log("\nLiquidation Bot initialized!\n");
  }

  async scanOnce() {
    // Phat hien borrowers moi (moi 10 scan)
    if (this.stats.scansCompleted % 10 === 0) {
      await this.tracker.discoverBorrowers(500);
    }

    // Quet tat ca vi tri
    const { liquidatable, atRisk, scanned } =
      await this.tracker.scanAllPositions();

    this.stats.scansCompleted++;
    this.stats.positionsScanned += scanned;
    this.stats.atRiskPositions = atRisk.length;

    // Log at-risk positions
    if (atRisk.length > 0 && this.stats.scansCompleted % 5 === 0) {
      console.log(
        `\n[WATCH] ${atRisk.length} positions at risk (HF < 1.1):`
      );
      for (const pos of atRisk.slice(0, 5)) {
        console.log(
          `  ${pos.user.slice(0, 10)}... HF: ${pos.healthFactorFormatted.toFixed(4)}`
        );
      }
    }

    // Xu ly cac vi tri co the thanh ly
    if (liquidatable.length > 0) {
      console.log(
        `\n*** ${liquidatable.length} LIQUIDATABLE POSITIONS FOUND ***`
      );
      this.stats.liquidationsFound += liquidatable.length;

      for (const position of liquidatable) {
        // Lay chi tiet
        const details = await this.tracker.getPositionDetails(position.user);
        const opportunities = LiquidationCalculator.calculateProfit(
          position,
          details,
          this.chainConfig
        );

        if (opportunities && opportunities.length > 0) {
          const best = opportunities[0];
          console.log(
            `Best: ${best.debtSymbol}->${best.collateralSymbol} | Bonus: ${best.bonusPercent}%`
          );

          if (this.executor) {
            // Respect PAPER_TRADING env var; default to dry run for safety
            const dryRun = process.env.PAPER_TRADING !== 'false';
            const result = await this.executor.executeLiquidation(
              best,
              dryRun
            );

            if (result.success) {
              this.stats.liquidationsExecuted++;
            }
          }
        }
      }
    } else if (this.stats.scansCompleted % 20 === 0) {
      console.log(
        `[SCAN #${this.stats.scansCompleted}] ${scanned} positions scanned, no liquidations`
      );
    }
  }

  async start(intervalMs = 5000) {
    await this.initialize();

    this.isRunning = true;
    console.log(`Starting scan loop (interval: ${intervalMs}ms)...`);
    console.log("Press Ctrl+C to stop\n");

    process.on("SIGINT", () => this.stop());

    while (this.isRunning) {
      try {
        await this.scanOnce();
      } catch (error) {
        console.error(`Scan error: ${error.message}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  stop() {
    this.isRunning = false;
    console.log("\n====================================");
    console.log("  Liquidation Bot - Summary");
    console.log("====================================");
    console.log(`Scans: ${this.stats.scansCompleted}`);
    console.log(`Positions scanned: ${this.stats.positionsScanned}`);
    console.log(`Liquidations found: ${this.stats.liquidationsFound}`);
    console.log(`Liquidations executed: ${this.stats.liquidationsExecuted}`);
    console.log(`At-risk positions (last): ${this.stats.atRiskPositions}`);
    console.log("====================================\n");
    process.exit(0);
  }
}

// ============ Entry Point ============

async function main() {
  const chain = process.env.BOT_CHAIN || process.argv[2] || "arbitrum";
  const bot = new LiquidationBot(chain);

  try {
    await bot.start(5000);
  } catch (error) {
    console.error(`Fatal: ${error.message}`);
    process.exit(1);
  }
}

main();

module.exports = {
  LiquidationBot,
  PositionTracker,
  LiquidationCalculator,
  LiquidationExecutor,
};
