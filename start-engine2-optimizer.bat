@echo off
title Engine 2: Optimizer & Spatial Router
color 0E
cls
echo ======================================================================
echo           ENGINE 2: OPTIMIZER & SPATIAL ROUTER (Port 4002)
echo ======================================================================
echo.
cd /d "%~dp0"
echo Starting Engine 2 alone...
echo URL: http://localhost:4002/api/health
echo.
npm run dev -w @dark-storage/engine2-optimizer
pause
