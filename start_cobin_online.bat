@echo off
chcp 65001 >nul
title Cobin 通話 - 一鍵啟動公網通道
echo ===================================================
echo     🌐 Cobin Voice & Video 即時通話系統
echo ===================================================
echo.
echo [1/3] 啟動 WebSocket 信令伺服器 (Workerman)...
start "Cobin WebSocket Server" /min "C:\xampp\php\php.exe" "C:\xampp\htdocs\cobin\cobin\server.php"

echo [2/3] 檢查並啟動 Apache 網頁伺服器...
tasklist /FI "IMAGENAME eq httpd.exe" 2>NUL | find /I /N "httpd.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo   -> Apache 已經在運行中
) else (
    start "Cobin Apache" /min "C:\xampp\apache\bin\httpd.exe"
    echo   -> Apache 已啟動
)

echo.
echo [3/3] 正在建立 Cloudflare 免費 HTTPS 公網通道...
echo.
echo ===================================================
echo   請複製下方出現的 https://xxxx.trycloudflare.com 網址
echo   發給手機或遠端朋友即可直接通話！
echo ===================================================
echo.
"C:\xampp\htdocs\cobin\cobin\cloudflared.exe" tunnel --url http://127.0.0.1:80
pause
