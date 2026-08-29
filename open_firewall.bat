@echo off
echo ============================================
echo   Cobin - 開放防火牆端口 80 和 8080
echo ============================================
echo.

netsh advfirewall firewall add rule name="Cobin HTTP 80" dir=in action=allow protocol=TCP localport=80
if %errorlevel%==0 (
    echo [OK] 端口 80 已開放
) else (
    echo [FAIL] 端口 80 開放失敗
)

netsh advfirewall firewall add rule name="Cobin WebSocket 8080" dir=in action=allow protocol=TCP localport=8080
if %errorlevel%==0 (
    echo [OK] 端口 8080 已開放
) else (
    echo [FAIL] 端口 8080 開放失敗
)

echo.
echo ============================================
echo   完成！按任意鍵關閉此視窗
echo ============================================
pause >nul
