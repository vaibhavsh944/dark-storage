@echo off
title Engine 3: Inventory Ledger & Transactions
color 09
cls
echo ======================================================================
echo           ENGINE 3: INVENTORY LEDGER & TRANSACTIONS (Port 4003)
echo ======================================================================
echo.
cd /d "%~dp0"
echo Starting Engine 3 alone...
echo URL: http://localhost:4003/api/inventory/summary
echo.
npm run dev -w @dark-storage/engine3-inventory
pause
