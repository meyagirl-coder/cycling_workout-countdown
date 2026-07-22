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

**容錯處理**：實際從網頁複製貼上的內容常常會帶著清單項目符號（例如
「`* 10 min@ 53w`」），比對格式前會先用 `stripBulletPrefix()` 去掉常見的
符號（`*`／`-`／`•`／`‣`／`◦`）；`min` 跟 `@` 之間有沒有空格（`min@`／
`min @`）兩種寫法都接受。這兩個容錯規則跟 §3.4／§3.5 共用同一套正則／
去除符號的邏輯（見 `newlineRepeatTextParser.js` 的 `stripBulletPrefix()`），
不是只在其中一個地方處理、其他地方漏掉。

**Parser 函式簽名：**

```js
function parsePasteText(text) -> Workout
```

純函式，跟 `parseZwoXml()` 同樣不碰 UI、不碰 localStorage。

### 3.3 貼課表網址自動抓取

Phase 1 開發過程中做過「貼上 TrainerDay／WhatsOnZwift 課表網址，伺服器端
proxy 抓 HTML 後自動解析」的功能（`/api/trainerday-workout`、
`/api/whatsonzwift-workout` 兩支 Vercel Serverless Function），第一次實測
後兩邊都走不通，整個移除過一次：
- **WhatsOnZwift**：伺服器直接回傳 `HTTP 403`，判斷是反爬蟲防護擋下抓取
  請求；換過偽裝成真實瀏覽器的 User-Agent／Accept 標頭後仍然被擋，判斷是
  比 User-Agent 檢查更進階的防護（IP 信譽／TLS 指紋辨識／JS 挑戰之類），
  不是換標頭能繞過的。
- **TrainerDay**：抓取本身成功（`HTTP 200`），但當時的擷取邏輯（鎖定
  `X min @ Yw` 這個格式）在頁面回傳的 HTML 裡找不到符合的課表文字，判斷
  是猜錯了頁面上課表文字的實際格式。

後來使用者實際用另一個 Claude 對話成功抓到 TrainerDay 課表頁面的內容，
發現頁面上「Workout structure」區塊顯示的是 §3.7 的 `X min @ Y% (Zw)`
格式，不是 §3.2 的 `X min @ Yw`——**重新加回了 TrainerDay 的 URL 自動抓取**
（`api/trainerday-workout.js`，搭配
`extractTrainerDayWorkoutStructureFromHtml()` 從 HTML 擷取 §3.7 格式的課表
文字），只允許抓取 `app.trainerday.com` 底下的網址（避免被當成任意網址的
SSRF 跳板）。

之後也**重新加回了 WhatsOnZwift 的 URL 自動抓取**（`api/whatsonzwift-
workout.js`，搭配 `extractWhatsOnZwiftTextFromHtml()`，鎖定 §3.4 既有的
WhatsOnZwift 文字格式，不是套用 TrainerDay 的「Workout structure」格式——
兩個是完全不同的網站，沒有理由假設頁面文字長得一樣）。跟 TrainerDay 不同
的是，WhatsOnZwift 當初失敗的原因是**網站本身的反爬蟲防護**（伺服器直接
回傳 403），不是「擷取邏輯抓錯格式」——這種問題不會因為換一份新的
extractor、或换一個環境呼叫就自動解決，重新加回來是為了讓使用者能在
Vercel 正式環境重新驗證一次「這個防護是不是仍然存在」，如果還是 403，是
預期內、網站政策層級的結果，不代表程式碼有問題。

