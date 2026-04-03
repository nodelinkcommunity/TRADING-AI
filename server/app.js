/**
 * QIRA Protocol Web Server
 * Express + Socket.IO backend for controlling DeFi arbitrage bots
 * Secured with JWT auth + TOTP (Google Authenticator) + Web3 wallet login
 */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { authenticator } = require("otplib");
const QRCode = require("qrcode");
const { ethers } = require("ethers");
const nodemailer = require("nodemailer");
const { supportsStrategy, getCapabilities, CHAIN_CAPABILITIES } = require("../config/chain-capabilities");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ============ CONFIG ============

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const ENV_PATH = path.join(__dirname, "..", ".env");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const AUTH_PATH = path.join(DATA_DIR, "auth.json");
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(64).toString("hex");
const JWT_EXPIRES = "24h";

// ============ EMAIL SMTP CONFIG ============

// Configure SMTP via .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
let emailTransporter = null;
function getEmailTransporter() {
  if (emailTransporter) return emailTransporter;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  emailTransporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
  });
  return emailTransporter;
}

// In-memory store for email verification codes (userId -> { code, email, expiresAt })
const emailVerCodes = {};

// In-memory store for wallet auth nonces (address -> { nonce, expiresAt })
const authNonces = {};

// ============ BOOTSTRAP PROTECTION ============
// Generate a one-time setup token on first launch when no users exist.
// Operator must pass this token to register — prevents unauthorized bootstrap takeover.
// Token is printed to server console (stdout) only. After first user registers, it's cleared.
let setupToken = null;
const SETUP_TOKEN_PATH = path.join(DATA_DIR, "setup-token");
function generateSetupToken() {
  const auth = loadAuth();
  if (auth.setupComplete || auth.users.length > 0) {
    // Already set up — no token needed
    if (fs.existsSync(SETUP_TOKEN_PATH)) fs.unlinkSync(SETUP_TOKEN_PATH);
    return;
  }
  setupToken = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(SETUP_TOKEN_PATH, setupToken, { mode: 0o600 });
  console.log("\n  ╔══════════════════════════════════════════════════════╗");
  console.log("  ║  SETUP TOKEN (required for first-time registration) ║");
  console.log("  ╠══════════════════════════════════════════════════════╣");
  console.log(`  ║  ${setupToken}  ║`);
  console.log("  ╚══════════════════════════════════════════════════════╝");
  console.log("  Copy this token to the registration page.\n");
}
function validateSetupToken(token) {
  if (!setupToken) {
    // Try reading from file (in case server restarted)
    if (fs.existsSync(SETUP_TOKEN_PATH)) {
      setupToken = fs.readFileSync(SETUP_TOKEN_PATH, "utf8").trim();
    }
  }
  return setupToken && token === setupToken;
}
function clearSetupToken() {
  setupToken = null;
  if (fs.existsSync(SETUP_TOKEN_PATH)) fs.unlinkSync(SETUP_TOKEN_PATH);
}

// ============ AUTH SYSTEM ============

function loadAuth() {
  try {
    if (fs.existsSync(AUTH_PATH)) return JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
  } catch (_) {}
  return { users: [], setupComplete: false };
}

function saveAuth(auth) {
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2));
}

/**
 * JWT auth middleware — protects all sensitive routes
 * During setup, BLOCKS all sensitive operations (only auth routes are public)
 */
