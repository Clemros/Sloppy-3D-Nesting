@echo off
rem Starts the 3D Nesting web app and opens it in the default browser (Windows).
rem Double-click this file or run "start.bat" in cmd / PowerShell.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 20 or newer from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Starting development server (close this window or press Ctrl+C to stop)
call npx vite --open
pause
