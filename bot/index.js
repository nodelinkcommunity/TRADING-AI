/**
 * FLASHLOAN-AI: Entry Point
 * Chay tat ca hoac tung bot rieng le
 *
 * Usage:
 *   node bot/index.js --all        # Chay tat ca bots
 *   node bot/index.js --arb        # Chi chay arbitrage bot
 *   node bot/index.js --liq        # Chi chay liquidation bot
 *   node bot/index.js --stable     # Chi chay stablecoin scanner
 *   node bot/index.js --liq --arb  # Chay nhieu bots
 */

const { createLogger } = require("./utils/logger");

const log = createLogger("MAIN");

// Parse command line flags
function parseFlags() {
  const args = process.argv.slice(2);
  const flags = {
    all: args.includes("--all"),
    arb: args.includes("--arb"),
    liq: args.includes("--liq"),
    stable: args.includes("--stable"),
  };

  // Neu khong co flag nao, mac dinh la --arb
  if (!flags.all && !flags.arb && !flags.liq && !flags.stable) {
    flags.arb = true;
  }

  // --all bat tat ca
  if (flags.all) {
    flags.arb = true;
    flags.liq = true;
    flags.stable = true;
  }

  return flags;
}

async function startArbitrageBot() {
  const { FlashloanBot } = require("./monitor");
  const bot = new FlashloanBot();
  await bot.start();
}

async function startLiquidationBot() {
  const { LiquidationBot } = require("./liquidation-bot");
  const chain = process.env.CHAIN || "arbitrum";
  const bot = new LiquidationBot(chain);
  await bot.start(5000);
}

async function startStablecoinScanner() {
  const { StablecoinBot } = require("./stablecoin-scanner");
  const chain = process.env.CHAIN || "arbitrum";
  const bot = new StablecoinBot(chain);
  await bot.start(10000);
}

async function main() {
  log.banner("FLASHLOAN-AI v1.0 - Multi-Bot System");

  const flags = parseFlags();

  log.info("Configuration:");
  log.info(`  Arbitrage Bot:      ${flags.arb ? "ON" : "OFF"}`);
  log.info(`  Liquidation Bot:    ${flags.liq ? "ON" : "OFF"}`);
  log.info(`  Stablecoin Scanner: ${flags.stable ? "ON" : "OFF"}`);
  console.log();

  // Graceful shutdown
  const cleanup = () => {
    log.warn("Shutting down all bots...");
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const tasks = [];

  if (flags.arb) {
    log.info("Starting Arbitrage Bot...");
    tasks.push(
      startArbitrageBot().catch((err) => {
        log.error(`Arbitrage Bot crashed: ${err.message}`);
      })
    );
  }

  if (flags.liq) {
    log.info("Starting Liquidation Bot...");
    tasks.push(
      startLiquidationBot().catch((err) => {
        log.error(`Liquidation Bot crashed: ${err.message}`);
      })
    );
  }

  if (flags.stable) {
    log.info("Starting Stablecoin Scanner...");
    tasks.push(
      startStablecoinScanner().catch((err) => {
        log.error(`Stablecoin Scanner crashed: ${err.message}`);
      })
    );
  }

  await Promise.allSettled(tasks);
}

main().catch((err) => {
  log.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