> 這個沙箱環境的網路政策本身連不上 `app.trainerday.com`／
> `whatsonzwift.com`（不管是 `curl`、走 proxy、還是 `WebFetch` 工具都在
> 政策層直接被 403 擋下，連 TCP tunnel 都建立不起來——用 proxy 的診斷端點
> 確認過是 `connect_rejected`，根本沒有送出真正的 HTTP 請求），沒辦法直接
> 對照實際頁面的 HTML 結構核對擷取邏輯，兩邊都是照使用者提供的範例文字／
> 既有已驗證過的格式實作的。**Vercel 正式部署的 serverless function
> 執行環境不受這個沙箱的網路政策限制**，實際能不能抓到要在正式環境測試
> 才能確定；如果部署後這兩支 proxy 又抓不到內容，請改用「貼上課表文字
> 內容」，並回報實際的錯誤訊息／頁面結構以便判斷是擷取邏輯問題還是網站
> 政策問題。

**踩過的坑：`htmlToLines()` 漏掉巢狀清單裡的重複組宣告**——實測發現真正的
「4X interval block」課表（`2026-0609-sst-2-x-20min-with-8x1min`）在 URL
自動抓取時，`4X` 這個重複宣告跟它底下第一個子項目（例如
「Active 1 min @ 100% (100w) 90 rpm」）整組消失，只留下同一層級的
「Rest 4 min @ 90%...」——19 組、58 分鐘的課表被解析成 5 組、26 分鐘。追查
後發現問題不在 parser（`parseTrainerDayWorkoutStructureText()` 對著實際
擷取出來的殘缺文字其實解析得完全正確），而在更早一步、把 HTML 轉成一行
一行純文字的共用工具 `htmlTextExtraction.js` 的 `htmlToLines()`：真實頁面
用巢狀清單呈現重複組（`<li>4X<ul><li>...</li><li>...</li></ul></li>`），
外層 `<li>` 在「4X」文字之後、閉合之前就直接開了下一層 `<ul>`，中間完全
沒有任何閉合標籤——`htmlToLines()` 原本只認「閉合標籤」當換行點
（`BLOCK_CLOSE_RE`），這種情況下「4X」跟巢狀清單第一個子項目的文字會被
黏成同一行、變成一行辨認不出任何格式的雜訊，被 `collapseToMatchingLines()`
的嚴格模式直接濾掉。修法：新增 `NESTING_CONTAINER_OPEN_RE`，讓
`<ul>`／`<ol>`／`<table>`／`<tbody>`／`<thead>` 這幾個「純容器」標籤的
**開始**標籤也算換行點——故意只加這幾個本身不會直接夾文字、只用來包住
其他區塊子元素的標籤，不含 `<li>`／`<div>`／`<p>` 等「本身就會直接夾文字」
的標籤，避免在兩個中間什麼都沒有的相鄰區塊元素之間多插入一個空行，誤觸發
「兩個相符行之間夾著別的內容」的判斷（`collapseToMatchingLines()` 靠空行
判斷 Nx 重複組在哪裡結束，如果每個區塊邊界都無差別插入換行，會把明明緊接
在一起的課表行誤判成中間有缺漏）。這個修正在共用的 `htmlTextExtraction.js`
裡，`extractWhatsOnZwiftTextFromHtml.js` 也共用同一套 `htmlToLines()`，
一併受益，不用另外修一份。

### 3.4 WhatsOnZwift 文字格式（手動貼上）

WhatsOnZwift 的課表文字格式跟 TrainerDay（§3.2）完全不同，所以另外寫了一份
`parseWhatsOnZwiftText()`，不是擴充 `parsePasteText()`：

- `Xmin from A to B% FTP` → ramp 段，A／B **直接就是 %FTP**（頁面上明確寫了
  「FTP」字樣，不是像 TrainerDay 用瓦數代表 FTP=100 時的百分比，兩者的數字
  意義不同，不能套用同一套換算假設）
- `Xmin @ Y% FTP` → steady 段，Y 直接就是 %FTP
- 複合重複組寫成**兩行**，不是同一行逗號分隔：
  ```
  Nx Xmin @ Y% FTP,
  Zmin @ W% FTP
  ```
  第一行是「Nx」開頭＋第一段內容，句尾逗號代表「還沒結束，下一行接著」；
  第二行是第二段內容，沒有逗號結尾代表這個重複區塊到此結束。這兩行合起來
  代表「Xmin @ Y% FTP」跟「Zmin @ W% FTP」合起來重複 N 次。跟 §3.2 的「Nx」
  換行展開語法不一樣（那邊重複次數獨立一行、接下來連續幾行都算內容，沒有
  「恰好兩行」的限制）；空行（包括夾在這兩行中間的空行）一律忽略，不影響
  重複區塊的配對。

