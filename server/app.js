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

// Default configuration
const DEFAULT_CONFIG = {
  // Credential status (actual keys stored in .env only)
  privateKeySet: false,
  rpcUrlSet: false,

  // Network
  chain: "arbitrumSepolia",
  contractAddress: "",

  // Trading parameters
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
let stats = {
  startTime: null,
  scansCompleted: 0,
  opportunitiesFound: 0,
  tradesExecuted: 0,
  totalProfitUsd: 0,
  gasSpent: 0,
  uptime: 0,
};

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
    cfg.rpcUrlSet = /ARBITRUM_RPC_URL=https?:\/\/.+/.test(env);
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
      ...(config.contractAddress ? { CONTRACT_ADDRESS: config.contractAddress } : {}),
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
  if (lower.includes("scan")) stats.scansCompleted++;
  if (lower.includes("opportunit") || lower.includes("found")) stats.opportunitiesFound++;
  if (lower.includes("success") || lower.includes("executed") || lower.includes("trade")) stats.tradesExecuted++;
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
      rpcUrlSet: !!envVars.ARBITRUM_RPC_URL && envVars.ARBITRUM_RPC_URL.startsWith("http"),
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
    updateEnvVar("ARBITRUM_RPC_URL", rpcUrl);
    addLog("info", "server", "RPC URL updated");
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
      config.contractAddress = addrMatch[1];
      saveConfig();
      addLog("info", "deploy", `Contract deployed at: ${addrMatch[1]}`);
    }
    const msg = code === 0 ? "Deployment completed" : `Deployment failed (exit code: ${code})`;
    addLog(code === 0 ? "info" : "error", "deploy", msg);
    io.emit("deployResult", { code, output, contractAddress: addrMatch?.[1] });
  });

  res.json({ success: true, message: `Deployment to ${network} started. Check logs for progress.` });
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
