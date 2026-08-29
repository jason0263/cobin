@echo off
chcp 65001 >nul
cd /d "C:\xampp\htdocs\cobin\cobin"

:: 1. 啟動 PHP Workerman
tasklist /FI "WINDOWTITLE eq Cobin_Workerman*" 2>NUL | find /I /N "php.exe">NUL
if not "%ERRORLEVEL%"=="0" (
    start "Cobin_Workerman" /min "C:\xampp\php\php.exe" "C:\xampp\htdocs\cobin\cobin\server.php"
)

:: 2. 啟動 Apache
tasklist /FI "IMAGENAME eq httpd.exe" 2>NUL | find /I /N "httpd.exe">NUL
if not "%ERRORLEVEL%"=="0" (
    start "Cobin_Apache" /min "C:\xampp\apache\bin\httpd.exe"
)

:: 3. 啟動 Cloudflared 並將最新網址記錄到檔案
tasklist /FI "IMAGENAME eq cloudflared.exe" 2>NUL | find /I /N "cloudflared.exe">NUL
if not "%ERRORLEVEL%"=="0" (
    start /b "" "C:\xampp\htdocs\cobin\cobin\cloudflared.exe" tunnel --url http://127.0.0.1:80 --logfile "C:\xampp\htdocs\cobin\cobin\tunnel.log"
)

:: 等待 3 秒獲取最新網址並寫入桌面
timeout /t 3 /nobreak >nul
powershell -Command "$log = Get-Content 'C:\xampp\htdocs\cobin\cobin\tunnel.log' -ErrorAction SilentlyContinue | Select-String 'https://.*\.trycloudflare\.com'; if ($log) { $m = [regex]::Match($log[-1], 'https://[a-zA-Z0-9-]+\.trycloudflare\.com'); if ($m.Success) { $u = $m.Value + '/cobin/cobin/index.html'; Set-Content 'C:\xampp\htdocs\cobin\cobin\最新通話網址.txt' $u; Set-Content ([Environment]::GetFolderPath('Desktop') + '\【當前最新通話網址】.txt') \"您的 Cobin 24 小時通話網址：`r`n$u`r`n`r`n(複製上方網址發送給好友或用手機開啟即可直接通話！)\"; } }"
