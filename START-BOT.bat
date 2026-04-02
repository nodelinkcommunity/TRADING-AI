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

:: Open browser after 2 seconds
start "" "http://localhost:3000"

echo Server starting on http://localhost:3000
echo Dashboard will open in your browser automatically
echo.
echo To stop: close this window or press Ctrl+C
echo ============================================
echo.

:: Start server
node server/app.js
pause
