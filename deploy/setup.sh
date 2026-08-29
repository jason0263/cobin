#!/bin/bash
# ============================================
# Cobin 一鍵安裝腳本
# 在 Oracle Cloud Ubuntu VM 上執行此腳本
# 用法: bash setup.sh 你的域名.com
# ============================================

set -e

DOMAIN="$1"

if [ -z "$DOMAIN" ]; then
    echo ""
    echo "============================================"
    echo "  錯誤：請提供你的域名！"
    echo "  用法: bash setup.sh 你的域名.com"
    echo "============================================"
    exit 1
fi

echo ""
echo "============================================"
echo "  Cobin 語音視訊通話 - 開始安裝"
echo "  域名: $DOMAIN"
echo "============================================"
echo ""

# 1. 更新系統
echo "[1/8] 更新系統套件..."
sudo apt update -y && sudo apt upgrade -y

# 2. 安裝 Nginx + PHP
echo "[2/8] 安裝 Nginx + PHP..."
sudo apt install -y nginx php-cli php-mbstring php-xml php-curl unzip curl

# 3. 安裝 Composer
echo "[3/8] 安裝 Composer..."
if ! command -v composer &> /dev/null; then
    cd /tmp
    curl -sS https://getcomposer.org/installer | php
    sudo mv composer.phar /usr/local/bin/composer
fi

# 4. 創建網站目錄並安裝依賴
echo "[4/8] 設定網站目錄..."
sudo mkdir -p /var/www/cobin
sudo chown -R $USER:$USER /var/www/cobin

# 複製檔案 (假設檔案已上傳到 /tmp/cobin-upload/)
if [ -d "/tmp/cobin-upload" ]; then
    cp /tmp/cobin-upload/index.html /var/www/cobin/
    cp /tmp/cobin-upload/app.js /var/www/cobin/
    cp /tmp/cobin-upload/server.php /var/www/cobin/
    cp /tmp/cobin-upload/composer.json /var/www/cobin/
    echo "  -> 已從 /tmp/cobin-upload/ 複製檔案"
fi

cd /var/www/cobin
composer install --no-dev --optimize-autoloader 2>/dev/null || echo "  -> Composer install 需要 composer.json"

# 5. 設定 Nginx
echo "[5/8] 設定 Nginx..."
sudo tee /etc/nginx/sites-available/cobin > /dev/null <<NGINX_CONF
server {
    listen 80;
    server_name $DOMAIN;
    root /var/www/cobin;
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
NGINX_CONF

sudo ln -sf /etc/nginx/sites-available/cobin /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx

# 6. 設定 WebSocket 服務 (開機自動啟動)
echo "[6/8] 設定 WebSocket 信令伺服器..."
sudo chown -R www-data:www-data /var/www/cobin

sudo tee /etc/systemd/system/cobin-ws.service > /dev/null <<SERVICE
[Unit]
Description=Cobin WebSocket Signaling Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/cobin
ExecStart=/usr/bin/php server.php start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

sudo systemctl daemon-reload
sudo systemctl enable cobin-ws
sudo systemctl start cobin-ws

# 7. 開放防火牆
echo "[7/8] 開放防火牆端口..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8080 -j ACCEPT 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || sudo apt install -y iptables-persistent

# 8. 安裝 SSL (Let's Encrypt 免費)
echo "[8/8] 安裝 SSL 憑證 (HTTPS)..."
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" --redirect || {
    echo ""
    echo "  ⚠️  SSL 自動安裝失敗，請手動執行："
    echo "  sudo certbot --nginx -d $DOMAIN"
    echo ""
}

echo ""
echo "============================================"
echo "  ✅ Cobin 安裝完成！"
echo ""
echo "  🌐 網站: https://$DOMAIN"
echo "  📱 手機也能用！"
echo ""
echo "  檢查狀態："
echo "    sudo systemctl status cobin-ws"
echo "    sudo systemctl status nginx"
echo "============================================"
echo ""
