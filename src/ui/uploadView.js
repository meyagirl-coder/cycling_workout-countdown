/**
 * 上傳畫面：選一份 .zwo 課表檔案，讀出內容後交給呼叫端解析。純 DOM 渲染邏輯，
 * 不碰 parser／計時引擎 —— 收到檔案就透過 onFileSelected(file) 丟出去。
 *
 * @param {HTMLElement} rootEl
 * @param {{onFileSelected: (file: File) => void}} handlers
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
      <p class="upload-error hidden"></p>
    </div>
  `;

  const input = rootEl.querySelector('.upload-input');
  const errorEl = rootEl.querySelector('.upload-error');

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = ''; // allow re-selecting the same file again after an error
    if (file) handlers.onFileSelected(file);
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
  };
}
