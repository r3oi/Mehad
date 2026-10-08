@echo off
title GradDocs
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed on this computer.
  echo Download the "LTS" version from https://nodejs.org , install it, then double-click this file again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)
node serve.mjs 5173 --open
pause
