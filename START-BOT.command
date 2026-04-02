#!/bin/bash
# ============================================
#  FLASHLOAN-AI — Double-click to Start
#  Auto-restart with PM2 + open Dashboard
# ============================================

cd "$(dirname "$0")"

echo "============================================"
echo "  FLASHLOAN-AI Starting..."
echo "============================================"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    if [ -f "/usr/local/bin/node" ]; then
        export PATH="/usr/local/bin:$PATH"
    elif [ -f "/opt/homebrew/bin/node" ]; then
        export PATH="/opt/homebrew/bin:$PATH"
    else
        echo "❌ Node.js not found! Please install from https://nodejs.org"
        echo "Press any key to exit..."
        read -n 1
        exit 1
    fi
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies (first time only)..."
    npm install
    echo ""
fi

# Create logs directory
mkdir -p logs

# Check if already running via PM2
if npx pm2 describe flashloan-server > /dev/null 2>&1; then
    echo "⚡ Bot is already running! Restarting..."
    npx pm2 restart flashloan-server
else
    echo "🚀 Starting with PM2 (auto-restart enabled)..."
    npx pm2 start ecosystem.config.js
fi

echo ""
echo "============================================"
echo "  ✅ FLASHLOAN-AI is running!"
echo "============================================"
echo ""
echo "  Dashboard:  http://localhost:3000"
echo "  Status:     npm run pm2:status"
echo "  Logs:       npm run pm2:logs"
echo "  Stop:       npm run pm2:stop"
echo "  Restart:    npm run pm2:restart"
echo ""
echo "  Bot auto-restarts on crash."
echo "  Close this window — bot keeps running!"
echo "============================================"
echo ""

# Open browser
(sleep 2 && open "http://localhost:3000") &

# Show live logs (optional — user can close window)
npx pm2 logs flashloan-server --lines 50
