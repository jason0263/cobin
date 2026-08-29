# 使用官方輕量 Node.js 映像檔
FROM node:18-alpine

# 設定工作目錄
WORKDIR /app

# 複製依賴描述檔
COPY package*.json ./

# 安裝依賴
RUN npm install --production

# 複製專案全部原始碼
COPY . .

# 暴露連接埠
EXPOSE 8080

# 啟動命令
CMD ["node", "server.js"]