驗收案例（Over-Unders 課表，來自 whatsonzwift.com/workouts/threshold/over-unders）：

```
5min from 40 to 105% FTP
2min @ 50% FTP
3x 2min @ 105% FTP,
1min @ 90% FTP
3min @ 51% FTP
3x 2min @ 105% FTP,
1min @ 91% FTP
5min from 70 to 40% FTP
```

解析結果：16 組、總時長 33 分鐘，跟頁面顯示的「Duration: 33m」一致。

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

### 3.6 TrainerDay「完整複製」貼上格式（第四種、優先格式）

使用者直接從 TrainerDay 課表頁面整段複製貼上的完整內容（不是手動逐行輸入），
比 §3.2 的手動輸入格式更明確、資訊更完整，所以是「貼上課表文字內容」欄位
現在優先判斷的格式。跟 §3.2 共用 `X min @ Yw` 的基本行格式（`Yw` 一樣直接
等於 `Y% FTP`），但有兩個關鍵差異：

- **第一行通常是總時長說明**，例如「持续时间: 59m」——這不是課表資料，
  `parseTrainerDayFullText()` 會識別並跳過這一行，不當成解析失敗處理。
- **重複組整組寫在同一行**，不是 §3.2「Nx 獨立一行＋後面連續幾行」的換行
  寫法：
  ```
  NX (段落1 | 段落2 | 段落3 ...)
  ```
  括號包住整組內容，裡面用 `|` 分隔任意數量的段落（可能 2 段、3 段、或
  更多，parser 不寫死段數）；`X` 大小寫都接受（`2X`／`2x`）。
- 一般行除了 `min` 也支援 `sec`（例如 `30 sec @ 110w`）——整段複製的內容
  比手動輸入更常見到秒數單位；§3.2 的 `parsePasteText()` 目前只支援
  `min`，兩者是各自獨立的 parser，不互相影響。

驗收案例：

```
持续时间: 59m
5 min @ 50w
5 min @ 80w
3 min @ 50w
1 min @ 70w
1 min @ 90w
30 sec @ 110w
3 min @ 50w
1 min @ 70w
1 min @ 90w
30 sec @ 110w
3 min @ 50w
1 min @ 70w
1 min @ 90w
30 sec @ 110w
3 min @ 50w
1 min @ 70w
1 min @ 90w
30 sec @ 110w
2X (8 min @ 64w | 2 min @ 90w | 1 min @ 110w)
5 min @ 50w
```

解析結果：25 組、總時長 3540 秒（59 分鐘），跟第一行「持续时间: 59m」一致。

**Parser 函式簽名：**

```js
function parseTrainerDayFullText(text) -> Workout
```

### 3.7 TrainerDay「Workout structure」貼上格式（第五種）

TrainerDay 課表頁面上「Workout structure」區塊顯示的格式，跟 §3.6「完整
複製」格式不一樣：每一行是 `X min @ Y% (Zw)`——百分比是**明寫**的（`Y%`），
不需要「未登入時瓦數＝FTP=100 基準」這個假設；括號內的 `Zw` 是依課表作者
實際 FTP 換算出來的瓦數，跟這個 App 使用者自己的 FTP 無關，直接忽略，只取
`Y%`。

也支援獨立一行的「Nx」換行重複語法，跟 §3.2／§3.5 一致（共用
`newlineRepeatTextParser.js` 的狀態機）。

驗收案例（`20260714-ramp-up-5` 課表）：

