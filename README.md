# cycling_workout-countdown
自行車課表執行倒數計時器 - Deployed by EZPage

## 開發

```bash
npm install
npm test        # 跑一次
npm run test:watch
```

`index.html` 是純前端頁面，直接用任何靜態伺服器打開即可本機預覽（例如
`python3 -m http.server`）；`.zwo` 檔案上傳不需要後端。

## intervals.icu 課表載入（需要部署在 Vercel）

`api/intervals-zwo.js` 是一個 Vercel Serverless Function，代理呼叫
intervals.icu 的 `download.zwo` 端點，把 Athlete ID／API Key 留在伺服器端，
前端只知道 event ID。**這個功能只有部署在 Vercel（或其他支援 Serverless
Function 的平台）才會動**——純靜態 hosting（例如 GitHub Pages 上的
`player-preview.html`）沒有後端可以代理，所以那份預覽檔案只保留本機 `.zwo`
上傳功能。

部署步驟：

1. 把這個 repo 連到 Vercel（Import Project，框架選 "Other"，Vercel 會自動把
   `/api/*.js` 部署成 Serverless Function，其餘當靜態檔案）。
2. 到 Vercel 專案的 **Settings -> Environment Variables**，新增：
   - `INTERVALS_ICU_ATHLETE_ID`：intervals.icu 個人設定頁看得到的 Athlete ID
     （含開頭的 `i`，例如 `i123456`）
   - `INTERVALS_ICU_API_KEY`：intervals.icu -> Settings -> Developer Settings
     產生的 API Key
   （對照 `.env.example`，兩者都設成 Production / Preview 環境即可，不要提交
   真正的值進 git。）
3. Deploy。之後在執行頁的上傳畫面，「從 intervals.icu 載入」欄位貼上課表網址
   或直接輸入數字 event ID，按「載入」就會透過這個 proxy 抓 `.zwo` 內容並用
   `parseZwoXml()` 解析、直接開始訓練。
