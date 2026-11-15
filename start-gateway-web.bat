@echo off
title Engine 4: API Gateway & Dashboard Web
color 0A
cls
echo ======================================================================
echo           ENGINE 4: API GATEWAY & DASHBOARD (Port 4000 & 5173)
echo ======================================================================
echo.
cd /d "%~dp0"
echo Starting Gateway and Web Dashboard...
echo Web UI:  http://localhost:5173
echo Gateway: http://localhost:4000
echo.
start "" /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5173"
npx concurrently -k -n "GW,WEB" -c "green,cyan" "npm run dev -w @dark-storage/gateway" "npm run dev -w @dark-storage/web"
pause