```
5 min @ 50% (50w)
5 min @ 55% (55w)
5 min @ 60% (60w)
5 min @ 65% (65w)
5 min @ 70% (70w)
5 min @ 75% (75w)
5 min @ 80% (80w)
5 min @ 85% (85w)
5 min @ 90% (90w)
5 min @ 95% (95w)
5 min @ 100% (100w)
5 min @ 50% (50w)
```

解析結果：12 組、總時長 60 分鐘，百分比從 50% 逐組爬升到 100% 再回落到
50%，符合「ramp-up」課表名稱的語意。

**更複雜的實際頁面內容（新增）**：另一份實測課表
（`2026-0609-sst-2-x-20min-with-8x1min`）暴露出比上面 12 行 ramp-up 範例更
接近真實頁面的內容，補齊三個 §3.7 原本沒處理的格式細節：

1. **行首狀態標籤**：平台官方定義的類型（不分大小寫，前面的清單符號可有
   可無）：`warm-up`／`warmup`、`active`、`cooldown`、`interval`、`rest`、
   `free-ride`／`freeride`、`open-ended`。純描述性文字，不影響後面時長／
   百分比的判斷。
2. **行尾踏頻**（例如 `90 rpm`）：Workout Schema 本來就有的 `cadence`
   欄位，抓得到就存進去，抓不到維持 `null`，不影響主要解析。
3. **重複組宣告用 Markdown 粗體包住**（`**4X**`，不是純文字 `4X`）：新增
   `stripMarkdownBold()`（`newlineRepeatTextParser.js`），跟既有的
   `stripBulletPrefix()`一樣是「這行讀起來是什麼」的正規化步驟，用在解析
   Nx 宣告之前。

**判斷原則（第一輪修正後仍不夠，第二輪改成這樣）**：一開始的做法是把
「狀態標籤」視為正則裡「行首容許 0 個以上任意英文單字」，結果太寬鬆也太
死板——寬鬆是因為隨便一個英文單字都會被接受，死板是因為仍然要求整行從頭
到尾剛好符合預期的位置順序（標籤在最前面、瓦數／踏頻在最後面），課表作者
實際寫法上的細節差異（例如標籤跟核心內容之間多了其他說明文字）還是會卡住。
第二輪改成「兩套正則各司其職」：
- **格式偵測用**（`TRAINERDAY_STRUCTURE_LINE_RE`，`pasteTextRouter.js`／
  `extractTrainerDayWorkoutStructureFromHtml.js` 用來判斷「這份文字是不是
  這個格式」）：維持整行錨定的結構，但用上面官方定義的標籤清單，不是任意
  英文單字——避免把不相關的文字誤判成這個格式。
- **實際逐行解析用**（`parseIntervalLine()` 內部的 `CORE_INTERVAL_RE`）：
  改成不錨定整行，只搜尋「時長 @ 百分比 (瓦數)」這段核心片段，不管前後
  出現多少狀態標籤字或其他資訊（踏頻、額外備註）都忽略——只有整行完全找
  不到這段核心片段，才算真正的格式錯誤。括號瓦數 `(Zw)` 仍然是必要條件
  （用來跟 WhatsOnZwift 的「% FTP」字面寫法區分），不是「隨便抓到數字＋%
  就算」。

驗收案例（`2026-0609-sst-2-x-20min-with-8x1min` 課表，Markdown 巢狀清單
呈現，粗體重複組宣告，兩個空格＋`*`縮排代表重複區塊內容）：

```
- Active 5 min @ 50% (50w) 80 rpm
- **4X**
  * Active 1 min @ 100% (100w) 90 rpm
  * Rest 4 min @ 90% (90w) 95 rpm
- Active 8 min @ 50% (50w) 85 rpm
- **4X**
  * Active 1 min @ 100% (100w) 90 rpm
  * Rest 4 min @ 90% (90w) 95 rpm
- Cooldown 5 min @ 50% (50w) 80 rpm
```

解析結果：1+4×2+1+4×2+1 = 19 組、總時長 58 分鐘，跟頁面顯示的「58m」一致。

