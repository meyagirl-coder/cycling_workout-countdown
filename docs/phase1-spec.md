# Phase 1 技術規格：課表解析＋倒數計時執行器

> 目標：純前端、無後端、離線可用（PWA）。此文件可直接餵給 Claude Code 開始開發。
>
> 本檔案是這個專案原本只存在對話紀錄裡的規格文件，第一次正式落地成 repo 裡
> 的檔案。1-8 節是 Phase 1 一開始的原始規格；4.5 節、5.1 節是後續 UI 改善時
> 補上的章節（首頁品牌識別橫幅、執行頁完成後的引導流程）。

---

## 1. 範圍界定

**這個 Phase 要做的事：**
- 讀取一份課表（先支援 .zwo 檔上傳；網址讀取放 Phase 3——實際開發時提前把
  intervals.icu 課表載入做進來了，見 5.1 節）
- 轉成統一的課表 JSON 格式
- 執行頁：時間軸、倒數計時、自動切組、目標瓦數、功率區間顏色
- 播放控制：播放/暫停/跳組/重做本組/提早結束
- 微調瓦數（±1%）
- FTP／體重設定（localStorage）
- 10 秒倒數提示（音效＋語音＋大字）

**這個 Phase 不做：**
- 藍牙連接訓練台（ERG 控制）— 留到後面 Phase
- 課表網址讀取多平台 API — Phase 3（intervals.icu 提前做了，其他平台仍未做）
- 收藏清單／群組排序 — Phase 2
- YouTube 同步播放 — Phase 4

---

## 2. 統一課表資料結構（Workout Schema）

所有來源（zwo 檔、未來的 API）最終都要轉成這個格式，執行器只認這個 schema：

```json
{
  "id": "uuid-string",
  "name": "SST 3x12",
  "source": "zwo",
  "totalDuration": 3600,
  "intervals": [
    {
      "type": "warmup",
      "duration": 600,
      "powerStart": 50,
      "powerEnd": 70,
      "cadence": null
    },
    {
      "type": "steady",
      "duration": 720,
      "powerStart": 88,
      "powerEnd": 88,
      "cadence": 90
    },
    {
      "type": "freeride",
      "duration": 300,
      "powerStart": null,
      "powerEnd": null,
      "cadence": null
    }
  ]
}
```

**欄位說明：**
- `type`: `warmup` | `steady` | `ramp` | `freeride` | `cooldown`
  - `freeride` 沒有目標瓦數（休息段，切回 Resistance Mode，不顯示 target watt）
- `powerStart` / `powerEnd`: 佔 FTP 的百分比（例如 88 代表 88% FTP）。`steady` 段兩者相同；`ramp`／`warmup`／`cooldown` 通常不同（線性變化）
- `duration`: 秒數
- `cadence`: 建議踏頻（可為 null）

**功率區間顏色（Coggan 七區間，寫成常數表）：**

| 區間 | %FTP | 顏色建議 |
|---|---|---|
| Z1 Active Recovery | ≤55% | 灰 |
| Z2 Endurance | 56–75% | 藍 |
| Z3 Tempo | 76–90% | 綠 |
| Z4 Threshold | 91–105% | 黃 |
| Z5 VO2max | 106–120% | 橘 |
| Z6 Anaerobic | 121–150% | 紅 |
| Z7 Neuromuscular | >150% | 紫 |

> 邊界值都算在「較低」的那個區間（例如剛好 55% 算 Z1、剛好 105% 算 Z4），
> `getZoneColor()` 依序比對每個區間的上限（`<=`），不是用「下一個區間的下限」
> 判斷——曾經在這個邊界的 inclusive/exclusive 上寫錯（55% 誤判成 Z2），已於
> `test/timerEngine.test.js` 的 `getZoneColor` 測試逐一涵蓋每個邊界點修正。

顏色由 `powerPct` 即時算出，不存在 schema 裡。

---

## 3. 課表輸入來源與解析

### 3.1 .zwo 檔解析

