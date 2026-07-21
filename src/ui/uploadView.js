/**
 * 上傳畫面：貼上 intervals.icu 課表網址／ID（主要情境），或選一份本機 .zwo
 * 課表檔案。純 DOM 渲染邏輯，不碰 parser／計時引擎／fetch —— 收到輸入就透過
 * 對應的 handler 丟給呼叫端處理：
 *   onFileSelected(file)          選了本機 .zwo 檔案
 *   onIntervalsIcuSubmit(rawText) 送出 intervals.icu 網址／ID 表單
 *   onPasteTextSubmit(rawText)    送出貼上的純文字課表（例如 TrainerDay 公開頁面複製的格式）
 *   onTrainerDayUrlSubmit(url)    「貼上課表文字」欄位偵測到輸入是網址（http 開頭）時改送這個
 *   onFtpChange(ftp)              FTP 欄位改成一個合法的正數（呼叫端負責存 localStorage）
 *
 * @param {HTMLElement} rootEl
 * @param {{onFileSelected: (file: File) => void, onIntervalsIcuSubmit: (rawText: string) => void, onPasteTextSubmit: (rawText: string) => void, onTrainerDayUrlSubmit: (url: string) => void, onFtpChange: (ftp: number) => void}} handlers
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

      <form class="upload-intervals-form">
        <label class="upload-intervals-label" for="upload-intervals-input">從 intervals.icu 載入</label>
        <div class="upload-intervals-row">
          <input
            type="text"
            id="upload-intervals-input"
            class="upload-intervals-input"
            placeholder="貼上課表網址，或直接輸入 event ID"
            autocomplete="off"
          />
          <button type="submit" class="upload-intervals-submit">載入</button>
        </div>
        <a
          class="upload-intervals-lookup-link"
          href="/api/intervals-events"
          target="_blank"
          rel="noopener noreferrer"
        >點此查詢最近一筆行事曆訓練代碼</a>
      </form>

      <div class="upload-divider"><span>或</span></div>

      <h2 class="upload-title">上傳課表</h2>
      <p class="upload-hint">選擇一份 .zwo 課表檔案（Zwift workout file）開始訓練</p>
      <label class="upload-dropzone">
        <input type="file" accept=".zwo,application/xml,text/xml" class="upload-input" />
        <span>點一下選擇 .zwo 檔案</span>
      </label>

      <div class="upload-divider"><span>或</span></div>

      <form class="upload-paste-form">
        <label class="upload-paste-label" for="upload-paste-textarea">貼上課表文字或網址</label>
        <p class="upload-hint">
          從公開課表頁面複製的純文字（例如「10 min @ 53w」每行一組），或直接貼上
          TrainerDay 課表網址（例如 app.trainerday.com/workouts/...）——不需要帳號或檔案
        </p>
        <textarea
          id="upload-paste-textarea"
          class="upload-paste-textarea"
          rows="6"
          placeholder="10 min @ 53w&#10;20 min @ 68w&#10;15 min @ 85w&#10;&#10;或貼上 https://app.trainerday.com/workouts/..."
        ></textarea>
        <button type="submit" class="upload-paste-submit">載入</button>
      </form>

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
  const pasteSubmitBtn = rootEl.querySelector('.upload-paste-submit');

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

  pasteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = pasteTextarea.value;
    const trimmed = raw.trim();
    if (!trimmed) return;

    // 網址格式（http 開頭）交給 TrainerDay 抓取 proxy；其他都當成直接貼上的
    // 課表文字，兩者共用同一個輸入框（規格要求）。
    if (/^https?:\/\//i.test(trimmed)) {
      handlers.onTrainerDayUrlSubmit(trimmed);
    } else {
      handlers.onPasteTextSubmit(raw);
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
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
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
    setPasteLoading(isLoading) {
      pasteSubmitBtn.disabled = isLoading;
      pasteSubmitBtn.textContent = isLoading ? '載入中…' : '載入';
      pasteTextarea.disabled = isLoading;
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
