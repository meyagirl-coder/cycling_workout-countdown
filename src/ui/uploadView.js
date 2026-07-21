/**
 * 上傳畫面：三個平行的課表載入方式——貼上課表文字內容／上傳 .zwo 檔案／
 * intervals.icu 行事曆課表，畫面上用同樣的卡片樣式並排，讓使用者一眼就能
 * 看出這是三個平行選項，不是主功能＋附加說明的層級關係。純 DOM 渲染邏輯，
 * 不碰 parser／計時引擎／fetch —— 收到輸入就透過對應的 handler 丟給呼叫端
 * 處理：
 *   onFileSelected(file)          選了本機 .zwo 檔案——檔案輸入框故意不設
 *                                 `accept` 屬性（見下方），副檔名／內容格式
 *                                 檢查交給呼叫端（playerApp.js）處理
 *   onIntervalsIcuSubmit(rawText) 送出 intervals.icu event ID（或網址）
 *   onPasteTextSubmit(rawText)    送出貼上的純文字課表——TrainerDay／
 *                                 WhatsOnZwift／「時長 百分比」三種格式都
 *                                 送這裡，由呼叫端自動判斷是哪一種再解析
 *   onFtpChange(ftp)              FTP 欄位改成一個合法的正數（呼叫端負責存 localStorage）
 *
 * 曾經有「貼課表網址」自動抓取的欄位（呼叫 proxy 下載 TrainerDay／
 * WhatsOnZwift 頁面），但兩邊分別遇到反爬蟲防護（HTTP 403）跟抓不到動態
 * 渲染內容的問題，技術上走不通，已經移除；改成在這裡的卡片標題下方直接
 * 提示使用者改用「貼上課表文字內容」。
 *
 * @param {HTMLElement} rootEl
 * @param {{onFileSelected: (file: File) => void, onIntervalsIcuSubmit: (rawText: string) => void, onPasteTextSubmit: (rawText: string) => void, onFtpChange: (ftp: number) => void}} handlers
 */
export function createUploadView(rootEl, handlers) {
  rootEl.innerHTML = `
    <div class="upload-screen">
      <div class="upload-ftp-row">
        <label class="upload-ftp-label" for="upload-ftp-input">你的 FTP</label>
        <div class="upload-ftp-input-wrap">
          <input type="number" id="upload-ftp-input" class="upload-ftp-input" min="1" step="1" inputmode="numeric" />
          <span class="upload-ftp-unit">W</span>
        </div>
      </div>
      <p class="upload-ftp-hint">之後可以隨時回來這裡修改，瓦數會立即依新的 FTP 重新計算</p>

      <div class="upload-source-list">
        <div class="upload-source-card">
          <h2 class="upload-source-title">貼上課表文字內容</h2>
          <p class="upload-source-hint">
            支援 TrainerDay、WhatsOnZwift 格式：請到課表網站的頁面上複製課表文字，貼在下方即可。目前不支援直接貼課表網址自動抓取。
          </p>
          <form class="upload-paste-form">
            <textarea
              id="upload-paste-textarea"
              class="upload-paste-textarea"
              rows="6"
              placeholder="10m 53%&#10;20m 68%&#10;&#10;3x&#10;1m 150%&#10;1m 50%"
            ></textarea>
            <button type="submit" class="upload-paste-submit">載入</button>
          </form>
        </div>

        <div class="upload-source-card">
          <h2 class="upload-source-title">上傳 ZWO 檔案</h2>
          <!--
            故意不設 accept 屬性：iOS Safari/Chrome 對雲端硬碟裡的檔案常常判斷
            不出 .zwo 這種非標準副檔名的 MIME type，只要 accept 限制了副檔名或
            MIME type，iOS 的檔案選擇器就會把整份清單都鎖成灰色、完全選不到
            任何檔案（不限 .zwo，所有檔案都選不了）。移除限制讓使用者在檔案
            選擇畫面一定看得到、選得到檔案，格式是否為合法的 .zwo 交給選檔後
            的 JavaScript（playerApp.js 的 handleFileSelected）檢查。
          -->
          <label class="upload-dropzone">
            <input type="file" class="upload-input" />
            <span>點一下選擇 .zwo 檔案</span>
          </label>
        </div>

        <div class="upload-source-card">
          <h2 class="upload-source-title">使用 intervals 行事曆課表</h2>
          <form class="upload-intervals-form">
            <div class="upload-intervals-row">
              <input
                type="text"
                id="upload-intervals-input"
                class="upload-intervals-input"
                placeholder="輸入 event ID"
                autocomplete="off"
              />
              <button type="submit" class="upload-intervals-submit">載入</button>
            </div>
          </form>
          <a
            class="upload-intervals-lookup-link"
            href="/api/intervals-events"
            target="_blank"
            rel="noopener noreferrer"
          >點此查詢最近一筆行事曆訓練代碼</a>
        </div>
      </div>

      <p class="upload-error hidden"></p>
    </div>
  `;

  const fileInput = rootEl.querySelector('.upload-input');
  const errorEl = rootEl.querySelector('.upload-error');
  const intervalsForm = rootEl.querySelector('.upload-intervals-form');
  const intervalsInput = rootEl.querySelector('.upload-intervals-input');
  const intervalsSubmitBtn = rootEl.querySelector('.upload-intervals-submit');
  const lookupLink = rootEl.querySelector('.upload-intervals-lookup-link');
  const ftpInput = rootEl.querySelector('.upload-ftp-input');
  const pasteForm = rootEl.querySelector('.upload-paste-form');
  const pasteTextarea = rootEl.querySelector('.upload-paste-textarea');

  function showErrorMessage(message) {
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  // 「今天」要用使用者瀏覽器的本地日期，不是 Vercel 伺服器的時區（見
  // api/intervals-events.js 的說明）——伺服器多半是 UTC，UTC+8 的使用者在
  // 當地已經跨到隔天、UTC 卻還沒跨日的那幾小時內，兩者會差一天。
  lookupLink.href = `/api/intervals-events?today=${getLocalDateString()}`;

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ''; // allow re-selecting the same file again after an error
    if (file) handlers.onFileSelected(file);
  });

  intervalsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = intervalsInput.value.trim();
    if (value) handlers.onIntervalsIcuSubmit(value);
  });

  // 「貼上課表文字內容」只處理文字，不做網址判斷——「貼課表網址」自動抓取
  // 因為反爬蟲防護／動態渲染內容抓不到而移除了，現在只剩這一種輸入方式。
  pasteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = pasteTextarea.value;
    if (raw.trim()) handlers.onPasteTextSubmit(raw);
  });

  // 即時反映：只要是合法的正數就馬上通知呼叫端（存 localStorage／更新執行頁瓦數），
  // 打字打到一半的空字串／0／負數先不通知，等使用者輸入出合法值再說。
  ftpInput.addEventListener('input', () => {
    const value = Number(ftpInput.value);
    if (Number.isFinite(value) && value > 0) handlers.onFtpChange(Math.round(value));
  });

  return {
    showError(message) {
      showErrorMessage(message);
    },
    clearError() {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
    },
    setIntervalsIcuLoading(isLoading) {
      intervalsSubmitBtn.disabled = isLoading;
      intervalsSubmitBtn.textContent = isLoading ? '載入中…' : '載入';
      intervalsInput.disabled = isLoading;
    },
    setFtpValue(ftp) {
      ftpInput.value = ftp;
    },
  };
}

/** 瀏覽器本地日期（YYYY-MM-DD），用 local getter 而不是 UTC getter，故意跟伺服器時區脫鉤 */
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
