@echo off
chcp 65001 >nul
title 🛑 停止 Cobin 背景通話服務
echo ================================================================
echo          🛑 正在停止 Cobin 通話背景服務...
echo ================================================================
echo.

taskkill /F /IM cloudflared.exe 2>NUL
echo [1/3] 已停止 Cloudflare 通道

taskkill /F /FI "WINDOWTITLE eq Cobin_Workerman*" 2>NUL
echo [2/3] 已停止 WebSocket 信令伺服器

echo.
echo ✅ Cobin 所有通話服務已停止！
pause
