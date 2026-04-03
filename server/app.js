/**
 * FLASHLOAN-AI Web Server
 * Express + Socket.IO backend for controlling DeFi arbitrage bots
 * Runs on VPS, accessible via browser at http://YOUR_IP:3000
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ============ CONFIG ============

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const ENV_PATH = path.join(__dirname, "..", ".env");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const SESSION_SECRET = crypto.randomBytes(32).toString("hex");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============ TRADE HISTORY ============

const TRADES_PATH = path.join(DATA_DIR, "trades.json");
let tradeHistory = [];
// Load existing trades
if (fs.existsSync(TRADES_PATH)) {
  try { tradeHistory = JSON.parse(fs.readFileSync(TRADES_PATH, "utf8")); } catch(e) {}
}
function saveTrades() {
  fs.writeFileSync(TRADES_PATH, JSON.stringify(tradeHistory, null, 2));
}

// Default configuration
const DEFAULT_CONFIG = {
  // Credential status (actual keys stored in .env only)
  privateKeySet: false,
  rpcUrlSet: false,

  // Network (multi-chain support)
  chain: "arbitrumSepolia",
  chains: ["arbitrumSepolia"],
  contractAddress: "",
  contractAddresses: {},

  // Trading parameters
  paperTrading: true,
  autoExecute: false,
  minProfitBps: 15,
  maxSlippageBps: 50,
  scanIntervalMs: 3000,
  maxGasGwei: 5,
  flashAmountUsd: 50000,

  // 7 Strategies
  strategies: {
    dexArbitrage: {
      enabled: true,
      pairs: ["WETH/USDC", "WETH/USDT", "WETH/ARB"],
      dexes: ["uniswapV3", "sushiswap", "camelot"],
    },
    triangular: {
      enabled: false,
      triplets: ["WETH/USDC/DAI", "WETH/ARB/USDC"],
    },
    liquidation: {
      enabled: true,
      hfThreshold: 1.1,
      minBonus: 5,
      protocols: ["aave"],
    },
    stablecoin: {
      enabled: true,
      depegThreshold: 10,
      flashAmount: 50000,
      assets: ["USDC", "USDT", "DAI", "FRAX", "MIM", "USDCe"],
    },
    newPool: {
      enabled: false,
      autoApprove: false,
      maxBuyUsd: 100,
      takeProfitMultiple: 2,
      stopLossPercent: 50,
    },
    oracleLag: {
      enabled: false,
      autoExecute: false,
      sources: ["chainlink", "pyth"],
    },
    yieldRebalance: {
      enabled: false,
      minApyDiff: 1.0,
      protocols: ["aave", "compound", "morpho"],
    },
  },

  // Alerts
  alertMode: "console",
  telegramToken: "",
  telegramChatId: "",
};

// ============ STATE ============

let config = loadConfig();
let botProcesses = {};
let logs = [];
let aiStatus = {
  isRunning: false,
  regime: { regime: "UNKNOWN", volatility: 0, trend: 0, confidence: 0, bestStrategies: ["dexArbitrage"], riskLevel: { level: "UNKNOWN", score: 50, action: "CAUTIOUS" } },
  gasPrediction: { predicted: 0, current: 0, avg: 0, trend: "STABLE", confidence: 0, recommendation: "NORMAL" },
  scorerSummary: { totalTrades: 0, successCount: 0, winRate: 0, dexStats: {}, hourStats: {} },
  whaleActivity: { totalVolume: 0, swapCount: 0, buyPressure: 50, sellPressure: 50, impactEstimate: "NONE" },
  sandwichSummary: { knownAttackers: 0, recentPatterns: 0, totalPatterns: 0 },
  recentAnalyses: [],
};
let stats = {
  startTime: null,
  scansCompleted: 0,
  opportunitiesFound: 0,
  tradesExecuted: 0,
  totalProfitUsd: 0,
  gasSpent: 0,
  uptime: 0,
};

let tradeStats = {
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  totalProfitUsd: 0,
  totalGasCostUsd: 0,
  netProfitUsd: 0,
  bestTradeUsd: 0,
  worstTradeUsd: 0,
  winRate: 0,
  avgProfitPerTrade: 0,
  totalVolumeUsd: 0,
  todayTrades: 0,
  todayProfitUsd: 0,
  streakWins: 0,
  streakLosses: 0,
  paperTrades: 0,
  paperProfitUsd: 0,
  paperWinRate: 0,
  byStrategy: {},
  byChain: {},
  byHour: {},
};

function recalcStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  tradeStats = {
    totalTrades: 0, successfulTrades: 0, failedTrades: 0,
    totalProfitUsd: 0, totalGasCostUsd: 0, netProfitUsd: 0,
    bestTradeUsd: 0, worstTradeUsd: 0, winRate: 0,
    avgProfitPerTrade: 0, totalVolumeUsd: 0,
    todayTrades: 0, todayProfitUsd: 0,
    streakWins: 0, streakLosses: 0,
    paperTrades: 0, paperProfitUsd: 0, paperWinRate: 0,
    byStrategy: {}, byChain: {}, byHour: {},
  };

  let currentStreak = 0;
  let lastWasWin = null;
  let paperWins = 0;

  for (const t of tradeHistory) {
    // Count paper trades separately — don't mix into real trade stats
    if (t.paper) {
      tradeStats.paperTrades++;
      tradeStats.paperProfitUsd += (t.profitUsd || 0);
      if (t.success) paperWins++;
      continue; // Skip paper trades from main statistics
    }

    tradeStats.totalTrades++;
    const profit = t.profitUsd || 0;
    const gasCost = t.gasCostUsd || 0;
    const volume = t.volumeUsd || 0;

    if (t.success) {
      tradeStats.successfulTrades++;
      if (lastWasWin === true) currentStreak++;
      else currentStreak = 1;
      lastWasWin = true;
      tradeStats.streakWins = Math.max(tradeStats.streakWins, currentStreak);
    } else {
      tradeStats.failedTrades++;
      if (lastWasWin === false) currentStreak++;
      else currentStreak = 1;
      lastWasWin = false;
      tradeStats.streakLosses = Math.max(tradeStats.streakLosses, currentStreak);
    }

    tradeStats.totalProfitUsd += profit;
    tradeStats.totalGasCostUsd += gasCost;
    tradeStats.totalVolumeUsd += volume;

    if (profit > tradeStats.bestTradeUsd) tradeStats.bestTradeUsd = profit;
    if (profit < tradeStats.worstTradeUsd) tradeStats.worstTradeUsd = profit;

    // Today stats
    if (t.timestamp >= todayStart) {
      tradeStats.todayTrades++;
      tradeStats.todayProfitUsd += profit;
    }

    // By strategy
    const strat = t.strategy || "unknown";
    if (!tradeStats.byStrategy[strat]) tradeStats.byStrategy[strat] = { count: 0, profit: 0, wins: 0 };
    tradeStats.byStrategy[strat].count++;
    tradeStats.byStrategy[strat].profit += profit;
    if (t.success) tradeStats.byStrategy[strat].wins++;

    // By chain
    const chain = t.chain || "unknown";
    if (!tradeStats.byChain[chain]) tradeStats.byChain[chain] = { count: 0, profit: 0 };
    tradeStats.byChain[chain].count++;
    tradeStats.byChain[chain].profit += profit;

    // By hour
    const hour = new Date(t.timestamp).getHours();
    if (!tradeStats.byHour[hour]) tradeStats.byHour[hour] = { count: 0, profit: 0 };
    tradeStats.byHour[hour].count++;
    tradeStats.byHour[hour].profit += profit;
  }

  tradeStats.netProfitUsd = tradeStats.totalProfitUsd - tradeStats.totalGasCostUsd;
  tradeStats.winRate = tradeStats.totalTrades > 0 ? (tradeStats.successfulTrades / tradeStats.totalTrades * 100) : 0;
  tradeStats.avgProfitPerTrade = tradeStats.totalTrades > 0 ? (tradeStats.netProfitUsd / tradeStats.totalTrades) : 0;
  tradeStats.paperWinRate = tradeStats.paperTrades > 0 ? (paperWins / tradeStats.paperTrades * 100) : 0;
}

// Recalculate on startup
recalcStats();

// ============ HELPERS ============

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      // Deep merge strategies
      const merged = { ...DEFAULT_CONFIG, ...saved };
      if (saved.strategies) {
        merged.strategies = { ...DEFAULT_CONFIG.strategies };
        for (const [key, val] of Object.entries(saved.strategies)) {
          merged.strategies[key] = { ...DEFAULT_CONFIG.strategies[key], ...val };
        }
      }
      // Migrate old single contractAddress to per-chain map
      if (!merged.contractAddresses) merged.contractAddresses = {};
      if (merged.contractAddress && !merged.contractAddresses[merged.chain]) {
        merged.contractAddresses[merged.chain] = merged.contractAddress;
      }
      return merged;
    }
  } catch (e) {
    console.error("Failed to load config:", e.message);
  }

  // Check .env for credential status
  const cfg = { ...DEFAULT_CONFIG };
  if (fs.existsSync(ENV_PATH)) {
    const env = fs.readFileSync(ENV_PATH, "utf8");
    cfg.privateKeySet = /PRIVATE_KEY=0x[a-fA-F0-9]{64}/.test(env);
    // Check RPC URL for any configured chain
    cfg.rpcUrlSet = /(ARBITRUM|BASE|POLYGON|BSC|AVAX|MANTLE|SCROLL)_RPC_URL=https?:\/\/.+/.test(env);
  }
  return cfg;
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error("Failed to save config:", e.message);
  }
}

function addLog(type, source, message) {
  const entry = {
    id: Date.now(),
    time: new Date().toISOString(),
    type, // info, warn, error, trade, profit, system
    source, // server, arbitrage, liquidation, stablecoin, deploy, compile
    message,
  };
  logs.push(entry);
  if (logs.length > 2000) logs = logs.slice(-1000);
  io.emit("log", entry);
  return entry;
}

function updateEnvVar(key, value) {
  let content = "";
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, "utf8");
  }

  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }

  fs.writeFileSync(ENV_PATH, content.trim() + "\n");
}

function loadEnvVars() {
  const vars = {};
  if (fs.existsSync(ENV_PATH)) {
    const lines = fs.readFileSync(ENV_PATH, "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^([^#=\s]+)\s*=\s*(.+)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    }
  }
  return vars;
}

// ============ BOT MANAGEMENT ============

const BOT_FILES = {
  arbitrage: "bot/monitor.js",
  liquidation: "bot/liquidation-bot.js",
  stablecoin: "bot/stablecoin-scanner.js",
};

function startBot(botName) {
  if (botProcesses[botName]) {
    addLog("warn", "server", `Bot "${botName}" is already running`);
    return false;
  }

  const file = BOT_FILES[botName];
  if (!file) {
    addLog("error", "server", `Unknown bot: "${botName}"`);
    return false;
  }

  const botPath = path.join(__dirname, "..", file);
  if (!fs.existsSync(botPath)) {
    addLog("error", "server", `Bot file not found: ${file}`);
    return false;
  }

  addLog("info", botName, `Starting ${botName} bot...`);

  const proc = spawn("node", [botPath], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      ...loadEnvVars(),
      ...((() => {
        const botChain = config.chain || "arbitrumSepolia";
        const addr = config.contractAddresses?.[botChain] || config.contractAddress || "";
        return addr ? { CONTRACT_ADDRESS: addr } : {};
      })()),
      BOT_CHAIN: config.chain || "arbitrumSepolia",
      FLASH_AMOUNT_USD: String(config.flashAmountUsd || 50000),
      PAPER_TRADING: config.paperTrading ? "true" : "false",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  proc.stdout.on("data", (data) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      if (line.trim()) {
        addLog("info", botName, line.trim());
        parseLogForStats(line.trim());
      }
    }
  });

  proc.stderr.on("data", (data) => {
    addLog("error", botName, data.toString().trim());
  });

  proc.on("close", (code) => {
    const level = code === 0 ? "info" : "error";
    addLog(level, botName, `Bot "${botName}" exited with code ${code}`);
    delete botProcesses[botName];
    io.emit("botStatus", getBotStatuses());
  });

  proc.on("error", (err) => {
    addLog("error", botName, `Process error: ${err.message}`);
    delete botProcesses[botName];
    io.emit("botStatus", getBotStatuses());
  });

  botProcesses[botName] = proc;
  if (!stats.startTime) stats.startTime = Date.now();
  io.emit("botStatus", getBotStatuses());
  addLog("info", botName, `Bot "${botName}" started successfully`);
  return true;
}

function stopBot(botName) {
  const proc = botProcesses[botName];
  if (!proc) {
    addLog("warn", "server", `Bot "${botName}" is not running`);
    return false;
  }

  addLog("info", botName, `Stopping ${botName} bot...`);
  proc.kill("SIGTERM");

  // Force kill after 5 seconds if still running
  setTimeout(() => {
    if (botProcesses[botName]) {
      proc.kill("SIGKILL");
      delete botProcesses[botName];
      io.emit("botStatus", getBotStatuses());
      addLog("warn", botName, `Bot "${botName}" force-killed after timeout`);
    }
  }, 5000);

  return true;
}

function stopAllBots() {
  const names = Object.keys(botProcesses);
  for (const name of names) {
    stopBot(name);
  }
  addLog("info", "server", `Stop-all issued for ${names.length} bot(s)`);
}

function getBotStatuses() {
  return {
    arbitrage: !!botProcesses.arbitrage,
    liquidation: !!botProcesses.liquidation,
    stablecoin: !!botProcesses.stablecoin,
  };
}

function parseLogForStats(line) {
  const lower = line.toLowerCase();
  if (lower.includes("[scan #")) stats.scansCompleted++;
  if (/found \d+ opportunit/i.test(line)) stats.opportunitiesFound++;
  if (lower.includes("[trade] executed") || lower.includes("transaction sent:")) stats.tradesExecuted++;

  // Parse paper (simulated) trades
  if (line.startsWith("[PAPER]")) {
    const trade = {
      id: Date.now() + Math.random(),
      timestamp: Date.now(),
      paper: true,
      strategy: "dexArbitrage",
      chain: config.chains?.[0] || "arbitrumSepolia",
      pair: "WETH/USDC",
      type: "SIMPLE",
      volumeUsd: config.flashAmountUsd || 50000,
      buyPrice: 0,
      sellPrice: 0,
      gasCostUsd: 0,
      profitUsd: 0,
      profitBps: 0,
      success: line.includes("PROFIT"),
      txHash: "paper-" + Date.now().toString(16),
      gasUsed: 350000,
      blockNumber: 0,
      aiScore: 0,
    };

    // Parse structured fields (use first colon only to handle values with colons)
    const fields = line.split("|").map(f => f.trim());
    for (const field of fields) {
      const colonIdx = field.indexOf(":");
      if (colonIdx === -1) continue;
      const key = field.slice(0, colonIdx).trim();
      const val = field.slice(colonIdx + 1).trim();
      if (!key || !val) continue;
      switch(key) {
        case "strategy": trade.strategy = val; break;
        case "pair": trade.pair = val; break;
        case "chain": trade.chain = val; break;
        case "volume": trade.volumeUsd = parseFloat(val) || 0; break;
        case "buyPrice": trade.buyPrice = parseFloat(val) || 0; break;
        case "sellPrice": trade.sellPrice = parseFloat(val) || 0; break;
        case "gasCost": trade.gasCostUsd = parseFloat(val) || 0; break;
        case "profit": trade.profitUsd = parseFloat(val) || 0; break;
        case "profitBps": trade.profitBps = parseInt(val) || 0; break;
        case "aiScore": trade.aiScore = parseInt(val) || 0; break;
        case "steps": trade.steps = val; break;
        case "dexBuy": trade.dexBuy = val; break;
        case "dexSell": trade.dexSell = val; break;
      }
    }

    tradeHistory.unshift(trade);
    if (tradeHistory.length > 10000) tradeHistory = tradeHistory.slice(0, 10000);
    saveTrades();
    recalcStats();
    io.emit("tradeStats", tradeStats);
    io.emit("newTrade", trade);
    return;
  }

  // Parse real trade logs: [TRADE] EXECUTED | success:true | txHash:0x... | ...
  // and [TRADE] FAILED | success:false | ...
  if (line.startsWith("[TRADE]")) {
    const trade = {
      id: Date.now() + Math.random(),
      timestamp: Date.now(),
      paper: false,
      strategy: "dexArbitrage",
      chain: config.chain || "arbitrumSepolia",
      pair: "WETH/USDC",
      type: "SIMPLE",
      volumeUsd: config.flashAmountUsd || 50000,
      buyPrice: 0,
      sellPrice: 0,
      gasCostUsd: 0,
      profitUsd: 0,
      profitBps: 0,
      success: line.includes("success:true"),
      txHash: "",
      gasUsed: 0,
      blockNumber: 0,
      aiScore: 0,
    };

    // Parse structured fields (same format as [PAPER])
    const fields = line.split("|").map(f => f.trim());
    for (const field of fields) {
      const colonIdx = field.indexOf(":");
      if (colonIdx === -1) continue;
      const key = field.slice(0, colonIdx).trim();
      const val = field.slice(colonIdx + 1).trim();
      if (!key || !val) continue;
      switch(key) {
        case "txHash": trade.txHash = val; break;
        case "pair": trade.pair = val; break;
        case "chain": trade.chain = val; break;
        case "strategy": trade.strategy = val; trade.type = val === "TRIANGULAR" ? "TRIANGULAR" : "SIMPLE"; break;
        case "profitBps": trade.profitBps = parseInt(val) || 0; break;
        case "gasUsed": trade.gasUsed = parseInt(val) || 0; break;
        case "block": trade.blockNumber = parseInt(val) || 0; break;
        case "error": trade.errorMessage = val; break;
      }
    }

    // Estimate profit in USD from profitBps
    if (trade.profitBps > 0 && trade.success) {
      trade.profitUsd = (trade.volumeUsd * trade.profitBps) / 10000;
    }

    tradeHistory.unshift(trade);
    if (tradeHistory.length > 10000) tradeHistory = tradeHistory.slice(0, 10000);
    saveTrades();
    recalcStats();
    io.emit("tradeStats", tradeStats);
    io.emit("newTrade", trade);
    return;
  }

  // Parse AI log lines: [AI] Score: 75/100 | EXECUTE | ...
  if (line.startsWith("[AI] Score:")) {
    try {
      const scoreMatch = line.match(/Score:\s*(\d+)\/100/);
      const actionMatch = line.match(/\|\s*(EXECUTE|WATCH|SKIP)\s*\|/);
      if (scoreMatch) {
        const score = parseInt(scoreMatch[1]);
        const action = actionMatch ? actionMatch[1] : "WATCH";
        const reasoning = line.replace("[AI] ", "");

        // Update recent analyses in aiStatus
        aiStatus.recentAnalyses.push({
          score,
          recommendation: { action },
          reasoning,
          timestamp: Date.now(),
        });
        if (aiStatus.recentAnalyses.length > 10) aiStatus.recentAnalyses.shift();
        aiStatus.isRunning = true;
      }
    } catch (_) {}
  }

  // Parse AI engine ready
  if (line.includes("[AI] AI Engine ready")) {
    aiStatus.isRunning = true;
  }
}

// ============ MIDDLEWARE ============

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ============ API ROUTES ============

// GET full application state
app.get("/api/state", (req, res) => {
  const envVars = loadEnvVars();
  res.json({
    config: {
      ...config,
      privateKeySet: !!envVars.PRIVATE_KEY && envVars.PRIVATE_KEY.length > 10,
      rpcUrlSet: (() => {
        const rpcMap = { arbitrum: "ARBITRUM_RPC_URL", arbitrumSepolia: "ARBITRUM_RPC_URL", base: "BASE_RPC_URL", baseSepolia: "BASE_RPC_URL", polygon: "POLYGON_RPC_URL", bsc: "BSC_RPC_URL", avalanche: "AVAX_RPC_URL", mantle: "MANTLE_RPC_URL", scroll: "SCROLL_RPC_URL" };
        const key = rpcMap[config.chain] || "ARBITRUM_RPC_URL";
        return !!envVars[key] && envVars[key].startsWith("http");
      })(),
    },
    bots: getBotStatuses(),
    stats,
    logsCount: logs.length,
  });
});

// GET logs with optional filter
app.get("/api/logs", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const source = req.query.source;
  let filtered = logs;
  if (source) filtered = logs.filter((l) => l.source === source);
  res.json(filtered.slice(-limit));
});

// POST update credentials (stored in .env file)
app.post("/api/credentials", (req, res) => {
  const { privateKey, rpcUrl, arbiscanKey, telegramToken, telegramChatId } = req.body;

  if (privateKey) {
    // Auto-add 0x prefix if missing (MetaMask exports without it)
    let pk = privateKey.trim();
    if (/^[a-fA-F0-9]{64}$/.test(pk)) pk = "0x" + pk;
    if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
      return res.status(400).json({ error: "Invalid private key format (expected 64 hex characters, with or without 0x prefix)" });
    }
    updateEnvVar("PRIVATE_KEY", pk);
    addLog("info", "server", "Private key updated");
  }

  if (rpcUrl) {
    if (!rpcUrl.startsWith("http")) {
      return res.status(400).json({ error: "Invalid RPC URL format (must start with http)" });
    }
    // Save to the correct env var based on selected chain
    const chain = config.chain || "arbitrumSepolia";
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
    const envKey = rpcEnvMap[chain] || "ARBITRUM_RPC_URL";
    updateEnvVar(envKey, rpcUrl);
    addLog("info", "server", `RPC URL updated for ${chain} (${envKey})`);
  }

  if (arbiscanKey) {
    updateEnvVar("ARBISCAN_API_KEY", arbiscanKey);
    addLog("info", "server", "Arbiscan API key updated");
  }
  if (telegramToken) {
    updateEnvVar("TELEGRAM_BOT_TOKEN", telegramToken);
    addLog("info", "server", "Telegram bot token updated");
  }
  if (telegramChatId) {
    updateEnvVar("TELEGRAM_CHAT_ID", telegramChatId);
    addLog("info", "server", "Telegram chat ID updated");
  }

  res.json({ success: true, message: "Credentials saved" });
});

// POST update trading configuration
app.post("/api/config", (req, res) => {
  const updates = req.body;
  // Don't allow overwriting strategies via this endpoint
  const { strategies, ...rest } = updates;
  config = { ...config, ...rest };
  // If a contractAddress was provided, save it per-chain too
  if (rest.contractAddress && config.chain) {
    if (!config.contractAddresses) config.contractAddresses = {};
    config.contractAddresses[config.chain] = rest.contractAddress;
  }
  saveConfig();
  addLog("info", "server", "Configuration updated");
  io.emit("configUpdate", config);
  res.json({ success: true, config });
});

// POST update individual strategy
app.post("/api/strategy/:name", (req, res) => {
  const { name } = req.params;
  if (!config.strategies[name]) {
    return res.status(404).json({ error: `Strategy "${name}" not found` });
  }
  config.strategies[name] = { ...config.strategies[name], ...req.body };
  saveConfig();
  const status = config.strategies[name].enabled ? "enabled" : "disabled";
  addLog("info", "server", `Strategy "${name}" ${status}`);

  // Auto-stop bot when strategy is disabled
  if (!config.strategies[name].enabled) {
    const strategyToBots = {
      dexArbitrage: "arbitrage",
      triangular: "arbitrage",
      liquidation: "liquidation",
      stablecoin: "stablecoin",
      newPool: "arbitrage",
      oracleLag: "arbitrage",
      yieldRebalance: "arbitrage",
    };
    const botName = strategyToBots[name];
    if (botName && botProcesses[botName]) {
      // For arbitrage bot: only stop if ALL related strategies are off
      if (botName === "arbitrage") {
        const arbStrategies = ["dexArbitrage", "triangular", "newPool", "oracleLag", "yieldRebalance"];
        const anyEnabled = arbStrategies.some((s) => config.strategies[s]?.enabled);
        if (!anyEnabled) {
          stopBot("arbitrage");
          addLog("info", "server", `Auto-stopped "arbitrage" bot (all related strategies disabled)`);
        }
      } else {
        stopBot(botName);
        addLog("info", "server", `Auto-stopped "${botName}" bot (strategy "${name}" disabled)`);
      }
    }
  }

  res.json({ success: true, strategy: config.strategies[name] });
});

// POST start a specific bot
app.post("/api/bot/:name/start", (req, res) => {
  const { name } = req.params;
  const ok = startBot(name);
  res.json({ success: ok, message: ok ? `Bot "${name}" started` : `Failed to start "${name}"` });
});

// POST stop a specific bot
app.post("/api/bot/:name/stop", (req, res) => {
  const { name } = req.params;
  const ok = stopBot(name);
  res.json({ success: ok, message: ok ? `Bot "${name}" stopping` : `Bot "${name}" not running` });
});

// POST start all enabled bots
app.post("/api/bot/start-all", (req, res) => {
  const results = {};
  const strats = config.strategies;
  if (strats.dexArbitrage?.enabled || strats.triangular?.enabled) results.arbitrage = startBot("arbitrage");
  if (strats.liquidation?.enabled) results.liquidation = startBot("liquidation");
  if (strats.stablecoin?.enabled) results.stablecoin = startBot("stablecoin");
  const started = Object.values(results).filter(Boolean).length;
  addLog("info", "server", `Start-all: ${started} bot(s) launched`);
  res.json({ success: true, results });
});

// POST stop all running bots
app.post("/api/bot/stop-all", (req, res) => {
  stopAllBots();
  res.json({ success: true, message: "All bots stopping" });
});

// POST compile smart contracts
app.post("/api/compile", (req, res) => {
  addLog("info", "compile", "Compiling smart contracts...");

  const proc = spawn("npx", ["hardhat", "compile"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ...loadEnvVars() },
  });

  let output = "";
  proc.stdout.on("data", (d) => {
    output += d.toString();
    addLog("info", "compile", d.toString().trim());
  });
  proc.stderr.on("data", (d) => {
    output += d.toString();
    addLog("warn", "compile", d.toString().trim());
  });
  proc.on("close", (code) => {
    const msg = code === 0 ? "Compilation successful" : `Compilation failed (exit code: ${code})`;
    addLog(code === 0 ? "info" : "error", "compile", msg);
    io.emit("compileResult", { code, output });
  });

  res.json({ success: true, message: "Compilation started. Check logs for progress." });
});

// POST deploy smart contract
app.post("/api/deploy", (req, res) => {
  // Check if credentials are configured
  const envVars = loadEnvVars();
  if (!envVars.PRIVATE_KEY || envVars.PRIVATE_KEY.includes("YOUR_")) {
    addLog("error", "deploy", "Private key not configured. Go to Setup → Save Credentials first.");
    return res.status(400).json({ error: "Private key not configured. Save credentials in Setup first." });
  }

  const network = config.chain || "arbitrumSepolia";
  addLog("info", "deploy", `Deploying contract to ${network}...`);

  const proc = spawn("npx", ["hardhat", "run", "scripts/deploy.js", "--network", network], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ...loadEnvVars() },
  });

  let output = "";
  proc.stdout.on("data", (d) => {
    output += d.toString();
    addLog("info", "deploy", d.toString().trim());
  });
  proc.stderr.on("data", (d) => {
    output += d.toString();
    addLog("warn", "deploy", d.toString().trim());
  });
  proc.on("close", (code) => {
    const addrMatch = output.match(/(?:deployed|Contract).*?(0x[a-fA-F0-9]{40})/i);
    if (addrMatch) {
      const deployChain = config.chain || "arbitrumSepolia";
      if (!config.contractAddresses) config.contractAddresses = {};
      config.contractAddresses[deployChain] = addrMatch[1];
      config.contractAddress = addrMatch[1]; // backward compat
      saveConfig();
      addLog("info", "deploy", `Contract deployed on ${deployChain}: ${addrMatch[1]}`);
    }
    const msg = code === 0 ? "Deployment completed" : `Deployment failed (exit code: ${code})`;
    addLog(code === 0 ? "info" : "error", "deploy", msg);
    io.emit("deployResult", { code, output, contractAddress: addrMatch?.[1], chain: config.chain || "arbitrumSepolia" });
  });

  res.json({ success: true, message: `Deployment to ${network} started. Check logs for progress.` });
});

// GET wallet balances across chains
app.get("/api/balances", async (req, res) => {
  const { ethers } = require("ethers");
  const envVars = loadEnvVars();
  const pk = envVars.PRIVATE_KEY;
  if (!pk || pk.includes("YOUR_")) {
    return res.status(400).json({ error: "Private key not configured" });
  }

  const chainRpcs = {
    arbitrumSepolia: { rpc: "https://sepolia-rollup.arbitrum.io/rpc", symbol: "ETH", name: "Arbitrum Sepolia", decimals: 18 },
    arbitrum: { rpc: envVars.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc", symbol: "ETH", name: "Arbitrum One", decimals: 18 },
    base: { rpc: envVars.BASE_RPC_URL || "https://mainnet.base.org", symbol: "ETH", name: "Base", decimals: 18 },
    baseSepolia: { rpc: "https://sepolia.base.org", symbol: "ETH", name: "Base Sepolia", decimals: 18 },
    polygon: { rpc: envVars.POLYGON_RPC_URL || "https://polygon-rpc.com", symbol: "MATIC", name: "Polygon", decimals: 18 },
    bsc: { rpc: envVars.BSC_RPC_URL || "https://bsc-dataseed1.binance.org", symbol: "BNB", name: "BSC", decimals: 18 },
    avalanche: { rpc: envVars.AVAX_RPC_URL || "https://api.avax.network/ext/bc/C/rpc", symbol: "AVAX", name: "Avalanche", decimals: 18 },
    mantle: { rpc: envVars.MANTLE_RPC_URL || "https://rpc.mantle.xyz", symbol: "MNT", name: "Mantle", decimals: 18 },
    scroll: { rpc: envVars.SCROLL_RPC_URL || "https://rpc.scroll.io", symbol: "ETH", name: "Scroll", decimals: 18 },
  };

  const chains = (req.query.chains || "").split(",").filter(Boolean);
  const wallet = new ethers.Wallet(pk);
  const address = wallet.address;
  const results = [];

  for (const chain of chains) {
    const info = chainRpcs[chain];
    if (!info) continue;
    try {
      const provider = new ethers.JsonRpcProvider(info.rpc);
      const balance = await provider.getBalance(address);
      results.push({
        chain,
        name: info.name,
        symbol: info.symbol,
        balance: ethers.formatEther(balance),
        balanceRaw: balance.toString(),
      });
    } catch (err) {
      results.push({
        chain,
        name: info.name,
        symbol: info.symbol,
        balance: "error",
        error: err.message,
      });
    }
  }

  res.json({ success: true, address, balances: results });
});

// GET AI engine status
app.get("/api/ai/status", (req, res) => {
  // AI runs inside the arbitrage bot process, so we return cached status
  res.json({
    success: true,
    aiStatus: aiStatus,
  });
});

// ============ TRADE HISTORY API ============

// GET trade history with pagination
app.get("/api/trades", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const filter = req.query.filter || "all";
  const strategy = req.query.strategy || "";

  let filtered = tradeHistory;
  if (filter === "success") filtered = filtered.filter(t => t.success);
  else if (filter === "failed") filtered = filtered.filter(t => !t.success);
  else if (filter === "paper") filtered = filtered.filter(t => t.paper);
  if (strategy) filtered = filtered.filter(t => t.strategy === strategy);

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const trades = filtered.slice(start, start + limit);

  res.json({ success: true, trades, total, page, totalPages, limit });
});

// GET computed trade stats
app.get("/api/trades/stats", (req, res) => {
  res.json({ success: true, stats: tradeStats });
});

// POST manually record a trade
app.post("/api/trades/record", (req, res) => {
  const trade = {
    id: Date.now(),
    timestamp: Date.now(),
    ...req.body,
  };
  tradeHistory.unshift(trade);
  if (tradeHistory.length > 10000) tradeHistory = tradeHistory.slice(0, 10000);
  saveTrades();
  recalcStats();
  io.emit("tradeStats", tradeStats);
  io.emit("newTrade", trade);
  res.json({ success: true, trade });
});

// POST generate a test trade
app.post("/api/trades/test", (req, res) => {
  const sampleTrade = {
    id: Date.now(),
    timestamp: Date.now(),
    paper: true,
    test: true,
    strategy: ["dexArbitrage","triangular","liquidation","stablecoin"][Math.floor(Math.random()*4)],
    chain: config.chains?.[0] || "arbitrumSepolia",
    pair: ["WETH/USDC","WETH/USDT","WETH/ARB","USDC/USDT"][Math.floor(Math.random()*4)],
    type: Math.random()>0.5?"SIMPLE":"TRIANGULAR",
    volumeUsd: Math.round(Math.random()*100000),
    buyPrice: 3400+Math.random()*100,
    sellPrice: 3400+Math.random()*100,
    gasCostUsd: Math.random()*2,
    profitUsd: (Math.random()-0.3)*50,
    profitBps: Math.round((Math.random()-0.3)*100),
    success: Math.random()>0.2,
    txHash: "0x"+[...Array(64)].map(()=>Math.floor(Math.random()*16).toString(16)).join(''),
    gasUsed: Math.round(200000+Math.random()*300000),
    blockNumber: Math.round(200000000+Math.random()*1000000),
    aiScore: Math.round(40+Math.random()*60),
  };
  sampleTrade.profitUsd = sampleTrade.success ? Math.abs(sampleTrade.profitUsd) : -Math.abs(sampleTrade.gasCostUsd);
  tradeHistory.unshift(sampleTrade);
  if(tradeHistory.length > 10000) tradeHistory = tradeHistory.slice(0, 10000);
  saveTrades();
  recalcStats();
  io.emit("tradeStats", tradeStats);
  io.emit("newTrade", sampleTrade);
  res.json({ success: true, trade: sampleTrade });
});

// GET health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: stats.startTime ? Math.floor((Date.now() - stats.startTime) / 1000) : 0,
    bots: getBotStatuses(),
    version: "1.0.0",
  });
});

// ============ WEBSOCKET ============

io.on("connection", (socket) => {
  addLog("system", "server", "Client connected via WebSocket");
  socket.emit("botStatus", getBotStatuses());
  socket.emit("stats", stats);
  socket.emit("tradeStats", tradeStats);
  socket.emit("recentLogs", logs.slice(-50));

  socket.on("disconnect", () => {
    addLog("system", "server", "Client disconnected");
  });
});

// Broadcast stats every 5 seconds
setInterval(() => {
  if (stats.startTime) {
    stats.uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  }
  io.emit("stats", stats);
  io.emit("aiStatus", aiStatus);
  io.emit("tradeStats", tradeStats);
}, 5000);

// ============ GRACEFUL SHUTDOWN ============

function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  addLog("info", "server", `Received ${signal}. Stopping all bots...`);
  stopAllBots();
  setTimeout(() => {
    console.log("Server stopped.");
    process.exit(0);
  }, 3000);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ============ START SERVER ============

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  ============================================");
  console.log("   FLASHLOAN-AI | DeFi Arbitrage Command Center");
  console.log(`   Running on http://0.0.0.0:${PORT}`);
  console.log("  ============================================");
  console.log("");
  addLog("system", "server", `Server started on port ${PORT}`);
});