**第四個格式細節——縮排也能當重複區塊的終止信號（`newlineRepeatTextParser.js`
共用狀態機的規則更新）**：上面這份課表兩個「`4X`」重複區塊底下的內容是用
縮排表示範圍（兩個空格＋`*`），緊接著下一個不縮排的項目（例如
`- Active 8 min...`）**沒有空行分隔**——原本「只有空行／下一個 Nx 宣告能
結束重複區塊」的規則在這裡會誤把 `Active 8 min...` 也吃進重複區塊裡。新增
規則：一旦重複區塊收集到「縮排嚴格大於 Nx 宣告那一行縮排」的內容行（代表
這個區塊確實是用縮排表示範圍的），之後只要縮排掉回宣告那一行的水準（不論
是不是空行），就視為區塊結束。§3.2／§3.5 既有的「扁平」寫法（每一行都跟
Nx 宣告同樣不縮排）不會觸發這條新規則，行為不變——只有「這個區塊裡確實
出現過比宣告行更深的縮排」才會啟用縮排判斷，空行判斷規則仍然並存，不是
互斥的兩套邏輯。

**第五個格式細節——第三種重複寫法：整行寫完的括號重複組**：跟 §3.6 的
`NX (段落1 | 段落2 | ...)` 語法一樣，也支援了，共用
`newlineRepeatTextParser.js` 新增的 `BRACKET_REPEAT_LINE_RE`（自帶次數跟
內容，遇到就直接展開，不需要「收集到哪裡結束」的狀態機）。例如：

```
4X (Active 1 min @ 100% (100w) 90 rpm | Rest 4 min @ 90% (90w) 95 rpm)
```

**Parser 函式簽名：**

```js
function parseTrainerDayWorkoutStructureText(text) -> Workout
```

跟 §3.2／§3.5 共用同一套「Nx 換行重複」狀態機，只有「一行課表內容長什麼
樣子」不同；跟 §3.6 的差異是本節的百分比明寫在行裡（`Y%`），不用像 §3.6
那樣靠「未登入時瓦數＝FTP=100」的假設換算。

**自動格式偵測（優先順序）**：「貼上課表文字內容」欄位現在認得五種手動貼上
格式（§3.2 TrainerDay 手動輸入、§3.4 WhatsOnZwift、§3.5「時長 百分比」、
§3.6 TrainerDay 完整複製、本節 TrainerDay Workout structure），送出時由
`parseAutoDetectedPasteText()`（`src/parser/pasteTextRouter.js`）判斷：

1. **優先判斷 §3.6 格式**：只要整份文字裡出現「持续时間」總時長說明行，或
   是整行寫完、且**不含 `%`** 的重複組 `NX (...)`，就直接判定是 §3.6 的
   格式——這兩種寫法是 §3.6 獨有的，不會出現在其他格式裡，優先於其他格式
   的判斷。**排除含 `%` 的括號重複組**是因為本節現在也支援同一種括號寫法
   （`NX (X min @ Y% (Zw) | ...)`），兩者的括號語法完全相同，只能靠段落
   內容有沒有 `%` 區分——這是修過的一個 bug：一開始沒排除，導致含 `%` 的
   括號重複組被誤判成 §3.6 格式，送進去只認 `Yw`（沒有百分比）的
   parser，直接解析失敗。
2. 否則找文字裡第一個看起來像課表內容的行（略過空行跟單獨的「Nx」宣告，
   因為那種行在多種格式裡都可能出現），依它符合哪個格式的正則（有沒有
   `@`、有沒有 `%`、有沒有括號包住的瓦數、有沒有 `w` 字尾、有沒有 `FTP`
   字樣、還是「純數字＋單位＋百分比」）決定用哪個 parser 解析整份文字——
   本節的 `X min @ Y% (Zw)` 正則比 §3.2 的 `X min @ Yw` 嚴格（多了 `%` 跟
   括號），兩者不會互相誤判。