.zwo 是 XML 格式（Zwift workout file），常見標籤：
- `<SteadyState Duration="720" Power="0.88"/>` → `type: steady`
- `<Warmup Duration="600" PowerLow="0.5" PowerHigh="0.7"/>` → `type: warmup`
- `<Ramp Duration="300" PowerLow="0.6" PowerHigh="1.0"/>` → `type: ramp`
- `<FreeRide Duration="300"/>` → `type: freeride`
- `<Cooldown Duration="300" PowerLow="0.7" PowerHigh="0.5"/>` → `type: cooldown`

Power 值是 0–1 的小數（0.88 = 88% FTP），parser 要 ×100 轉成整數百分比存進 schema。

**Parser 函式簽名：**

```js
function parseZwoXml(xmlString) -> Workout
```

純函式，輸入 XML 字串，輸出上面的 Workout JSON，不碰 UI、不碰 localStorage。方便單獨寫測試。

### 3.2 貼上純文字課表解析

不需要上傳檔案或串接帳號，讓使用者直接貼上從公開課表頁面（例如 TrainerDay
未登入狀態）複製的純文字。已知格式，每行一組：

```
10 min @ 53w
20 min @ 68w
```

這種公開頁面在未登入狀態下，瓦數是以 FTP=100 為基準換算的，所以「Yw」數字
直接等於「Y% FTP」，不需要額外換算；每行轉成一個 `type: steady` 的組別
（`powerStart`／`powerEnd` 都等於 Y）。

也支援「重複組」寫法：單獨一行的「Nx」（例如 `3x`）宣告接下來連續的
`X min @ Yw` 行要重複 N 次，直到遇到空行、下一個「Nx」宣告、或文字結束為止，
展開成實際的組別數量塞進 intervals 陣列。

貼上的文字如果有解析不出來的行（格式跟預期不同），parser 要拋出清楚指出是
第幾行、內容是什麼的錯誤，不能默默略過或整份解析失敗卻講不出原因。

漸變段（例如 `53-68w`）目前不支援，留待之後擴充。

**Parser 函式簽名：**

```js
function parsePasteText(text) -> Workout
```

純函式，跟 `parseZwoXml()` 同樣不碰 UI、不碰 localStorage。

### 3.3 貼上 TrainerDay 課表網址（自動抓取）

除了手動複製貼上文字，「貼上課表文字或網址」欄位也接受直接貼上 TrainerDay
公開課表網址（例如 `https://app.trainerday.com/workouts/20260714-ramp-up-5`）
——偵測到輸入以 `http` 開頭且網域是 `app.trainerday.com` 就呼叫
`/api/trainerday-workout` 這個 Vercel Serverless Function 代理抓取（伺服器
端抓取，不受瀏覽器 CORS 限制，不需要登入或 API key）。

流程：
1. Proxy 只允許抓取 `app.trainerday.com` 底下的網址（避免被當成任意網址的
   SSRF 跳板），伺服器端 fetch 完整 HTML。
2. 用 `extractWorkoutTextFromHtml()` 從 HTML 裡撈出符合 §3.2 格式的行（跟
   `parsePasteText()` 共用同一套「什麼樣的行算課表內容」的正則），組成純
   文字，用 `text/plain` 回傳給前端。
3. 前端拿到純文字後，直接餵給既有的 `parsePasteText()` 解析——重複使用
   §3.2 的邏輯，沒有另外寫一份新的解析器。
4. 抓取或擷取失敗（網址打不開、頁面結構跟預期不同）都要清楚顯示錯誤訊息，
   並提示使用者可以改用「直接複製貼上文字內容」的備援方式。

> 這個擷取邏輯是在沒有即時 HTML 結構可以核對的情況下寫的（開發環境的網路
> 政策擋掉了 app.trainerday.com），所以刻意不依賴任何猜測出來的 CSS
> class／id，改用文字模式擷取，對頁面標記結構的變化有一定容忍度——但如果
> 部署後發現抓到的課表跟頁面顯示的不同，請改用「直接複製貼上文字內容」，
> 並回報實際的頁面結構以便調整擷取邏輯。

### 3.4 貼上 WhatsOnZwift 課表網址（自動抓取，另一套文法）

