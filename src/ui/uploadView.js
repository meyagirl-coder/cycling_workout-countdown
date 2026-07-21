/**
 * 上傳畫面：四個平行的課表載入方式——貼課表網址／貼上課表文字內容／上傳
 * .zwo 檔案／intervals.icu 行事曆課表，畫面上用同樣的卡片樣式並排，讓使用者
 * 一眼就能看出這是四個平行選項，不是主功能＋附加說明的層級關係。純 DOM
 * 渲染邏輯，不碰 parser／計時引擎／fetch —— 收到輸入就透過對應的 handler
 * 丟給呼叫端處理：
 *   onFileSelected(file)          選了本機 .zwo 檔案
 *   onIntervalsIcuSubmit(rawText) 送出 intervals.icu event ID（或網址）
 *   onPasteTextSubmit(rawText)    送出貼上的純文字課表——TrainerDay／
 *                                 WhatsOnZwift／「時長 百分比」三種格式都
 *                                 送這裡，由呼叫端自動判斷是哪一種再解析，
 *                                 這裡不做網址判斷（見「貼課表網址」欄位）
 *   onTrainerDayUrlSubmit(url)    「貼課表網址」欄位偵測到是 TrainerDay 網址
 *   onWhatsOnZwiftUrlSubmit(url)  「貼課表網址」欄位偵測到是 WhatsOnZwift 網址
 *   onFtpChange(ftp)              FTP 欄位改成一個合法的正數（呼叫端負責存 localStorage）
 *
 * @param {HTMLElement} rootEl
 * @param {{onFileSelected: (file: File) => void, onIntervalsIcuSubmit: (rawText: string) => void, onPasteTextSubmit: (rawText: string) => void, onTrainerDayUrlSubmit: (url: string) => void, onWhatsOnZwiftUrlSubmit: (url: string) => void, onFtpChange: (ftp: number) => void}} handlers
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
          <h2 class="upload-source-title">貼課表網址</h2>
          <form class="upload-url-form">
            <div class="upload-url-row">
              <input
                type="text"
                id="upload-url-input"
                class="upload-url-input"
                placeholder="貼上課表網址"
                autocomplete="off"
              />
              <button type="submit" class="upload-url-submit">載入</button>
            </div>
          </form>
          <p class="upload-source-hint">目前支援 TrainerDay、Zwift（whatsonzwift.com）</p>
        </div>

        <div class="upload-source-card">
          <h2 class="upload-source-title">貼上課表文字內容</h2>
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
          <label class="upload-dropzone">
            <input type="file" accept=".zwo,application/xml,text/xml" class="upload-input" />
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
  const urlForm = rootEl.querySelector('.upload-url-form');
  const urlInput = rootEl.querySelector('.upload-url-input');
  const urlSubmitBtn = rootEl.querySelector('.upload-url-submit');

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

  // 「貼上課表文字內容」只處理文字，不判斷是不是網址——網址判斷完全交給
  // 「貼課表網址」那個獨立欄位，兩邊的邏輯不混在一起（規格要求）。
  pasteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = pasteTextarea.value;
    if (raw.trim()) handlers.onPasteTextSubmit(raw);
  });

  const TRAINERDAY_HOSTS = new Set(['app.trainerday.com']);
  const WHATSONZWIFT_HOSTS = new Set(['whatsonzwift.com', 'www.whatsonzwift.com']);

  urlForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = urlInput.value.trim();
    if (!value) return;

    let parsedUrl;
    try {
      parsedUrl = new URL(value);
    } catch {
      showErrorMessage('網址格式錯誤，請確認貼上的是完整的課表網址。');
      return;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      showErrorMessage('網址格式錯誤，請確認貼上的是完整的課表網址。');
      return;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (TRAINERDAY_HOSTS.has(hostname)) {
      handlers.onTrainerDayUrlSubmit(value);
    } else if (WHATSONZWIFT_HOSTS.has(hostname)) {
      handlers.onWhatsOnZwiftUrlSubmit(value);
    } else {
      showErrorMessage('目前只支援 TrainerDay 或 WhatsOnZwift（whatsonzwift.com）的課表網址。');
    }
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
    setUrlLoading(isLoading) {
      urlSubmitBtn.disabled = isLoading;
      urlSubmitBtn.textContent = isLoading ? '載入中…' : '載入';
      urlInput.disabled = isLoading;
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