3. 如果第一個看起來像內容的行不符合前面已知格式，最後再試一次 §3.6 格式
   的一般行寫法（`X min/sec @ Yw`，含 §3.2 沒有的秒數單位）——涵蓋「整段
   複製但剛好沒有總時長行也沒有重複組」的情況。

五種格式的行形狀差異夠大，不會互相誤判；一份沒有總時長行、沒有 `NX (...)`
重複組、也沒有 `%`／括號的純 `X min @ Yw` 貼上內容，仍然照舊路由到 §3.2 的
`parsePasteText()`，不影響既有行為。

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
  - 畫面大字顯示倒數數字
  - **顯示下一組預告（新增）**：`countdownAlerts.js` 的
    `computeUpcomingIntervalPreview()` 算出 `currentIntervalIndex + 1`（現在
    這組還沒結束，下一組還沒真的開始）長什麼樣子，用口語化的「X 分鐘」／
    「X 秒」／「X 分 Y 秒」時長格式（`formatMinuteSecondLabel()`）：
    - 一般組別：`下一組：5 分鐘 · 75% FTP`
    - 起訖 %FTP 不同（漸變，例如 warmup/ramp/cooldown）：
      `下一組：5 分鐘 · 40% → 105% FTP`（不是只顯示起始值）
    - freeride：不顯示百分比，`下一組：自由騎乘 · 5 分鐘`
    - **目前這組已經是最後一組**（沒有下一組）：顯示「即將完成」，不能顯示
      不存在的「下一組」
  - 觸發語音（`SpeechSynthesis` API），把上面同一份預告資訊唸出來，例如
    「10 秒後進入下一組，75% FTP，持續 5 分鐘」；漸變唸成「A% 到 B% FTP」，
    freeride 唸「自由騎乘」，最後一組唸「10 秒後即將完成」。
- 切組瞬間（剩餘時間從 1 變 0）：
  - 大字顯示下一組資訊（時間／%FTP／瓦數）——這個既有格式（mm:ss，
    `formatNextIntervalText()`）沒有變動，跟倒數 10 秒預告是兩個獨立的
    文字格式（後者更口語化，適合唸出來；前者資訊更精確，適合切組當下閱讀）。

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
- **四個平行的課表載入方式**：FTP 設定列下方是四張視覺上完全對等的卡片
  （同一套 `.upload-source-card` 樣式：一致的標題字級／字重、一致的提示文字
  字級、一致的卡片邊框與間距），依序排列，讓使用者一眼看出這是四個平行選項，
  不是「主功能＋附加說明」的層級關係（不再用「或」分隔線這種暗示 A/B 選一
  的視覺語言）：
  1. **貼課表網址**：單行輸入框＋「載入」按鈕，貼上完整網址後判斷網域——
     `app.trainerday.com` 呼叫 `/api/trainerday-workout` 抓回來用
     `parseTrainerDayWorkoutStructureText()` 解析（見 §3.3／§3.7）、
     `whatsonzwift.com`（含 `www`）呼叫 `/api/whatsonzwift-workout` 抓回來用
     `parseWhatsOnZwiftText()` 解析（見 §3.3／§3.4）；含 `http://` 的網址會
     自動升級成 `https://`；網址格式錯誤或網域不支援，直接在畫面顯示錯誤，
     不會呼叫任何 proxy。卡片下方提示文字：「目前支援 TrainerDay、Zwift
     （whatsonzwift.com）」。
  2. **貼上課表文字內容**：多行 textarea＋「載入」按鈕，只處理文字，**不**
     判斷輸入是不是網址（網址判斷完全交給上面第 1 張卡片，兩者的邏輯分開，
     不混在一起）。送出後用 `parseAutoDetectedPasteText()` 自動判斷是
     §3.2／§3.4／§3.5／§3.6／§3.7 五種文字格式中的哪一種再分流解析（§3.6 的
     TrainerDay 完整複製格式優先判斷，見該節說明）。卡片標題下方有提示
     文字，說明支援 TrainerDay、WhatsOnZwift 格式，也可以改用第 1 張卡片
     直接貼網址，網址自動抓取失敗時會提示改回這裡手動貼上。
  3. **上傳 ZWO 檔案**：維持既有的拖曳／點擊上傳樣式（`.upload-dropzone`），
     選一份 `.zwo` 課表檔案，讀出內容後用 `parseZwoXml()` 解析。檔案輸入框
     故意不設 `accept` 屬性（regression：iOS Safari／Chrome 對雲端硬碟裡的
     檔案常常判斷不出 `.zwo` 這種非標準副檔名的 MIME type，只要 `accept`
     限制了副檔名或 MIME type，iOS 的檔案選擇器就會把整份清單都鎖成灰色、
     不限 `.zwo`、所有檔案都選不到）——格式驗證改成選檔之後在
     `playerApp.js` 的 `handleFileSelected()` 用 JavaScript 檢查：先看副檔名
     是不是 `.zwo`（不分大小寫），不是就直接顯示「這不是合法的 zwo
     檔案」，不會浪費一次讀檔／解析；副檔名對的話才交給 `parseZwoXml()`
     檢查實際內容是否合法（副檔名檢查不能取代內容驗證，兩者都要）。
  4. **使用 intervals 行事曆課表**：單行輸入框（事件 ID）＋「載入」按鈕，
     透過 `/api/intervals-zwo` 這個 Vercel Serverless Function 代理下載
     `.zwo` 內容，用 `parseZwoXml()` 解析（只有部署在有 Serverless Function
     的平台才會動）。卡片下方是「點此查詢最近一筆行事曆訓練代碼」連結，用
     新分頁打開 `/api/intervals-events` 查詢工具（見 §5.1.1），不會離開目前
     畫面。