同一個「貼上課表文字或網址」欄位也接受 WhatsOnZwift 公開課表網址（例如
`https://whatsonzwift.com/workouts/...`）——偵測到網域是 `whatsonzwift.com`
（含 `www` 子網域）就呼叫 `/api/whatsonzwift-workout` 代理抓取。

WhatsOnZwift 的課表文字格式跟 TrainerDay 完全不同，所以另外寫了一份
`parseWhatsOnZwiftText()`，不是擴充 `parsePasteText()`：

- `Xmin from A to B% FTP` → ramp 段，A／B **直接就是 %FTP**（頁面上明確寫了
  「FTP」字樣，不是像 TrainerDay 用瓦數代表 FTP=100 時的百分比，兩者的數字
  意義不同，不能套用同一套換算假設）
- `Xmin @ Y% FTP` → steady 段，Y 直接就是 %FTP
- `Nx Xmin @ Y% FTP, Zmin @ W% FTP` → 複合重複組：兩段寫在**同一行、用逗號
  分隔**，合起來重複 N 次——跟 §3.2 的「Nx」換行展開語法不一樣（那邊重複
  次數獨立一行、接下來連續幾行才算內容），這裡的兩段內容跟重複次數本來就
  在同一行寫完

流程跟 §3.3 一樣（proxy 抓 HTML → `extractWhatsOnZwiftTextFromHtml()` 擷取
→ 前端用 `parseWhatsOnZwiftText()` 解析），只是擷取沒有寬鬆模式備援：複合
重複組格式比 TrainerDay 單純的「X min @ Yw」複雜很多，如果不要求整行完全
符合格式、只在一大段文字裡搜尋片段，很容易把不相關的內容誤組成一個「看起來
合理但其實是錯的」複合重複組——這種安靜算錯比直接擷取失敗、提示改用手動
貼上更危險，所以嚴格模式沒比對到任何整行格式就直接視為擷取失敗。

驗收案例（Over-Unders 課表）：

```
5min from 40 to 105% FTP
2min @ 50% FTP
3x 2min @ 105% FTP, 1min @ 90% FTP
3min @ 51% FTP
3x 2min @ 105% FTP, 1min @ 91% FTP
5min from 70 to 40% FTP
```

解析結果：16 組、總時長 33 分鐘，跟頁面顯示的「Duration: 33m」一致。

> 跟 §3.3 一樣，這個擷取邏輯是在沒有即時 HTML 結構可以核對的情況下寫的
> （開發環境的網路政策也擋掉了 whatsonzwift.com），部署後發現抓到的課表跟
> 頁面顯示的不同，請改用「直接複製貼上文字內容」，並回報實際的頁面結構。

### 3.5 「時長 百分比」貼上格式（第三種手動貼上文字格式）

跟 §3.2 的 TrainerDay 格式並存的第三種手動貼上格式，例如 `5m 50%`：沒有
`@`、沒有 `w`、沒有 `FTP` 字樣，單位用 `m`（分鐘）／`s`（秒），數字直接就是
%FTP。`Nx` 換行重複語法跟 §3.2 一致（獨立一行的「Nx」宣告接下來連續的
`Xm Y%`／`Xs Y%` 行要重複 N 次，直到空行／下一個 Nx／文字結束）。

**Parser 函式簽名：**

```js
function parseSpacePercentText(text) -> Workout
```

跟 §3.2 共用同一套「Nx 換行重複」狀態機（`newlineRepeatTextParser.js`），
只有「一行課表內容長什麼樣子」不同。

**自動格式偵測**：「貼上課表文字內容」欄位現在同時認得三種手動貼上格式
（§3.2 TrainerDay、§3.4 的 WhatsOnZwift 文法、本節），送出時由
`parseAutoDetectedPasteText()`（`src/parser/pasteTextRouter.js`）判斷：找
文字裡第一個看起來像課表內容的行（略過空行跟單獨的「Nx」宣告，因為那兩種
在多種格式裡都可能出現），依它符合哪個格式的正則（有沒有 `@`、有沒有 `w`
字尾、有沒有 `FTP` 字樣、還是「純數字＋單位＋百分比」）決定用哪個 parser
解析整份文字，三種格式的行形狀差異夠大，不會互相誤判。