function requireAuth(req, res, next) {
  const auth = loadAuth();

  // During initial setup, BLOCK all sensitive operations
  // Only auth routes (status, register, wallet-login) are public and don't use requireAuth
  if (!auth.setupComplete) {
    return res.status(403).json({ error: "System not initialized. Please register first." });
  }

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Authentication required" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ============ AUTH ROUTES (public) ============

// Check if setup is needed
app.use(express.json());

// Static files (must be before auth middleware for login page)
app.use(express.static(path.join(__dirname, "public")));

// GET auth status — is registration complete?
app.get("/api/auth/status", (req, res) => {
  const auth = loadAuth();
  res.json({
    setupComplete: auth.setupComplete,
    hasUsers: auth.users.length > 0,
    totpRequired: auth.users.some(u => u.totpEnabled),
    walletLoginEnabled: auth.users.some(u => u.walletAddress),
  });
});

// GET check if a wallet address is registered
app.get("/api/auth/check-wallet/:address", (req, res) => {
  const auth = loadAuth();
  const address = req.params.address.toLowerCase();
  const user = auth.users.find(u => u.walletAddress?.toLowerCase() === address);
  res.json({
    registered: !!user,
    setupTokenRequired: !auth.setupComplete && auth.users.length === 0,
  });
});

// Legacy /api/auth/register removed — bootstrap registration now uses
// wallet-login with setupToken (same security: nonce + timestamp + signature).
// This ensures ONE auth path for all wallet operations.

// ============ SHARED WALLET CHALLENGE VERIFIER ============
// Used by wallet-login, link-wallet — single code path for nonce+timestamp+signature

/**
 * Verify a wallet signature challenge with server-issued nonce and fresh timestamp.
 * @param {{ address: string, signature: string, message: string }} params
 * @returns {{ success: true, recoveredAddress: string } | { success: false, error: string, status: number }}
 */
function verifyWalletChallenge({ address, signature, message }) {
  if (!address || !signature || !message) {
    return { success: false, error: "Address, signature, and message required", status: 400 };
  }

  // 1. Verify timestamp freshness (5 min window)
  const tsMatch = message.match(/Timestamp:\s*(\d+)/);
  if (!tsMatch) {
    return { success: false, error: "Message must contain a valid timestamp", status: 400 };
  }
  const ts = parseInt(tsMatch[1]);
  if (Math.abs(Date.now() - ts) > 300000) {
    return { success: false, error: "Signature expired. Please sign again.", status: 401 };
  }

  // 2. Recover signer address
  let recoveredAddress;
  try {
    recoveredAddress = ethers.verifyMessage(message, signature);
  } catch (err) {
    return { success: false, error: "Invalid signature", status: 401 };
  }
  if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
    return { success: false, error: "Signature does not match address", status: 401 };
  }

  // 3. Verify server-issued nonce (one-time use)
  const nonceMatch = message.match(/Nonce:\s*([a-f0-9]+)/i);
  if (!nonceMatch) {
    return { success: false, error: "Message must contain server-issued nonce", status: 400 };
  }
  const storedNonce = authNonces[recoveredAddress.toLowerCase()];
  if (!storedNonce || storedNonce.nonce !== nonceMatch[1]) {
    return { success: false, error: "Invalid or expired nonce. Request a new one.", status: 401 };
  }
  if (Date.now() > storedNonce.expiresAt) {
    delete authNonces[recoveredAddress.toLowerCase()];
    return { success: false, error: "Nonce expired. Request a new one.", status: 401 };
  }
  // Consume nonce
  delete authNonces[recoveredAddress.toLowerCase()];

  return { success: true, recoveredAddress };
}

// GET nonce for wallet authentication (server-side challenge)
app.get("/api/auth/nonce/:address", (req, res) => {
  const address = req.params.address.toLowerCase();
  const nonce = crypto.randomBytes(16).toString("hex");
  authNonces[address] = { nonce, expiresAt: Date.now() + 300000 }; // 5 min
  res.json({ success: true, nonce });
});

// POST login with Web3 wallet signature + optional TOTP (2FA)
app.post("/api/auth/wallet-login", (req, res) => {
  const auth = loadAuth();
  const { address, signature, message, totpCode } = req.body;

  // Unified wallet challenge verification (nonce + timestamp + signature)
  const challenge = verifyWalletChallenge({ address, signature, message });
  if (!challenge.success) {
    return res.status(challenge.status).json({ error: challenge.error });
  }

  // Find user by wallet address
  let user = auth.users.find(u => u.walletAddress?.toLowerCase() === address.toLowerCase());

  if (!user) {
    if (auth.setupComplete && auth.users.length > 0) {
      return res.status(403).json({ error: "Wallet not registered" });
    }
    // Bootstrap protection: require setup token for first wallet registration
    if (!validateSetupToken(req.body.setupToken)) {
      return res.status(403).json({ error: "Setup token required for first-time registration. Check server console.", setupTokenRequired: true });
    }
    // First user via wallet — auto-register (setup not yet complete)
    user = {
      id: crypto.randomUUID(),
      totpEnabled: false,
      totpSecret: null,
      walletAddress: address.toLowerCase(),
      createdAt: Date.now(),
    };
    auth.users.push(user);
    auth.setupComplete = true;
    saveAuth(auth);
    clearSetupToken(); // Registration complete — destroy setup token
  }

  // Check TOTP (2FA) if enabled — Layer 2 authentication (before issuing token)
  if (user.totpEnabled) {
    if (!totpCode) {
      return res.status(403).json({ error: "2FA code required", totpRequired: true });
    }
    const totpValid = authenticator.verify({ token: totpCode, secret: user.totpSecret });
    if (!totpValid) {
      return res.status(401).json({ error: "Invalid 2FA code. Try again." });
    }
  }

  const token = jwt.sign({ id: user.id, wallet: user.walletAddress }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ success: true, token, address: user.walletAddress });
});

// GET current user profile info (authenticated)
app.get("/api/auth/me", requireAuth, (req, res) => {
  const auth = loadAuth();
  const user = auth.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    success: true,
    email: user.email || null,
    walletAddress: user.walletAddress || null,
    totpEnabled: !!user.totpEnabled,
    emailVerified: !!user.emailVerified,
    createdAt: user.createdAt,
    hasPassword: !!user.password,
  });
});

// POST setup TOTP (Google Authenticator)
app.post("/api/auth/totp/setup", requireAuth, (req, res) => {
  const auth = loadAuth();
  const user = auth.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(user.email || user.walletAddress || "user", "QIRA Protocol", secret);

  // Generate QR code as data URL
  QRCode.toDataURL(otpauth, (err, qrDataUrl) => {
    if (err) return res.status(500).json({ error: "Failed to generate QR code" });

    // Store secret temporarily (not enabled until verified)
    user._pendingTotpSecret = secret;
    saveAuth(auth);

    res.json({ success: true, qrCode: qrDataUrl, secret, message: "Scan QR code with Google Authenticator, then verify with a code" });
  });
});