- 解析失敗（檔案、intervals.icu 回傳的內容、貼上的純文字、或任一網址抓取都
  一樣）要有清楚的錯誤訊息，並留在首頁讓使用者重試，不能整個畫面壞掉；網址
  抓取失敗時要額外提示可以改用「貼上課表文字內容」（第 2 張卡片）。

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
- **建議踏頻（新增）**：目前這組的資料如果有 `cadence`（例如 §3.7
  TrainerDay Workout structure 格式解析出來的「N rpm」），瓦數旁邊顯示一個
  比瓦數字級小一截的踏頻徽章（`182 W 90 rpm` 這種排法，`.target-cadence`，
  跟瓦數同一行、視覺上明顯是輔助資訊不是主要數字）；這組沒有踏頻資料就不
  顯示（不是顯示一個誤導的「0 rpm」）。這是課表資料本身的屬性，直接讀目前
  這組 interval 的 `cadence` 欄位，跟 FTP／使用者微調的瓦數計算無關。
- 控制按鈕：播放/暫停（圓形三角形/正方形）、跳組、重做本組、提早結束
- ± 微調按鈕（點一下調整 1%，即時反映在 target watt）
- 畫面常亮：使用 WakeLock API 避免螬幕在騎車中自動休眠
- 課表完成後的引導流程見 4.5 節

### 5.3 團體訓練排程（新增）

上傳畫面「設定 FTP」區塊下方多一個選填的「設定開始時間」欄位，讓使用者可以
排定一個未來時間，時間到自動開始播放課表（適合團體訓練，大家約好同一個
時間一起開始）。

- **輸入格式**：文字輸入框（不是瀏覽器原生的日期選擇器），格式是「年月日
  連續 8 位數字 + 空格 + 24 小時制時間」，例如 `20260724 20:00`；輸入框旁有
  提示文字說明這個格式範例。`parseScheduledStartTimeInput()`
  （`src/ui/scheduledStartTimeParser.js`）驗證格式，用
  `new Date(year, monthIndex, day, hour, minute)` 建構子（吃使用者裝置本地
  時區的年月日時分，不是 UTC）產生 `Date`，並且會：
  - 檢查月份 1–12、時 00–23、分 00–59 的範圍
  - 額外把建構出來的 `Date` 的 getter 值跟輸入比對一次，抓出像 2 月 30 日
    這種「格式合法但日期不存在」、`Date` 建構子會默默進位到 3 月的情況
  - 格式或日期不合法時丟出清楚的錯誤訊息（沿用上傳卡片共用的
    `.upload-error` 錯誤顯示區），不會靜默失敗
