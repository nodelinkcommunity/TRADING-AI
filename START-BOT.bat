@echo off
title FLASHLOAN-AI Bot
echo ============================================
echo   FLASHLOAN-AI Starting...
echo ============================================
echo.

cd /d "%~dp0"

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Node.js not found! Please install from https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies (first time only)...
    npm install
    echo.
)

:: Create logs directory
if not exist "logs" mkdir logs

:: Open browser
start "" "http://localhost:3000"

:: Start with PM2 (auto-restart)
echo Starting with PM2 (auto-restart enabled)...
npx pm2 start ecosystem.config.js
echo.
echo ============================================
echo   FLASHLOAN-AI is running!
echo ============================================
echo.
echo   Dashboard:  http://localhost:3000
echo   Status:     npm run pm2:status
echo   Logs:       npm run pm2:logs
echo   Stop:       npm run pm2:stop
echo.
echo   Bot auto-restarts on crash.
echo   Close this window - bot keeps running!
echo ============================================
echo.

:: Show live logs
npx pm2 logs flashloan-server --lines 50
pause
