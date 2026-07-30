# 專案交接文件（從 Claude Code 轉 Codex）

這份文件寫給接手的人／接手的工具（例如 Codex），目的是不用重新摸索就能
接著往下開發、部署。技術規格（資料結構、解析規則、UI 需求）已經寫在
`docs/phase1-spec.md`（約 1000 行），這份文件不重複那些內容，只補「現在
專案長什麼樣子」跟「怎麼測試、怎麼上線」。

## 1. 專案是什麼

自行車課表執行倒數計時器（PWA），純前端、無 build 步驟：
- 沒有 React / Vue 等框架，純 vanilla JS ES modules（`src/**/*.js`），
  瀏覽器原生 `<script type="module">` 直接載入 `index.html`。
- 沒有 bundler、沒有 TypeScript、沒有 CSS 前處理器。改完檔案重新整理
  頁面就是最新結果，不用跑 build。
- 唯一的「後端」是 `api/*.js`：Vercel Serverless Functions，各自代理一個
  第三方課表服務（intervals.icu／TrainerDay／WhatsOnZwift），把 API Key
  留在伺服器端不外流。
- 測試用 Vitest（`test/*.test.js`，jsdom 環境），無 e2e 測試框架長駐在
  repo 裡；本 session 需要真的看畫面時是用 Playwright 臨時腳本驗證後就
  刪掉（見第 4 節）。

## 2. 部署方式

- **Vercel 從 `main` branch 自動部署**。沒有手動部署指令，merge 進
  `main` 就是「上線」。
- 開發全程在 feature branch `claude/zwo-parser-implementation-2mm7gk`
  上進行（GitHub repo：`meyagirl-coder/cycling_workout-countdown`）。
  接手後可以延用這個 branch，或改用新的 branch，習慣上是這樣：
  1. 在 feature branch 上改代碼、跑測試。
  2. commit + push 到 feature branch。
  3. 開 PR（base: `main`），確認測試通過、本機視覺確認沒問題。
  4. Squash merge 進 `main` → Vercel 自動部署。
- **重要的部署前提醒**：這個專案「沒有 build 步驟、每個 `.js` 檔案的
  網址每次部署都不會變（沒有內容雜湊當版本號）」，`vercel.json` 因此把
  非 `/api/*` 的靜態檔案都設成 `Cache-Control: no-cache, must-revalidate`，
  避免瀏覽器（尤其 iOS Safari）快取到部署前的舊版 JS。改 `vercel.json`
  前請先看 `README.md` 裡對應那段的完整說明。
- Vercel 環境變數（Settings → Environment Variables，Production／Preview
  都要設）：
  - `INTERVALS_ICU_ATHLETE_ID`、`INTERVALS_ICU_API_KEY`
    （給 `api/intervals-zwo.js`、`api/intervals-events.js` 用；對照
    `.env.example`，真正的值不要進 git）。
  - `api/trainerday-workout.js`、`api/whatsonzwift-workout.js` 目前不需要
    環境變數（直接代理公開頁面，不用 API Key）。

## 3. 目錄結構速覽

```
index.html              入口頁面（純靜態，載入 src/ui/playerApp.js）
api/                     Vercel Serverless Functions（第三方課表代理）
  intervals-zwo.js         intervals.icu -> 下載 .zwo
  intervals-events.js      intervals.icu -> 查最近課表 event ID
  trainerday-workout.js    TrainerDay 課表代理
  whatsonzwift-workout.js  WhatsOnZwift 課表代理
src/
  schema/workoutSchema.js       統一課表資料結構 + 驗證
  parser/                       各種輸入來源的 parser（見下方列表）
  engine/timerEngine.js         核心倒數計算的純函式（computeBandTarget 等）
  worker/                       Web Worker：實際跑計時的 tick loop
    timerWorker.js / timerWorkerClient.js / workerRuntime.js
  ui/                            所有畫面／狀態管理
    uploadView.js                首頁（上傳/貼上課表/排程）
    renderPlayer.js               執行頁的畫面渲染
    playerApp.js                  串起 worker、parser、UI 的主程式
    countdownAlerts.js             語音／逼逼聲倒數提示邏輯
    scheduledStartRuntime.js       「設定開始時間」排程等待邏輯
    groupJoinLinkParser.js         開團分享連結解析
    alertModeStore.js / ftpStore.js / scheduleStore.js / themeStore.js
      / draftInputStore.js / workoutProgressStore.js  各種 localStorage 狀態
    timelineSegments.js            執行頁時間軸視覺化的分段邏輯
test/                    對應每個 src 模組一支 *.test.js，另有 test/fixtures/*.zwo
docs/phase1-spec.md      完整功能規格（資料結構、解析規則、UI 驗收標準）
docs/HANDOFF.md          本文件
```