- **選填、不影響既有行為**：不設定的話，維持「輸入課表後手動按開始」的原本
  流程。欄位本身固定顯示在上傳畫面（FTP 區塊下方），但實際生效的時間點是
  「使用者接下來成功載入任何一份課表的當下」（不限是設定開始時間欄位之前
  或之後載入的課表）——`playerApp.js` 用一個 `pendingScheduledStartTimestamp`
  暫存已設定但還沒套用到課表的開始時間，`loadWorkout()` 解析成功那一刻檢查
  這個暫存值決定要不要進排程流程。
- **設定當下解鎖自動播放權限**：使用者按下「設定」按鈕的當下（同一個 click
  事件的呼叫堆疊內，中間不能有任何 `async`/`await`/`setTimeout`），
  `unlockAudioAndSpeechForAutoplay()`（`src/ui/countdownAlerts.js`）會建立／
  恢復一個 `AudioContext` 並播放一段音量 0 的靜音音效、加上唸一句音量 0 的
  `SpeechSynthesisUtterance`——目的是利用瀏覽器「使用者互動」這個當下解鎖
  之後自動播放的權限，這樣真正自動觸發開始（沒有使用者當下點擊）時，倒數
  提示音效／語音才不會被瀏覽器擋掉。
- **開始時間已過去 → 立刻播放**：`armSchedule()` 比對設定的時間戳跟
  `Date.now()`，已經過去就直接 `switchToPlayerScreen()` + `client.play()`，
  不經過等待畫面。
- **開始時間還沒到 → 等待畫面**：`waitingView.js` 顯示課表名稱／總時長／
  組數，加上大字倒數「距離開始還有 X 小時 Y 分」（不足一分鐘顯示「距離開始
  還有不到 1 分鐘」），由 `scheduledStartRuntime.js` 的
  `createScheduledStartRuntime()` 每秒重新計算一次「還剩多少毫秒」（不是用
  累計 tick 次數推算，背景分頁被降頻、某次 tick 晚到時，下一次 tick 仍然會
  自我修正成正確的剩餘時間，跟 `timerEngine.js` 對抗計時漂移的做法一致），
  時間到時停止倒數並自動呼叫 `client.play()` 進入正常執行頁（完整的計時／
  切組／倒數提示邏輯都適用，跟手動點開始沒有差別）。等待畫面上有「取消
  排程」按鈕，可以中止排程回到上傳畫面。
- **限制提醒**：等待畫面上有明顯的提醒文字，說明如果分頁被完全關閉、或裝置
  長時間背景休眠導致系統回收資源，「自動開始」可能會失效，建議使用者在
  排定時間前至少重新打開一次分頁確認狀態。
- **`localStorage` 持久化**：排程（課表 JSON ＋開始時間戳）存進
  `scheduleStore.js`（key `scheduled_workout`），App 啟動時
  (`initPlayerApp()` 結尾) 讀取一次，有排程就照前面「已過去／還沒到」的規則
  重新進入對應畫面——使用者切分頁、背景、短暫關閉瀏覽器再打開，排程還在。
  排程被消費（自動開始觸發）或使用者主動取消時會清掉這筆記錄，不會有已經
  失效的排程殘留。這個持久化方式**無法保證**分頁被完全關閉或裝置長時間
  背景休眠後還能自動觸發——這正是上面「限制提醒」要明確告知使用者的原因。

---

## 6. 資料儲存

- FTP、體重：`localStorage`，key 建議 `user_ftp`、`user_weight`，App 啟動時讀取，沒有就跳出設定畫面
- 團體訓練排程（課表＋開始時間）：`localStorage` key `scheduled_workout`，見 5.3 節
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
