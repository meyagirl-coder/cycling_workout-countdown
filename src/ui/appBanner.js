/**
 * App 品牌識別橫幅（規格 §5.1）：整個 App 最上方的標題區，不屬於「上傳畫面」
 * 自己，而是 App 層級的頭部——只是目前只在首頁顯示，進到執行頁後由呼叫端
 * hide() 掉，把畫面空間讓給倒數計時。
 *
 * @param {HTMLElement} rootEl
 */
export function createAppBanner(rootEl) {
  rootEl.innerHTML = `
    <header class="app-banner">
      <h1 class="app-banner-title">自行車訓練課表播放器</h1>
      <p class="app-banner-subtitle">上傳課表檔案或連結 intervals.icu，開始你的結構化訓練</p>
    </header>
  `;

  const bannerEl = rootEl.querySelector('.app-banner');

  return {
    show() {
      bannerEl.classList.remove('hidden');
    },
    hide() {
      bannerEl.classList.add('hidden');
    },
  };
}
