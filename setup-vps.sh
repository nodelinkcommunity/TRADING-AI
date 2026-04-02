#!/bin/bash
# ============================================================
#  FLASHLOAN-AI - VPS Setup Script
#  Chay 1 lenh duy nhat de cai dat toan bo he thong
#
#  Cach dung:
#    chmod +x setup-vps.sh && ./setup-vps.sh
#
#  Ho tro: Ubuntu 20.04/22.04, Debian 11/12
# ============================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "============================================"
echo "   FLASHLOAN-AI - VPS Auto Setup"
echo "============================================"
echo -e "${NC}"

# ---- Check root ----
if [ "$EUID" -ne 0 ]; then
  echo -e "${YELLOW}[!] Dang chay khong phai root. Mot so buoc co the can sudo.${NC}"
fi

# ---- System update ----
echo -e "${GREEN}[1/7] Cap nhat he thong...${NC}"
sudo apt-get update -y && sudo apt-get upgrade -y

# ---- Install Node.js 20 LTS ----
echo -e "${GREEN}[2/7] Cai dat Node.js 20 LTS...${NC}"
if command -v node &> /dev/null; then
  NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
  if [ "$NODE_VER" -ge 18 ]; then
    echo -e "${YELLOW}  Node.js $(node -v) da co san, bo qua.${NC}"
  else
    echo -e "${YELLOW}  Node.js cu ($NODE_VER), dang nang cap...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
else
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "  Node: $(node -v) | npm: $(npm -v)"

# ---- Install build tools ----
echo -e "${GREEN}[3/7] Cai dat build tools...${NC}"
sudo apt-get install -y git build-essential

# ---- Install PM2 ----
echo -e "${GREEN}[4/7] Cai dat PM2 (process manager)...${NC}"
if command -v pm2 &> /dev/null; then
  echo -e "${YELLOW}  PM2 da co san.${NC}"
else
  sudo npm install -g pm2
fi

# ---- Setup project ----
echo -e "${GREEN}[5/7] Cai dat project...${NC}"

PROJECT_DIR="$HOME/flashloan-ai"

if [ -d "$PROJECT_DIR" ]; then
  echo -e "${YELLOW}  Thu muc $PROJECT_DIR da ton tai.${NC}"
  echo -e "${YELLOW}  Dang cap nhat dependencies...${NC}"
  cd "$PROJECT_DIR"
  npm install
else
  echo -e "${YELLOW}  Copy files vao $PROJECT_DIR...${NC}"

  # Neu chay tu trong thu muc project
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  if [ "$SCRIPT_DIR" != "$PROJECT_DIR" ]; then
    cp -r "$SCRIPT_DIR" "$PROJECT_DIR"
  fi

  cd "$PROJECT_DIR"
  npm install
fi

# ---- Create .env if not exists ----
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo -e "${GREEN}[5b] Tao file .env mau...${NC}"
  cat > "$PROJECT_DIR/.env" << 'ENVEOF'
# FLASHLOAN-AI Configuration
# Dien thong tin qua web interface tai http://YOUR_VPS_IP:3000

PRIVATE_KEY=
ARBITRUM_RPC_URL=
BASE_RPC_URL=
POLYGON_RPC_URL=
ARBISCAN_API_KEY=
BASESCAN_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
ENVEOF
fi

# ---- Create data directory ----
mkdir -p "$PROJECT_DIR/server/data"

# ---- Setup firewall ----
echo -e "${GREEN}[6/7] Cau hinh firewall...${NC}"
if command -v ufw &> /dev/null; then
  sudo ufw allow 22/tcp    # SSH
  sudo ufw allow 3000/tcp  # Bot web interface
  sudo ufw --force enable
  echo -e "${GREEN}  Firewall: Port 22 (SSH) va 3000 (Web) da mo.${NC}"
else
  echo -e "${YELLOW}  UFW khong co, bo qua firewall setup.${NC}"
fi

# ---- Start with PM2 ----
echo -e "${GREEN}[7/7] Khoi dong server voi PM2...${NC}"
cd "$PROJECT_DIR"

# Stop existing instance if any
pm2 delete flashloan-ai 2>/dev/null || true

# Start server
pm2 start server/app.js --name flashloan-ai \
  --max-memory-restart 512M \
  --time \
  --log-date-format "YYYY-MM-DD HH:mm:ss"

# Auto-start on reboot
pm2 save
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

# ---- Get IP ----
VPS_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s icanhazip.com 2>/dev/null || echo "YOUR_VPS_IP")

# ---- Done ----
echo ""
echo -e "${CYAN}============================================${NC}"
echo -e "${GREEN}  SETUP HOAN TAT!${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""
echo -e "  ${GREEN}Web Interface:${NC}  http://${VPS_IP}:3000"
echo ""
echo -e "  ${YELLOW}Buoc tiep theo:${NC}"
echo -e "  1. Mo trinh duyet, truy cap link tren"
echo -e "  2. Dien Private Key va RPC URL"
echo -e "  3. Chon strategies va bat dau scan"
echo ""
echo -e "  ${CYAN}Quan ly PM2:${NC}"
echo -e "  pm2 status          - Xem trang thai"
echo -e "  pm2 logs flashloan-ai - Xem logs"
echo -e "  pm2 restart flashloan-ai - Khoi dong lai"
echo -e "  pm2 stop flashloan-ai   - Dung"
echo ""
echo -e "${CYAN}============================================${NC}"
