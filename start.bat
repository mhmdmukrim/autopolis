@echo off
setlocal
cd /d "%~dp0"
title AUTOPOLIS - AI Cyber City

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [X] Node.js is not installed.
  echo       Install it from https://nodejs.org then run this file again.
  echo.
  pause
  exit /b 1
)

echo   Starting the AUTOPOLIS companion service...
start "AUTOPOLIS SERVICE" /min node "%~dp0server.js"

rem wait for the port to answer
ping -n 4 127.0.0.1 >nul

start "" "http://127.0.0.1:8787/"

echo.
echo   AUTOPOLIS is running.
echo     City   : http://127.0.0.1:8787/
echo     Logs   : %~dp0data\logs\
echo     Config : %~dp0data\config.json
echo.
echo   Leave the minimized "AUTOPOLIS SERVICE" window open.
echo   Closing it stops disk logging, Gmail/Drive and CCTV access.
echo.
timeout /t 6 >nul
