import { describe, expect, it } from 'vitest';
import { createAppBanner } from '../src/ui/appBanner.js';

describe('createAppBanner', () => {
  it('renders the app title and subtitle', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    createAppBanner(root);

    expect(root.querySelector('.app-banner-title').textContent).toBe('自行車訓練課表播放器');
    expect(root.querySelector('.app-banner-subtitle').textContent).toBe(
      '支援貼上課表網址、貼上課表文字、上傳 ZWO 檔案，或連結 intervals.icu，開始你的結構化訓練'
    );
    expect(root.querySelector('.app-banner').classList.contains('hidden')).toBe(false);
  });

  it('show() and hide() toggle the hidden class', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const banner = createAppBanner(root);
    const bannerEl = root.querySelector('.app-banner');

    banner.hide();
    expect(bannerEl.classList.contains('hidden')).toBe(true);

    banner.show();
    expect(bannerEl.classList.contains('hidden')).toBe(false);
  });
});
