@echo off
chcp 65001 >nul
title AI Girl Lottery Local Launcher
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [Error] Node.js not found. Please install Node.js LTS or use chrome-bridge extension.
  pause
  exit /b 1
)
echo Starting AI Girl Lottery local server on http://127.0.0.1:8788 ...
start "" cmd /c "timeout /t 1 /nobreak >nul && start http://127.0.0.1:8788"
node "%~dp0local-server.mjs"
pause
