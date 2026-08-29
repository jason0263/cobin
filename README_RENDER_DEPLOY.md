# 🚀 Cobin Voice & Video - Render.com 24/7 免費雲端部署手冊

本專案已完全配置好 **Render.com 原生支援**（零配置、零費用、24 小時永久在線）！
只要部署到 Render.com，**你的電腦即使完全關機、斷電，手機和朋友依然能 365 天隨時隨地進房通話與劇院全螢幕分享！**

---

## 📋 3 步極速部署教學（只需 3 分鐘，0 元）：

### 第一步：把專案上傳到 GitHub（若已有 GitHub 倉庫可略過）

1. 打開 [GitHub.com](https://github.com/) 並登入（或免費註冊一個帳號）。
2. 點擊右上角的 **`+` ➜ `New repository`**。
3. 倉庫名稱填寫（例如 `cobin-call`），設為 **Public（公開）** 或 **Private（私有）** 都可以，點擊 **Create repository**。
4. 在本地資料夾 `C:\xampp\htdocs\cobin\cobin` 執行以下指令推送到 GitHub：
   ```bash
   git init
   git add .
   git commit -m "Deploy Cobin to Render"
   git branch -M main
   git remote add origin https://github.com/你的用戶名/cobin-call.git
   git push -u origin main
   ```

---

### 第二步：在 Render.com 建立免費 Web 服務

1. 打開 [Render.com](https://dashboard.render.com/) 並點擊 **Sign Up**（建議直接用 GitHub 帳號一鍵登入）。
2. 登入後，點擊右上角藍色的 **`+ New` ➜ `Web Service`**。
3. 選擇 **`Build and deploy from a Git repository`**，找到並點擊你的 `cobin-call` 倉庫旁邊的 **`Connect`** 按鈕。
4. 填寫基本設定（大部分 Render 會自動識別）：
   - **Name**: `cobin-call`（或任何你喜歡的名字）
   - **Region**: 選擇距離你最近的地區（例如 `Singapore` 新加坡 或 `Oregon`）
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: 選擇 **`Free`（0 元免費）**
5. 滑到最下方，點擊 **`Create Web Service`**！

---

### 第三步：大功告成！獲取你的永久專屬通話網址

- Render 會自動開始構建，大約 **30 秒** 後狀態會變成綠色的 **`Live`**！
- 在頁面左上方即可看到你的 **專屬永久 HTTPS 網址**，例如：  
  👉 **`https://cobin-call.onrender.com`**

🎉 **現在你可以直接關閉電腦，把這個網址發給朋友，雙方手機與電腦 24 小時隨時都能通話與全螢幕分享了！**
