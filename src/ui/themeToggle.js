/**
 * 主題切換（dark／light／auto）。跟其他 UI 元件（`createXView(rootEl,
 * handlers)`）不太一樣：這個功能是完全獨立、跨畫面的全域設定（不屬於上傳
 * 畫面／等待畫面／執行頁任何一個，三個畫面都要生效），套用主題本身也是
 * document 層級的副作用（改 `<html>` 的 `data-theme` 屬性），不是這個元件
 * 自己的 DOM 子樹能決定的——所以這裡直接內建「套用＋存檔」的邏輯，不透過
 * `handlers` 回呼交給呼叫端處理，呼叫端只需要掛載一次、不需要接手任何狀態。
 *
 * auto 模式完全交給 CSS 的 `prefers-color-scheme` media query 判斷（見
 * player.css），這裡的 JS 只負責：
 *   1. 把使用者的選擇（或開機時讀到的已存選擇）寫進 `<html data-theme="...">`
 *      ——dark／light 是「強制套用」，auto 是「交給 CSS media query 決定」
 *      （拿掉強制值，讓 CSS 的 `:not([data-theme="dark"]):not([data-theme=
 *      "light"])` 規則生效）。
 *   2. 存進 localStorage，下次開啟記得上次選的模式。
 * 系統設定在使用中途改變時（例如手機系統排程切換深色模式），完全是瀏覽器
 * 重新計算 `prefers-color-scheme` media query 的結果、CSS 即時重新套用，不
 * 需要 JS 監聽 `matchMedia` 變化事件、也不需要重新整理頁面。
 */
import { loadTheme, saveTheme, VALID_THEMES } from './themeStore.js';

const THEME_LABELS = { dark: '深色', light: '淺色', auto: '自動' };

/**
 * 把主題套用到 `<html>` 的 `data-theme` 屬性——單獨拆出來，讓開機時的 FOUC
 * 防止腳本（index.html 裡的內嵌 script）跟這裡的 UI 元件可以共用同一份邏輯
 * 說明，即使兩邊程式碼因為載入時機不同沒辦法直接 import 同一份函式。
 *
 * @param {'dark'|'light'|'auto'} theme
 * @param {Document} [doc]
 */
export function applyTheme(theme, doc = document) {
  doc.documentElement.setAttribute('data-theme', theme);
}

/**
 * @param {HTMLElement} rootEl
 * @param {{ doc?: Document, storage?: Storage }} [options] - 測試用的依賴注入，
 *   預設用真正的 `document`／`window.localStorage`
 * @returns {{ getActiveTheme: () => string }}
 */
export function createThemeToggle(rootEl, options = {}) {
  const doc = options.doc ?? document;
  const storage = options.storage ?? window.localStorage;

  rootEl.innerHTML = `
    <div class="theme-toggle" role="group" aria-label="主題切換">
      ${VALID_THEMES.map(
        (theme) => `<button type="button" class="theme-toggle-btn" data-theme-option="${theme}">${THEME_LABELS[theme]}</button>`
      ).join('')}
    </div>
  `;

  const buttons = Array.from(rootEl.querySelectorAll('.theme-toggle-btn'));

  function setActiveButton(theme) {
    buttons.forEach((btn) => {
      const isActive = btn.dataset.themeOption === theme;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  function selectTheme(theme) {
    saveTheme(theme, storage);
    applyTheme(theme, doc);
    setActiveButton(theme);
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => selectTheme(btn.dataset.themeOption));
  });

  // 開機時套用已存的選擇（或預設值 'auto'）——確保就算 index.html 裡的 FOUC
  // 防止腳本因為某些原因沒跑到，這裡也會補上正確的屬性。
  const initialTheme = loadTheme(storage);
  applyTheme(initialTheme, doc);
  setActiveButton(initialTheme);

  return { getActiveTheme: () => loadTheme(storage) };
}
