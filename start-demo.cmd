@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 LTS from https://nodejs.org/en/download
  echo Then reopen this file.
  pause
  exit /b 1
)
node scripts/start-local-demo.mjs
if errorlevel 1 pause
