#!/bin/bash
# ============================================
#  FLASHLOAN-AI — Double-click to Stop
# ============================================

cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

echo "Stopping FLASHLOAN-AI..."
npx pm2 stop flashloan-server 2>/dev/null
npx pm2 delete flashloan-server 2>/dev/null
echo ""
echo "✅ Bot stopped."
echo "Press any key to close..."
read -n 1
