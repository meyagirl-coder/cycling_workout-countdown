/**
 * 上傳畫面：四個平行的課表載入方式——貼課表網址／貼上課表文字內容／上傳
 * .zwo 檔案／intervals.icu 行事曆課表，畫面上用同樣的卡片樣式並排，讓使用者
 * 一眼就能看出這是四個平行選項，不是主功能＋附加說明的層級關係。純 DOM
 * 渲染邏輯，不碰 parser／計時引擎／fetch —— 收到輸入就透過對應的 handler
 * 丟給呼叫端處理：
 *   onFileSelected(file)          選了本機 .zwo 檔案——檔案輸入框故意不設
 *                                 `accept` 屬性（見下方），副檔名／內容格式
 *                                 檢查交給呼叫端（playerApp.js）處理
 *   onIntervalsIcuSubmit(rawText) 送出 intervals.icu event ID（或網址）
 *   onPasteTextSubmit(rawText)    送出貼上的純文字課表——TrainerDay／
 *                                 WhatsOnZwift／「時長 百分比」等格式都送
 *                                 這裡，由呼叫端自動判斷是哪一種再解析，這
 *                                 裡不做網址判斷（見「貼課表網址」欄位）
 *   onTrainerDayUrlSubmit(url)    「貼課表網址」欄位偵測到是 TrainerDay 網址
 *   onWhatsOnZwiftUrlSubmit(url)  「貼課表網址」欄位偵測到是 WhatsOnZwift 網址
 *   onFtpChange(ftp)              FTP 欄位改成一個合法的正數（呼叫端負責存 localStorage）
 *
 * 「貼課表網址」曾經同時支援 TrainerDay／WhatsOnZwift，兩邊都因為抓不到
 * （WhatsOnZwift 當時回傳 HTTP 403，判斷是反爬蟲防護；TrainerDay 當時的
 * 擷取邏輯鎖定錯的頁面格式）而整個移除過一次。後來重新加回 TrainerDay，
 * 對接新確認的「Workout structure」格式 parser，這次再加回 WhatsOnZwift——
 * 兩邊的 proxy／擷取邏輯都在，能不能真的抓到由使用者在 Vercel 正式環境
 * 實際測試決定：WhatsOnZwift 之前遇到的是網站本身的反爬蟲防護，不是「哪個
 * 環境呼叫」的問題，如果還是 403，屬於預期內的結果，不是程式碼的問題。
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
          <p class="upload-source-hint">
            支援 TrainerDay、WhatsOnZwift 格式：請到課表網站的頁面上複製課表文字，貼在下方即可；也可以改用上方的「貼課表網址」直接貼網址，如果自動抓取失敗會提示改回這裡手動貼上。
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

  // 「貼上課表文字內容」只處理文字，不做網址判斷——網址判斷完全交給
  // 「貼課表網址」那個獨立欄位，兩邊的邏輯不混在一起。
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
      showErrorMessage('目前只支援 TrainerDay 或 WhatsOnZwift（whatsonzwift.com）的課表網址，其他網站請改用「貼上課表文字內容」。');
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