// POST verify & enable TOTP
app.post("/api/auth/totp/verify", requireAuth, (req, res) => {
  const auth = loadAuth();
  const user = auth.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const { code } = req.body;
  const secret = user._pendingTotpSecret;
  if (!secret) return res.status(400).json({ error: "No pending TOTP setup. Call /api/auth/totp/setup first." });

  const valid = authenticator.verify({ token: code, secret });
  if (!valid) return res.status(401).json({ error: "Invalid code. Try again." });

  user.totpSecret = secret;
  user.totpEnabled = true;
  delete user._pendingTotpSecret;
  saveAuth(auth);

  res.json({ success: true, message: "TOTP enabled. You will need your authenticator app for future logins." });
});

// POST disable TOTP
app.post("/api/auth/totp/disable", requireAuth, (req, res) => {
  const auth = loadAuth();
  const user = auth.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const { code } = req.body;
  if (user.totpEnabled) {
    const valid = authenticator.verify({ token: code, secret: user.totpSecret });
    if (!valid) return res.status(401).json({ error: "Invalid TOTP code" });
  }

  user.totpEnabled = false;
  user.totpSecret = null;
  saveAuth(auth);

  res.json({ success: true, message: "TOTP disabled" });
});

// POST link Web3 wallet to existing account
app.post("/api/auth/link-wallet", requireAuth, (req, res) => {
  const auth = loadAuth();
  const user = auth.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const { address, signature, message } = req.body;

  // Unified wallet challenge verification
  const challenge = verifyWalletChallenge({ address, signature, message });
  if (!challenge.success) {
    return res.status(challenge.status).json({ error: challenge.error });
  }

  user.walletAddress = address.toLowerCase();
  saveAuth(auth);

  res.json({ success: true, message: "Wallet linked", address: user.walletAddress });
});