---

## 4. 倒數計時引擎（整個系統的心臟）

### 4.1 設計原則
- **純函式邏輯 + 計時器分離**：計時引擎只管「現在第幾組、這組剩幾秒、目標瓦數多少」，不管畫面怎麼畫。
- **不要用 `setInterval` 累加秒數**：分頁切到背景（例如之後要並排看 YouTube）時，`setInterval` 會被瀏覽器降頻，導致計時不準。改用「記錄開始時間戳 + 每次 tick 用 `Date.now() - startTimestamp` 重新計算經過秒數」，或用 Web Worker 跑計時器再 postMessage 回主執行緒。**建議直接用 Web Worker**，避免背景分頁誤差。

### 4.2 狀態機

```
狀態：idle → running → paused → running → finished
                ↓ (skip/redo/stop 隨時可觸發，不限狀態)
```

**State 物件：**

```js
{
  status: 'idle' | 'running' | 'paused' | 'finished',
  currentIntervalIndex: 0,
  elapsedInInterval: 0,      // 秒
  elapsedTotal: 0,           // 秒
  powerAdjustPct: 0,         // 使用者 ±1% 微調的累加值
  startTimestamp: null       // Date.now()，用於漂移校正
}
```

**Actions：**
| Action | 行為 |
|---|---|
| `play()` | idle/paused → running，記錄/更新 startTimestamp |
| `pause()` | running → paused |
| `skip()` | 跳到下一組，elapsedInInterval 歸零 |
| `redo()` | 重置目前這組的 elapsedInInterval 為 0，狀態不變 |
| `stop()` | → finished，提早結束整份課表 |
| `adjustPower(+1 \| -1)` | powerAdjustPct += 1 或 -1，即時套用到目前顯示的 target watt |
| `tick(now)` | 每秒（或每 200ms 更精細）呼叫一次，重新計算 elapsed，判斷是否該切組 |

### 4.3 核心計算（純函式，方便單獨測試）

```js
function computeCurrentTarget(workout, intervalIndex, elapsedInInterval, ftp, adjustPct) {
  const iv = workout.intervals[intervalIndex];
  if (iv.type === 'freeride') return { watts: null, pct: null };

  // ramp 類型：線性內插目前這一秒對應的 %FTP（僅供畫面顯示，不送 ERG 訊號）
  const ratio = elapsedInInterval / iv.duration;
  const pct = iv.powerStart + (iv.powerEnd - iv.powerStart) * ratio;
  const adjustedPct = pct + adjustPct; // 使用者手動微調
  const watts = Math.round(ftp * adjustedPct / 100);

  return { watts, pct: adjustedPct, zoneColor: getZoneColor(adjustedPct) };
}
```

> 已確認：ramp 段不需要逐秒送 ERG 訊號給訓練台（此 Phase 也還沒接藍牙），但畫面上的 target watt 仍應逐秒內插顯示，讓使用者知道現在該踩多重——這是純顯示邏輯，跟「有沒有控制訓練台」是兩件事。

**自動切組判斷：**

```js
if (elapsedInInterval >= currentInterval.duration) {
  currentIntervalIndex += 1;
  elapsedInInterval = 0;
  if (currentIntervalIndex >= workout.intervals.length) status = 'finished';
}
```

### 4.4 倒數提示邏輯
- 每組剩餘時間 = `duration - elapsedInInterval`
- 當剩餘時間 === 10 秒（且該組時長 > 10 秒才觸發，避免短組被誤判）：
  - 播放提示音
  - 觸發語音（`SpeechSynthesis` API，唸「10 秒後切換下一組」或類似）
  - 畫面大字顯示倒數數字
- 切組瞬間（剩餘時間從 1 變 0）：
  - 大字顯示下一組資訊（時間／%FTP／瓦數）

### 4.5 課表完成流程（新增）

課表結束的方式有兩種，都會進入 `finished` 狀態：
1. **自然跑完**：最後一組的 `elapsedInInterval` 到達其 `duration`。
2. **提早結束**：使用者按下「提早結束」按鈕（`stop()`）。

