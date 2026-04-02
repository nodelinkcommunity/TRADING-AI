#!/bin/bash
# ============================================
#  FLASHLOAN-AI — Double-click to Start
#  Tự động khởi động server + mở Dashboard
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

# Open browser after 2 seconds
(sleep 2 && open "http://localhost:3000") &

echo "🚀 Server starting on http://localhost:3000"
echo "📊 Dashboard will open in your browser automatically"
echo ""
echo "To stop: close this window or press Ctrl+C"
echo "============================================"
echo ""

# Start server
node server/app.js
