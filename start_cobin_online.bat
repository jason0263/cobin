@echo off
chcp 65001 >nul
title 🌐 Cobin Voice & Video - 伺服器啟動器
cls
echo ================================================================
echo          🚀 歡迎使用 Cobin Voice & Video 即時通話系統
echo ================================================================
echo.
echo  正在啟動本機伺服器與公網通道 (即使關閉 IDE 也能正常通話)...
echo.

:: 1. 啟動 PHP Workerman WebSocket 信令伺服器 (背景運行)
echo [1/3] 正在啟動 WebSocket 信令伺服器...
start "Cobin_Workerman" /min "C:\xampp\php\php.exe" "C:\xampp\htdocs\cobin\cobin\server.php"

:: 2. 檢查並啟動 Apache HTTPD
echo [2/3] 正在檢查 Apache 網頁伺服器...
tasklist /FI "IMAGENAME eq httpd.exe" 2>NUL | find /I /N "httpd.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo       -> Apache 已在背景運行中
) else (
    start "Cobin_Apache" /min "C:\xampp\apache\bin\httpd.exe"
    echo       -> Apache 網頁伺服器已啟動
)

echo.
echo [3/3] 正在連接 Cloudflare 全球免費 HTTPS 通道...
echo ================================================================
echo  請稍候 3 秒，下方出現「https://xxxx.trycloudflare.com」後：
echo  1. 複製該連結並加上 /cobin/cobin/index.html 發給朋友或用手機開啟
echo  2. 本視窗請保持開啟 (最小化即可)，關閉本視窗即停止通話服務
echo ================================================================
echo.

cd /d "C:\xampp\htdocs\cobin\cobin"
"C:\xampp\htdocs\cobin\cobin\cloudflared.exe" tunnel --url http://127.0.0.1:80
pause