不論哪種方式，`finished` 狀態的畫面需求：
- 顯示完成橫幅「課表完成！」
- 播放/暫停、跳組、重做本組、提早結束四個按鈕全部停用（避免對已結束的課表下指令）
- **完成橫幅下方要有「回到主畫面」按鈕**：點擊後離開執行頁，回到首頁（5.1 節的上傳/貼
  intervals.icu 連結畫面），讓使用者可以馬上選下一份課表，不需要重新整理頁面。
  - 這個動作只是畫面切換（顯示首頁、隱藏執行頁），不需要重置計時引擎本身的
    內部狀態——下次使用者上傳新課表時，`client.init(newWorkout)` 本來就會用
    全新的 Workout 建立一份全新的計時引擎狀態，蓋掉舊的。
  - 回到首頁時，任何還沒消失的「下一組資訊」倒數 banner 要一併收起，避免下
    一份課表一開始就出現上一份課表殘留的提示文字。

---

## 5. 首頁與執行頁 UI 需求

### 5.1 首頁（上傳畫面）UI 需求（新增）

App 一打開，使用者第一眼看到的畫面：

- **App 品牌識別橫幅**：整個 App 最上方、不屬於任何單一畫面的品牌識別區
  （不是「上傳畫面」自己的標題，是 App 層級的頭部），包含：
  - 主標題，例如「自行車訓練課表播放器」
  - 一句簡短說明副標，例如「上傳課表檔案或連結 intervals.icu，開始你的結構化訓練」
  - 只在首頁（上傳畫面）顯示；進到執行頁後隱藏，把畫面空間讓給倒數計時跟
    target watt，這兩個在騎車時才是使用者真正需要一直盯著看的內容。
- **intervals.icu 課表載入（主要情境，畫面排最上面）**：貼上課表網址或直接
  輸入 event ID，透過 `/api/intervals-zwo` 這個 Vercel Serverless Function
  代理下載 `.zwo` 內容，一樣用 `parseZwoXml()` 解析（只有部署在有 Serverless
  Function 的平台才會動，純靜態 hosting 只保留檔案上傳）。輸入框下方有「點此
  查詢最近一筆行事曆訓練代碼」連結，用新分頁打開 `/api/intervals-events`
  查詢工具（見 §5.1.1），不會離開目前畫面；區塊標題字級跟「上傳課表」一致、
  置中對齊，視覺上兩個載入方式權重相同。
- **本機檔案上傳（次要情境，畫面排在 intervals.icu 區塊下方，中間用「或」分
  隔）**：選一份 `.zwo` 課表檔案，讀出內容後用 `parseZwoXml()` 解析
- **貼上純文字課表或網址（第三種情境，畫面排在檔案上傳下方，中間用「或」分
  隔）**：同一個 textarea 同時支援輸入——貼上從公開課表頁面複製的純文字
  （§3.2 TrainerDay 格式、§3.4 WhatsOnZwift 格式、或 §3.5「時長 百分比」格式
  三選一，自動偵測），或直接貼上 TrainerDay 課表網址（見 §3.3），或直接貼上
  WhatsOnZwift 課表網址（見 §3.4）。送出時依序判斷：不是 `http` 開頭就當純
  文字送進 `parseAutoDetectedPasteText()`（自動判斷是三種文字格式中的哪一種
  再分流解析）；是網址就再判斷網域——`app.trainerday.com` 呼叫
  `/api/trainerday-workout` 抓回來用 `parsePasteText()` 解析、
  `whatsonzwift.com`（含 `www`）呼叫 `/api/whatsonzwift-workout` 抓回來用
  `parseWhatsOnZwiftText()` 解析；網域不是這兩者之一，直接在畫面上顯示「目前
  只支援 TrainerDay 或 WhatsOnZwift 的課表網址」，不會呼叫任何 proxy
- 解析失敗（檔案、intervals.icu 回傳的內容、貼上的純文字、或任一網址抓取都
  一樣）要有清楚的錯誤訊息，並留在首頁讓使用者重試，不能整個畫面壞掉；網址
  抓取失敗時要額外提示可以改用「直接複製貼上文字內容」

#### 5.1.1 找 event ID：`/api/intervals-events`

