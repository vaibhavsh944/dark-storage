@echo off
title Engine 1: Scheduler & Resource Coordination
color 0D
cls
echo ======================================================================
echo           ENGINE 1: SCHEDULER & RESOURCE COORDINATION (Port 4001)
echo ======================================================================
echo.
cd /d "%~dp0"
echo Starting Engine 1 alone...
echo URL: http://localhost:4001/api/tasks
echo.
npm run dev -w @dark-storage/engine1-scheduler
pause
