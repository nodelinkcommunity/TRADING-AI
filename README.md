# FLASHLOAN-AI

He thong tu dong hoa giao dich Flashloan Arbitrage da chain, da DEX voi Web Dashboard.

## Features

- **7 Chien luoc**: DEX Arbitrage, Triangular, Liquidation Sniping, Stablecoin Depeg, New Pool, Oracle Lag, Yield Rebalance
- **Web Dashboard**: Quan ly bots, theo doi logs, cau hinh strategies qua trinh duyet
- **Multi-chain**: Arbitrum, Base, Polygon (mainnet + testnet)
- **Multi-DEX**: Uniswap V3, SushiSwap, Camelot, Aerodrome, QuickSwap
- **Smart Contracts**: FlashloanArbitrage + LiquidationExecutor (Solidity 0.8.20)
- **Real-time**: WebSocket logs, bot status, stats

## Quick Start

```bash
# 1. Clone repo
git clone https://github.com/nodelinkcommunity/TRADING-AI.git
cd TRADING-AI

# 2. Install dependencies
npm install

# 3. Copy and edit .env
cp .env.example .env
# Fill in PRIVATE_KEY and RPC URLs

# 4. Start web dashboard
npm run server

# Open http://localhost:3000 in browser
```

## Architecture

```
flashloan-ai/
├── server/              # Express + Socket.IO web server
│   ├── app.js           # API endpoints, bot management, WebSocket
│   └── public/
│       └── index.html   # Web dashboard (single-page app)
├── contracts/           # Smart contracts (Solidity 0.8.20)
│   ├── FlashloanArbitrage.sol
│   ├── LiquidationExecutor.sol
│   └── interfaces/
├── bot/                 # Bot monitoring & execution
│   ├── index.js         # Entry point (--all, --arb, --liq, --stable)
│   ├── monitor.js       # Arbitrage bot
│   ├── liquidation-bot.js
│   ├── stablecoin-scanner.js
│   └── utils/           # Multicall, gas optimizer, logger
├── config/              # Chain, token, DEX configs
├── scripts/             # Deploy scripts
├── test/                # Hardhat tests (22 passing)
└── docs/                # Strategy documentation
```

## NPM Scripts

| Command | Description |
|---------|-------------|
| `npm run server` | Start web dashboard (port 3000) |
| `npm run bot` | Run arbitrage bot (CLI) |
| `npm run bot:all` | Run all bots (CLI) |
| `npm run compile` | Compile smart contracts |
| `npm test` | Run unit tests |
| `npm run deploy:testnet` | Deploy to Arbitrum Sepolia |

## Web Dashboard

The dashboard at `http://localhost:3000` provides:

- **Setup**: Configure credentials (Private Key, RPC URL)
- **Strategies**: Enable/disable 7 trading strategies
- **Bots**: Start/stop bots with one click
- **Logs**: Real-time log streaming via WebSocket
- **Deploy**: Compile & deploy contracts from browser
- **Stats**: Scans, opportunities, trades, profit tracking

## Deploy to Cloud

### Render (recommended)
1. Push to GitHub
2. Connect repo on [render.com](https://render.com)
3. Set environment variables in Render dashboard
4. Auto-deploys on push

### VPS
```bash
git clone https://github.com/nodelinkcommunity/TRADING-AI.git
cd TRADING-AI
npm install
cp .env.example .env
# Edit .env with your credentials
npm run server
```

## Luu y quan trong

- LUON test tren testnet truoc khi chay mainnet
- KHONG BAO GIO chia se private key
- `autoExecute: false` mac dinh - bot chi MONITOR
- Doc ky docs/STRATEGY.md truoc khi bat dau
