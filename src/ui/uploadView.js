/**
 * 上傳畫面：選一份 .zwo 課表檔案，或貼上 intervals.icu 課表網址／ID。純 DOM
 * 渲染邏輯，不碰 parser／計時引擎／fetch —— 收到輸入就透過對應的 handler
 * 丟給呼叫端處理：
 *   onFileSelected(file)          選了本機 .zwo 檔案
 *   onIntervalsIcuSubmit(rawText) 送出 intervals.icu 網址／ID 表單
 *
 * @param {HTMLElement} rootEl
 * @param {{onFileSelected: (file: File) => void, onIntervalsIcuSubmit: (rawText: string) => void}} handlers
 */
export function createUploadView(rootEl, handlers) {
  rootEl.innerHTML = `
    <div class="upload-screen">
      <h1 class="upload-title">上傳課表</h1>
      <p class="upload-hint">選擇一份 .zwo 課表檔案（Zwift workout file）開始訓練</p>
      <label class="upload-dropzone">
        <input type="file" accept=".zwo,application/xml,text/xml" class="upload-input" />
        <span>點一下選擇 .zwo 檔案</span>
      </label>

      <div class="upload-divider"><span>或</span></div>

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
      </form>

      <p class="upload-error hidden"></p>
    </div>
  `;

  const fileInput = rootEl.querySelector('.upload-input');
  const errorEl = rootEl.querySelector('.upload-error');
  const intervalsForm = rootEl.querySelector('.upload-intervals-form');
  const intervalsInput = rootEl.querySelector('.upload-intervals-input');
  const intervalsSubmitBtn = rootEl.querySelector('.upload-intervals-submit');

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
  };
}