// POST change password
// POST send email verification code
app.post("/api/auth/email/send-code", requireAuth, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email address required" });
  }

  // Generate 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  emailVerCodes[req.user.id] = {
    code,
    email: email.toLowerCase().trim(),
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  };

  // Try to send via SMTP
  const transporter = getEmailTransporter();
  if (transporter) {
    try {
      const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER;
      await transporter.sendMail({
        from: `"QIRA Protocol" <${fromAddr}>`,
        to: email,
        subject: "QIRA Protocol — Email Verification Code",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d0b1e;color:#e4e8f1;border-radius:12px">
            <div style="text-align:center;margin-bottom:24px">
              <h2 style="color:#c054f0;margin:0">QIRA Protocol</h2>
              <p style="color:#8b7fad;font-size:13px">Intelligent Flash Engine</p>
            </div>
            <p style="font-size:14px">Your verification code:</p>
            <div style="background:#16122a;border:2px solid #c054f0;border-radius:10px;padding:20px;text-align:center;margin:20px 0">
              <span style="font-size:36px;font-weight:800;letter-spacing:8px;color:#e040fb">${code}</span>
            </div>
            <p style="font-size:12px;color:#8b7fad">This code expires in <b>10 minutes</b>. Do not share it with anyone.</p>
            <hr style="border:none;border-top:1px solid #241b44;margin:20px 0">
            <p style="font-size:11px;color:#5c5080;text-align:center">If you didn't request this code, please ignore this email.</p>
          </div>
        `,
      });
      console.log(`[Auth] Verification code sent to ${email}`);
      return res.json({ success: true, message: "Verification code sent" });
    } catch (err) {
      console.error(`[Auth] Email send error: ${err.message}`);
      return res.status(500).json({ error: "Failed to send email. Check SMTP settings in .env" });
    }
  } else {
    // No SMTP configured — show code in server console for development
    console.log(`\n========================================`);
    console.log(`  EMAIL VERIFICATION CODE for ${email}`);
    console.log(`  Code: ${code}`);
    console.log(`  (Configure SMTP_HOST, SMTP_USER, SMTP_PASS in .env to send real emails)`);
    console.log(`========================================\n`);
    return res.json({ success: true, message: "Verification code sent (check server console — SMTP not configured)" });
  }
});

// POST verify email code & bind to wallet
app.post("/api/auth/email/verify", requireAuth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: "Verification code required" });

  const pending = emailVerCodes[req.user.id];
  if (!pending) return res.status(400).json({ error: "No pending verification. Send a code first." });

  if (Date.now() > pending.expiresAt) {
    delete emailVerCodes[req.user.id];
    return res.status(400).json({ error: "Code expired. Request a new one." });
  }

  if (pending.code !== code.trim()) {
    return res.status(401).json({ error: "Invalid code. Check and try again." });
  }

  // Code is valid — verify & bind email
  const auth = loadAuth();
  const user = auth.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  user.email = pending.email;
  user.emailVerified = true;
  user.emailVerifiedAt = Date.now();
  saveAuth(auth);

  delete emailVerCodes[req.user.id];
  console.log(`[Auth] Email ${pending.email} verified & bound to wallet ${user.walletAddress || "N/A"}`);

  res.json({
    success: true,
    message: "Email verified and bound to wallet",
    email: user.email,
    walletAddress: user.walletAddress || null,
  });
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const auth = loadAuth();
  const user = auth.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const { currentPassword, newPassword } = req.body;
  if (user.password) {
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: "Current password incorrect" });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }

  user.password = await bcrypt.hash(newPassword, 12);
  saveAuth(auth);

  res.json({ success: true, message: "Password changed" });
});

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ============ INTERNAL NOTES ============

const NOTES_PATH = path.join(DATA_DIR, "notes.json");

function loadNotes() {
  try {
    if (fs.existsSync(NOTES_PATH)) return JSON.parse(fs.readFileSync(NOTES_PATH, "utf8"));
  } catch (_) {}
  return { keys: {}, checklist: {}, text: "" };
}

function saveNotes(notes) {
  fs.writeFileSync(NOTES_PATH, JSON.stringify(notes, null, 2));
}

// GET all notes
app.get("/api/notes", requireAuth, (req, res) => {
  const notes = loadNotes();
  // Mask API keys for security (show only last 4 chars)
  const maskedKeys = {};
  for (const [k, v] of Object.entries(notes.keys || {})) {
    maskedKeys[k] = v && v.length > 4 ? "●".repeat(v.length - 4) + v.slice(-4) : v;
  }
  res.json({ success: true, keys: maskedKeys, checklist: notes.checklist, text: notes.text });
});

// POST save API keys
app.post("/api/notes/keys", requireAuth, (req, res) => {
  const notes = loadNotes();
  const newKeys = req.body || {};
  // Only update keys that are provided and not masked
  for (const [k, v] of Object.entries(newKeys)) {
    if (v && !v.startsWith("●")) {
      notes.keys[k] = v;
    }
  }
  saveNotes(notes);
  res.json({ success: true, message: "API keys saved" });
});

// POST save checklist state
app.post("/api/notes/checklist", requireAuth, (req, res) => {
  const notes = loadNotes();
  notes.checklist = req.body.checklist || {};
  saveNotes(notes);
  res.json({ success: true, message: "Checklist saved" });
});

// POST save free-text notes
app.post("/api/notes/text", requireAuth, (req, res) => {
  const notes = loadNotes();
  notes.text = req.body.text || "";
  saveNotes(notes);
  res.json({ success: true, message: "Notes saved" });
});

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
  chain: "arbitrum",
  chains: ["arbitrum"],
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
      enabled: false, // Disabled by default — requires mainnet chain with Aave V3 + deployed LiquidationExecutor
      hfThreshold: 1.1,
      minBonus: 5,
      protocols: ["aave"],
    },
    stablecoin: {
      enabled: false, // Disabled by default — requires mainnet chain with stablecoin registries
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

  // Alerts (legacy)
  alertMode: "console",
  telegramToken: "",
  telegramChatId: "",

  // Phase A: AI Super Bot config
  ai: {
    riskLevel: "balanced",
    autoExecuteThreshold: 90,
    learningEnabled: true,
  },
  plugins: {
    defiLlama: { enabled: true },
    theGraph: { enabled: true, apiKey: "" },
    dune: { enabled: true, apiKey: "" },
    whaleTracker: { enabled: true },
  },
  risk: {
    maxLossPerTrade: 50,
    dailyLossLimit: 500,
    maxExposurePerToken: 0.3,
    maxExposurePerChain: 0.5,
    circuitBreaker: {
      consecutiveFailures: 3,
      hourlyFailures: 5,
      gasSpikeMultiplier: 5,
      cooldownMinutes: 5,
    },
  },
  alerts: {
    telegram: { enabled: false, botToken: "", chatId: "" },
    discord: { enabled: false, webhookUrl: "" },
    quietHours: { enabled: false, start: "23:00", end: "07:00" },
    minPriority: "MEDIUM",
  },
  backtesting: {
    saveOpportunities: true,
    maxStoredOpportunities: 10000,
  },
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
      // Migrate old single liquidationContractAddress to per-chain map
      if (!merged.liquidationContractAddresses) merged.liquidationContractAddresses = {};
      if (merged.liquidationContractAddress && !merged.liquidationContractAddresses[merged.chain]) {
        merged.liquidationContractAddresses[merged.chain] = merged.liquidationContractAddress;
      }
      // Strip testnet chains from saved data (production migration)
      const testnetKeys = ["arbitrumSepolia", "baseSepolia", "goerli", "sepolia"];
      if (merged.chains) {
        merged.chains = merged.chains.filter(c => !testnetKeys.includes(c));
      }
      if (merged.contractAddresses) {
        testnetKeys.forEach(k => delete merged.contractAddresses[k]);
      }
      if (merged.liquidationContractAddresses) {
        testnetKeys.forEach(k => delete merged.liquidationContractAddresses[k]);
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

// Map bot names to strategy names for capability checking
const BOT_STRATEGY_MAP = {
  arbitrage: "arbitrage",
  liquidation: "liquidation",
  stablecoin: "stablecoin",
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

  // Chain capability check — fail-closed
  const currentChain = config.chain || "arbitrum";
  const strategyKey = BOT_STRATEGY_MAP[botName];
  if (strategyKey && !supportsStrategy(currentChain, strategyKey)) {
    addLog("error", botName, `Cannot start ${botName}: chain "${currentChain}" does not support ${strategyKey}. Switch to a supported chain first.`);
    return false;
  }

  // Liquidation-specific: require deployed executor contract in live mode
  if (botName === "liquidation" && !config.paperTrading) {
    const liqAddr = config.liquidationContractAddresses?.[currentChain] || config.liquidationContractAddress || "";
    if (!liqAddr) {
      addLog("error", botName, `Cannot start liquidation in live mode: LiquidationExecutor not deployed on ${currentChain}. Deploy it first or enable paper trading.`);
      return false;
    }
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
        const botChain = config.chain || "arbitrum";
        const addr = config.contractAddresses?.[botChain] || config.contractAddress || "";
        const liqAddr = config.liquidationContractAddresses?.[botChain] || config.liquidationContractAddress || "";
        return {
          ...(addr ? { CONTRACT_ADDRESS: addr } : {}),
          ...(liqAddr ? { FLASHLOAN_CONTRACT_ADDRESS: liqAddr } : {}),
        };
      })()),
      BOT_CHAIN: config.chain || "arbitrum",
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
      chain: config.chains?.[0] || "arbitrum",
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
      chain: config.chain || "arbitrum",
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

  // Parse AI engine ready (v1 or v2)
  if (line.includes("[AI] AI Engine") && line.includes("ready")) {
    aiStatus.isRunning = true;
  }

  // Parse Phase A: Risk blocked
  if (line.startsWith("[RISK] Blocked:")) {
    aiStatus.lastRiskBlock = line.replace("[RISK] ", "");
  }

  // Parse Phase A: Autonomous adjustment
  if (line.startsWith("[AUTO] ")) {
    aiStatus.lastAutoAdjustment = line.replace("[AUTO] ", "");
  }

  // Parse Phase A: Market signals
  if (line.startsWith("[SIGNAL] ")) {
    aiStatus.lastSignal = line.replace("[SIGNAL] ", "");
  }

  // Parse Phase A: AI_STATUS JSON line (periodic full status broadcast)
  if (line.startsWith("AI_STATUS:")) {
    try {
      const statusJson = JSON.parse(line.substring(10));
      Object.assign(aiStatus, statusJson);
    } catch (_) {}
  }
}

// ============ PROTECTED API ROUTES ============

// GET full application state
app.get("/api/state", requireAuth, (req, res) => {
  const envVars = loadEnvVars();
  res.json({
    config: {
      ...config,
      privateKeySet: !!envVars.PRIVATE_KEY && envVars.PRIVATE_KEY.length > 10,
      rpcUrlSet: (() => {
        const rpcMap = { arbitrum: "ARBITRUM_RPC_URL", base: "BASE_RPC_URL", polygon: "POLYGON_RPC_URL", bsc: "BSC_RPC_URL", avalanche: "AVAX_RPC_URL", mantle: "MANTLE_RPC_URL", scroll: "SCROLL_RPC_URL" };
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
app.get("/api/logs", requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const source = req.query.source;
  let filtered = logs;
  if (source) filtered = logs.filter((l) => l.source === source);
  res.json(filtered.slice(-limit));
});

// POST update credentials (stored in .env file)
app.post("/api/credentials", requireAuth, (req, res) => {
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
    const chain = config.chain || "arbitrum";
    const rpcEnvMap = {
      arbitrum: "ARBITRUM_RPC_URL",
      arbitrum: "ARBITRUM_RPC_URL",
      base: "BASE_RPC_URL",
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
app.post("/api/config", requireAuth, (req, res) => {
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
app.post("/api/strategy/:name", requireAuth, (req, res) => {
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
app.post("/api/bot/:name/start", requireAuth, (req, res) => {
  const { name } = req.params;
  const ok = startBot(name);
  res.json({ success: ok, message: ok ? `Bot "${name}" started` : `Failed to start "${name}"` });
});

// POST stop a specific bot
app.post("/api/bot/:name/stop", requireAuth, (req, res) => {
  const { name } = req.params;
  const ok = stopBot(name);
  res.json({ success: ok, message: ok ? `Bot "${name}" stopping` : `Bot "${name}" not running` });
});

// POST start all enabled bots (respects chain capabilities)
app.post("/api/bot/start-all", requireAuth, (req, res) => {
  const results = {};
  const skipped = [];
  const strats = config.strategies;
  const currentChain = config.chain || "arbitrum";

  // Arbitrage bot handles: dexArbitrage, triangular, newPool, oracleLag, yieldRebalance
  const arbStrategies = ["dexArbitrage", "triangular", "newPool", "oracleLag", "yieldRebalance"];
  const anyArbEnabled = arbStrategies.some(s => strats[s]?.enabled);
  if (anyArbEnabled) results.arbitrage = startBot("arbitrage");

  if (strats.liquidation?.enabled) {
    if (supportsStrategy(currentChain, "liquidation")) {
      results.liquidation = startBot("liquidation");
    } else {
      skipped.push(`liquidation (unsupported on ${currentChain})`);
      addLog("warn", "server", `Skipped liquidation: unsupported on ${currentChain}`);
    }
  }
  if (strats.stablecoin?.enabled) {
    if (supportsStrategy(currentChain, "stablecoin")) {
      results.stablecoin = startBot("stablecoin");
    } else {
      skipped.push(`stablecoin (unsupported on ${currentChain})`);
      addLog("warn", "server", `Skipped stablecoin: unsupported on ${currentChain}`);
    }
  }

  const started = Object.values(results).filter(Boolean).length;
  addLog("info", "server", `Start-all: ${started} bot(s) launched${skipped.length ? `, skipped: ${skipped.join(", ")}` : ""}`);
  res.json({ success: true, results, skipped });
});

// GET chain capabilities (public — needed before login for UI)
app.get("/api/chain-capabilities", (req, res) => {
  res.json({ success: true, capabilities: CHAIN_CAPABILITIES });
});

// GET capabilities for current chain
app.get("/api/chain-capabilities/:chain", (req, res) => {
  const caps = getCapabilities(req.params.chain);
  res.json({ success: true, chain: req.params.chain, ...caps });
});

// POST stop all running bots
app.post("/api/bot/stop-all", requireAuth, (req, res) => {
  stopAllBots();
  res.json({ success: true, message: "All bots stopping" });
});

// POST compile smart contracts
app.post("/api/compile", requireAuth, (req, res) => {
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
app.post("/api/deploy", requireAuth, (req, res) => {
  // Check if credentials are configured
  const envVars = loadEnvVars();
  if (!envVars.PRIVATE_KEY || envVars.PRIVATE_KEY.includes("YOUR_")) {
    addLog("error", "deploy", "Private key not configured. Go to Setup → Save Credentials first.");
    return res.status(400).json({ error: "Private key not configured. Save credentials in Setup first." });
  }

  const network = config.chain || "arbitrum";
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
    const deployChain = config.chain || "arbitrum";

    // Parse main arbitrage contract address (e.g. "Contract: 0x..." or "deployed...0x...")
    const addrMatch = output.match(/^Contract:\s*(0x[a-fA-F0-9]{40})/m)
      || output.match(/(?:deployed|Contract).*?(0x[a-fA-F0-9]{40})/i);
    if (addrMatch) {
      if (!config.contractAddresses) config.contractAddresses = {};
      config.contractAddresses[deployChain] = addrMatch[1];
      config.contractAddress = addrMatch[1]; // backward compat
      addLog("info", "deploy", `Arbitrage contract deployed on ${deployChain}: ${addrMatch[1]}`);
    }

    // Parse LiquidationExecutor address (e.g. "LiquidationExecutor deployed: 0x..." or "LiquidationExecutor: 0x...")
    const liqMatch = output.match(/LiquidationExecutor[:\s]+(0x[a-fA-F0-9]{40})/i);
    if (liqMatch) {
      if (!config.liquidationContractAddresses) config.liquidationContractAddresses = {};
      config.liquidationContractAddresses[deployChain] = liqMatch[1];
      config.liquidationContractAddress = liqMatch[1]; // backward compat
      addLog("info", "deploy", `LiquidationExecutor deployed on ${deployChain}: ${liqMatch[1]}`);
    }

    if (addrMatch || liqMatch) saveConfig();

    const msg = code === 0 ? "Deployment completed" : `Deployment failed (exit code: ${code})`;
    addLog(code === 0 ? "info" : "error", "deploy", msg);
    io.emit("deployResult", {
      code, output,
      contractAddress: addrMatch?.[1],
      liquidationContractAddress: liqMatch?.[1],
      chain: deployChain,
    });
  });

  res.json({ success: true, message: `Deployment to ${network} started. Check logs for progress.` });
});

// GET wallet balances across chains
app.get("/api/balances", requireAuth, async (req, res) => {
  const { ethers } = require("ethers");
  const envVars = loadEnvVars();
  const pk = envVars.PRIVATE_KEY;
  if (!pk || pk.includes("YOUR_")) {
    return res.status(400).json({ error: "Private key not configured" });
  }

  const chainRpcs = {
    arbitrum: { rpc: envVars.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc", symbol: "ETH", name: "Arbitrum One", decimals: 18 },
    base: { rpc: envVars.BASE_RPC_URL || "https://mainnet.base.org", symbol: "ETH", name: "Base", decimals: 18 },
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
app.get("/api/ai/status", requireAuth, (req, res) => {
  // AI runs inside the arbitrage bot process, so we return cached status
  res.json({
    success: true,
    aiStatus: aiStatus,
  });
});

// ============ TRADE HISTORY API ============

// GET trade history with pagination
app.get("/api/trades", requireAuth, (req, res) => {
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
app.get("/api/trades/stats", requireAuth, (req, res) => {
  res.json({ success: true, stats: tradeStats });
});

// POST manually record a trade
app.post("/api/trades/record", requireAuth, (req, res) => {
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
app.post("/api/trades/test", requireAuth, (req, res) => {
  const sampleTrade = {
    id: Date.now(),
    timestamp: Date.now(),
    paper: true,
    test: true,
    strategy: ["dexArbitrage","triangular","liquidation","stablecoin"][Math.floor(Math.random()*4)],
    chain: config.chains?.[0] || "arbitrum",
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

// ============ PHASE A: AI SUPER BOT API ============

// GET full market state from all data plugins
app.get("/api/market-state", requireAuth, (req, res) => {
  try {
    // Market state is broadcast from bot process via aiStatus
    const marketState = aiStatus?.marketState || null;
    const signals = aiStatus?.marketSignals || [];
    const sentiment = aiStatus?.marketSentiment || 0;
    res.json({ success: true, marketState, signals, sentiment });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// GET risk engine status
app.get("/api/risk-status", requireAuth, (req, res) => {
  try {
    const riskStatus = aiStatus?.riskStatus || {};
    res.json({ success: true, riskStatus });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// GET pending AI advisories
app.get("/api/advisories", requireAuth, (req, res) => {
  try {
    const advisoriesPath = path.join(DATA_DIR, "advisories.json");
    let advisories = [];
    if (fs.existsSync(advisoriesPath)) {
      advisories = JSON.parse(fs.readFileSync(advisoriesPath, "utf8"));
    }
    const pending = advisories.filter(a => a.status === "pending");
    res.json({ success: true, advisories, pending });
  } catch (error) {
    res.json({ success: false, error: error.message, advisories: [], pending: [] });
  }
});

// POST approve advisory
app.post("/api/advisories/:id/approve", requireAuth, (req, res) => {
  try {
    const advisoriesPath = path.join(DATA_DIR, "advisories.json");
    let advisories = [];
    if (fs.existsSync(advisoriesPath)) {
      advisories = JSON.parse(fs.readFileSync(advisoriesPath, "utf8"));
    }
    const advisory = advisories.find(a => a.id === req.params.id);
    if (advisory) {
      advisory.status = "approved";
      advisory.respondedAt = Date.now();
      fs.writeFileSync(advisoriesPath, JSON.stringify(advisories, null, 2));
      addLog("info", "ai", `Advisory approved: ${advisory.title}`);
      res.json({ success: true, advisory });
    } else {
      res.json({ success: false, error: "Advisory not found" });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST reject advisory
app.post("/api/advisories/:id/reject", requireAuth, (req, res) => {
  try {
    const advisoriesPath = path.join(DATA_DIR, "advisories.json");
    let advisories = [];
    if (fs.existsSync(advisoriesPath)) {
      advisories = JSON.parse(fs.readFileSync(advisoriesPath, "utf8"));
    }
    const advisory = advisories.find(a => a.id === req.params.id);
    if (advisory) {
      advisory.status = "rejected";
      advisory.respondedAt = Date.now();
      fs.writeFileSync(advisoriesPath, JSON.stringify(advisories, null, 2));
      addLog("info", "ai", `Advisory rejected: ${advisory.title}`);
      res.json({ success: true, advisory });
    } else {
      res.json({ success: false, error: "Advisory not found" });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// GET audit trail
app.get("/api/audit-trail", requireAuth, (req, res) => {
  try {
    const auditPath = path.join(DATA_DIR, "audit-trail.json");
    let records = [];
    if (fs.existsSync(auditPath)) {
      records = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    }
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const type = req.query.type || null;
    let filtered = records;
    if (type) filtered = filtered.filter(r => r.type === type);
    res.json({ success: true, records: filtered.slice(-limit), total: filtered.length });
  } catch (error) {
    res.json({ success: false, error: error.message, records: [] });
  }
});

// GET data plugin health status
app.get("/api/plugins/status", requireAuth, (req, res) => {
  try {
    const pluginHealth = aiStatus?.pluginHealth || {};
    res.json({ success: true, plugins: pluginHealth });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// GET backtest results list
app.get("/api/backtests", requireAuth, (req, res) => {
  try {
    const resultsDir = path.join(DATA_DIR, "backtest-results");
    let results = [];
    if (fs.existsSync(resultsDir)) {
      results = fs.readdirSync(resultsDir)
        .filter(f => f.endsWith(".json"))
        .sort()
        .slice(-20)
        .map(f => {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(resultsDir, f), "utf8"));
            return { file: f, id: data.id, params: data.params, metrics: data.metrics, timestamp: data.timestamp };
          } catch { return null; }
        })
        .filter(Boolean);
    }
    res.json({ success: true, results });
  } catch (error) {
    res.json({ success: false, error: error.message, results: [] });
  }
});

// GET specific backtest result
app.get("/api/backtests/:id", requireAuth, (req, res) => {
  try {
    const resultsDir = path.join(DATA_DIR, "backtest-results");
    const files = fs.existsSync(resultsDir) ? fs.readdirSync(resultsDir) : [];
    const file = files.find(f => f.includes(req.params.id));
    if (file) {
      const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf8"));
      res.json({ success: true, result: data });
    } else {
      res.json({ success: false, error: "Backtest not found" });
    }
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST run replay backtest
app.post("/api/backtests/replay", requireAuth, (req, res) => {
  try {
    const ReplayEngine = require("../bot/backtesting/replay-engine");
    const replay = new ReplayEngine();
    replay.replay(req.body).then(result => {
      addLog("info", "backtest", `Replay complete: ${result.wouldExecute || 0} trades simulated`);
      res.json({ success: true, result });
    }).catch(err => {
      res.json({ success: false, error: err.message });
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST run historical backtest
app.post("/api/backtests/historical", requireAuth, (req, res) => {
  try {
    const HistoricalBacktester = require("../bot/backtesting/historical-backtester");
    const bt = new HistoricalBacktester();
    bt.run(req.body).then(result => {
      addLog("info", "backtest", `Historical backtest complete: ${result.trades?.length || 0} trades`);
      res.json({ success: true, result });
    }).catch(err => {
      res.json({ success: false, error: err.message });
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// GET A/B test status
app.get("/api/ab-test/status", requireAuth, (req, res) => {
  try {
    const abTestPath = path.join(DATA_DIR, "ab-test.json");
    let abTest = null;
    if (fs.existsSync(abTestPath)) {
      abTest = JSON.parse(fs.readFileSync(abTestPath, "utf8"));
    }
    res.json({ success: true, abTest });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST start A/B test
// Note: A/B test runs in a SEPARATE offline harness — it does NOT affect the live bot.
// It replays historical opportunities with two parameter sets to compare theoretical performance.
app.post("/api/ab-test/start", requireAuth, (req, res) => {
  try {
    const ABTester = require("../bot/backtesting/ab-tester");
    const tester = new ABTester();
    const result = tester.start(req.body);
    addLog("info", "ab-test", `A/B test started (offline simulation): ${req.body.nameA || "A"} vs ${req.body.nameB || "B"}`);
    res.json({ success: true, result, note: "A/B test started in offline simulation harness. This does NOT affect the live bot. Results saved to ab-test.json." });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST configure alerts
app.post("/api/alerts/config", requireAuth, (req, res) => {
  try {
    const alertConfig = req.body;
    // Save alert config to main config
    config.alerts = alertConfig;
    saveConfig();
    addLog("info", "alerts", "Alert configuration updated");
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST send test alert
app.post("/api/alerts/test", requireAuth, async (req, res) => {
  try {
    const AlertDispatcher = require("../bot/alerts/alert-dispatcher");
    const dispatcher = new AlertDispatcher();
    await dispatcher.initialize(config);
    await dispatcher.sendTestAlert();
    addLog("info", "alerts", "Test alert sent");
    res.json({ success: true, message: "Test alert sent to configured channels" });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// GET alert history
app.get("/api/alerts/history", requireAuth, (req, res) => {
  try {
    res.json({ success: true, alerts: aiStatus?.alertStatus?.recentAlerts || [] });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST set risk level
app.post("/api/risk/level", requireAuth, (req, res) => {
  try {
    const { level } = req.body;
    if (!["conservative", "balanced", "aggressive"].includes(level)) {
      return res.json({ success: false, error: "Invalid risk level" });
    }
    config.ai = config.ai || {};
    config.ai.riskLevel = level;
    saveConfig();
    io.emit("configUpdate", { key: "ai.riskLevel", value: level });
    addLog("info", "risk", `Risk level changed to: ${level}`);
    res.json({ success: true, level });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// POST reset circuit breaker
app.post("/api/risk/reset-circuit-breaker", requireAuth, (req, res) => {
  try {
    addLog("info", "risk", "Circuit breaker manually reset");
    io.emit("riskCommand", { action: "resetCircuitBreaker" });
    // Write reset signal file for running bot to detect
    fs.writeFileSync(path.join(DATA_DIR, "circuit-breaker-reset.signal"), Date.now().toString());
    res.json({ success: true, message: "Circuit breaker reset" });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// GET autonomous manager status
app.get("/api/autonomous/status", requireAuth, (req, res) => {
  try {
    res.json({ success: true, status: aiStatus?.autonomousStatus || {} });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
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
  // Authenticate socket connection
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
    } catch (err) {
      // Token invalid — socket.user remains undefined
    }
  }

  // Reject unauthenticated connections when setup is complete
  const auth = loadAuth();
  if (!socket.user && auth.setupComplete) {
    socket.disconnect(true);
    return;
  }

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
  // Only emit to authenticated sockets
  io.sockets.sockets.forEach((socket) => {
    if (!socket.user) return;
    socket.emit("stats", stats);
    socket.emit("aiStatus", aiStatus);
    socket.emit("tradeStats", tradeStats);

    // Phase A: broadcast market signals and risk status
    if (aiStatus?.marketSignals) {
      socket.emit("marketSignals", aiStatus.marketSignals);
    }
    if (aiStatus?.riskStatus) {
      socket.emit("riskStatus", aiStatus.riskStatus);
    }
    if (aiStatus?.pendingAdvisories) {
      socket.emit("advisories", aiStatus.pendingAdvisories);
    }
  });
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
  console.log("   QIRA Protocol | DeFi Arbitrage Command Center");
  console.log(`   Running on http://0.0.0.0:${PORT}`);
  console.log("  ============================================");
  console.log("");
  generateSetupToken(); // Print setup token if system has no users yet
  addLog("system", "server", `Server started on port ${PORT}`);
});
