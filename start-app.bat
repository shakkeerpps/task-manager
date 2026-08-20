@echo off
title Project Timeline Hub
cd /d "%~dp0"

:: Start the Next.js server in the background
start /min npm start

:: Wait for 3 seconds for server to start
timeout /t 3 /nobreak >nul

:: Launch Chrome in standalone App Window Mode
start chrome.exe --app=http://localhost:3000

exit