課表輸入來源（`src/parser/`）目前支援：`.zwo` 檔上傳、貼上純文字（多種
方言格式：換行重複格式、空白+百分比格式、WhatsOnZwift 格式、TrainerDay
完整複製格式、TrainerDay workout-structure 格式）、貼課表網址自動抓取
（intervals.icu／TrainerDay／WhatsOnZwift）、開團分享連結、intervals.icu
行事曆課表查詢。

## 4. 開發與測試慣例

```bash
npm install
npm test          # 跑一次全部測試（目前 700+ 支，vitest run）
npm run test:watch
```

- 純前端頁面本機預覽：`python3 -m http.server` 在 repo 根目錄開，開瀏覽器
  打開 `http://localhost:<port>/index.html` 即可，`.zwo` 上傳不需要後端。
- 需要 intervals.icu／TrainerDay／WhatsOnZwift 代理功能時要用
  `vercel dev`（讀 `.env.local`），單純 UI 改動不需要。
- **視覺驗證的臨時慣例**（本 session 建立、建議延續）：需要「眼見為憑」
  確認畫面渲染結果時，寫一支 Playwright 腳本，檔名一律用 `*.tmp.mjs`
  放在 repo 根目錄（或 scratchpad），截圖存成 `*.png` 看過確認後，
  **commit 前務必刪掉這些臨時檔案**（`rm -f xxx.tmp.mjs xxx.png`），
  不要讓它們混進 git status。這個環境已預裝 Chromium：
  `playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`。
- 每個新 UI 文案／狀態邏輯都預期有對應的 `test/*.test.js` 更新或新增，
  不是「改完能動就好」——這個專案至今的每一輪功能都是先補測試、跑過
  `npx vitest run` 全綠，才 commit。

## 5. 目前功能狀態（依 git log 由新到舊）

- 「視訊分享僅逼逼聲模式支援」提示文字（單行合併版本，已部署）。
- Homepage 卡片順序：設定開始時間 → 貼課表網址 → 開團分享連結
  → 貼上課表文字內容 → 上傳 ZWO 檔案（已部署）。
- SpeechSynthesis 倒數語音修正：在每次 `cancel()+speak()` 前呼叫
  `speechSynthesis.resume()`，修正 Chrome 已知的「連續呼叫 speak() 會
  卡住引擎、middle digit 消失」的 bug（已部署，**但使用者尚未回報真機
  上是否確實解決** ——如果後續使用者又反應「讀秒缺數字」，這是第一個
  該重新檢視的地方）。
- 「區間目標」(band) 課表支援：ZWO/文字解析、時間軸雙層視覺化、
  執行頁三處顯示都改成顯示範圍（而非取中點）。
- 一鍵開團連結（分享排程給隊友，隊友打開連結自動帶入開始時間）。
- 螢幕保持喚醒（wake lock）、主題切換（dark/light/auto）。
- intervals.icu／TrainerDay／WhatsOnZwift 三種課表網址自動抓取。

完整的功能驗收標準跟資料結構定義在 `docs/phase1-spec.md`，該文件本身
也有持續跟著功能更新（例如新增模式時會補一段規格），建議延續這個習慣：
加新功能規格類的東西寫進 `phase1-spec.md`，這份 `HANDOFF.md` 只放
「現況總覽 + 怎麼跑」，避免兩份文件互相打架。

## 6. 交接備註

- 這個 repo 沒有 `CLAUDE.md`／agent 專屬設定檔（`.claude/` 是空的），
  所以換工具不需要搬遷任何 agent 設定。
- Git commit 目前的 author 是 `Claude <noreply@anthropic.com>`——這是
  Claude Code 這個 session 環境本身要求的慣例，**不是**這個 repo 的 git
  hook（`.git/hooks/` 目前是空的，沒有擋 author 的檢查），換成 Codex 之後
  可以照 Codex 自己的慣例設定 commit author，不會有東西擋。
- 過去每一輪功能上線前，使用者的習慣是「本機測試過、明確說要部署」才
  merge 進 main；沒有自動化 CI gate，全靠人工在 merge 前跑
  `npx vitest run` 確認全綠。