只列出「今天（含）或未來」的課表事件，已過去的日期一律濾掉；`events` 依
日期由近到遠排序，`nearest` 是離今天最近、還沒發生的那一筆（週期性排課、
同一週有多天課表時就是這個欄位要解決的情境）。**「今天」以使用者瀏覽器的
本地日期為準，不是 Vercel 伺服器的時區**——伺服器多半跑在 UTC，跟台灣
（UTC+8）這類時區在地區跨日的那幾小時內會整整差一天，所以前端呼叫這支 API
時一律帶 `?today=YYYY-MM-DD`（瀏覽器本地日期），伺服器只有在完全沒收到這個
參數時才退回用自己的 UTC 日期。`api/intervals-zwo.js`／`api/intervals-events.js`
兩支 proxy 的回應都帶 `Cache-Control: no-store`、`Pragma: no-cache`、
`Expires: 0`，避免任何一層快取把舊的或別的 event ID 的內容當成最新結果回傳。

### 5.2 執行頁 UI 需求

- 上方：課表名稱、總時長、目前組別 / 總組數（如「第 3 / 8 組」）
- 中間：時間軸圖（橫向，顯示所有組別的長度比例＋功率區間顏色，逐瞬時功率
  區間上色而不是整組取一個固定平均色；組別交界處要有清楚分隔線，不管相鄰
  顏色是否相同），目前位置有指示游標
- 大數字倒數計時（目前這組剩餘秒數，格式 mm:ss），剩餘 ≤10 秒（且本組時長
  >10 秒）時要有明顯的視覺提示（見 4.4／4.5）
- Target watt 顯示（大字），旁邊小字顯示對應 %FTP；顏色計算邏輯要跟時間軸
  一致，兩者永遠同步
- 控制按鈕：播放/暫停（圓形三角形/正方形）、跳組、重做本組、提早結束
- ± 微調按鈕（點一下調整 1%，即時反映在 target watt）
- 畫面常亮：使用 WakeLock API 避免螬幕在騎車中自動休眠
- 課表完成後的引導流程見 4.5 節

---

## 6. 資料儲存

- FTP、體重：`localStorage`，key 建議 `user_ftp`、`user_weight`，App 啟動時讀取，沒有就跳出設定畫面
- 這個 Phase 還不用 IndexedDB（留給 Phase 2 存課表清單／群組用）

---

## 7. 建議開發順序（給 Claude Code 的執行序列）

1. 先寫 `parseZwoXml()` 純函式 + 3–5 個測試用 .zwo 檔案，確認轉出的 JSON 符合 schema
2. 寫計時引擎（純邏輯，不含 UI），用假資料在 console 跑過一輪完整課表，確認自動切組、ramp 內插、skip/redo/stop 都正確
3. 接上 Web Worker 計時，確認切到背景分頁不會失準
4. 做執行頁 UI，先串接假資料看畫面
5. 串上真的 parser 輸出，跑一次完整課表
6. 加提示音／語音／大字倒數
7. 加 FTP／體重設定頁與 localStorage 串接
8. 加 ± 微調按鈕
9. 全部跑一次「上傳 zwo → 設定 FTP → 執行完整課表」的完整流程，作為 Phase 1 驗收標準

---

## 8. Phase 1 驗收標準（Definition of Done）

- [x] 上傳任意合法 .zwo 檔可正確解析並顯示課表
- [x] 執行時倒數與自動切組準確（背景分頁切換不影響準確度）
- [x] Target watt 依 FTP 與目前組別百分比正確換算，ramp 段逐秒內插顯示
- [x] 播放/暫停/跳組/重做/提早結束皆正常運作
- [ ] ±1% 微調即時反映在畫面（引擎已支援 `adjustPower()`，UI 按鈕尚未串接）
- [x] 10 秒倒數有音效＋語音＋大字提示
- [x] FTP 可設定並在下次開啟時記得（同裝置內，`localStorage` key `user_ftp`）；體重設定留待之後
- [x] freeride 段不顯示 target watt
- [x] 首頁有 App 品牌識別橫幅，執行頁完成後可一鍵回到首頁（4.5／5.1 節）
