import { describe, expect, it, vi } from 'vitest';
import { createUploadView } from '../src/ui/uploadView.js';

function selectFile(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function makeHandlers(overrides = {}) {
  return {
    onFileSelected: vi.fn(),
    onIntervalsIcuSubmit: vi.fn(),
    onPasteTextSubmit: vi.fn(),
    onFtpChange: vi.fn(),
    ...overrides,
  };
}

function setup(handlerOverrides = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  const handlers = makeHandlers(handlerOverrides);
  const view = createUploadView(root, handlers);
  return { root, handlers, view };
}

describe('createUploadView layout (three parallel source cards)', () => {
  it('renders exactly three source cards, in order: paste text, .zwo upload, intervals.icu', () => {
    const { root } = setup();
    const titles = Array.from(root.querySelectorAll('.upload-source-title')).map((el) => el.textContent);
    expect(titles).toEqual(['貼上課表文字內容', '上傳 ZWO 檔案', '使用 intervals 行事曆課表']);
  });

  it('gives every source card title the same font-size/weight via one shared class (visual consistency)', () => {
    const { root } = setup();
    const titles = root.querySelectorAll('.upload-source-title');
    expect(titles).toHaveLength(3);
    for (const title of titles) {
      expect(title.tagName).toBe('H2');
    }
  });

  it('wraps each of the three blocks in the same card class', () => {
    const { root } = setup();
    expect(root.querySelectorAll('.upload-source-card')).toHaveLength(3);
  });

  it('no longer renders a url input field or url form (removed: auto-fetch was not viable)', () => {
    const { root } = setup();
    expect(root.querySelector('.upload-url-form')).toBeNull();
    expect(root.querySelector('.upload-url-input')).toBeNull();
  });

  it('shows a hint on the paste-text card pointing users to it instead of url auto-fetch', () => {
    const { root } = setup();
    const pasteCard = root.querySelectorAll('.upload-source-card')[0];
    const hint = pasteCard.querySelector('.upload-source-hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('TrainerDay');
    expect(hint.textContent).toContain('WhatsOnZwift');
    expect(hint.textContent).toContain('不支援直接貼課表網址');
  });

  it('keeps a single shared error area below all three cards', () => {
    const { root } = setup();
    expect(root.querySelectorAll('.upload-error')).toHaveLength(1);
    expect(root.querySelector('.upload-error').classList.contains('hidden')).toBe(true);
  });
});

describe('createUploadView: FTP field', () => {
  it('renders an FTP input, settable via setFtpValue', () => {
    const { root, view } = setup();
    const ftpInput = root.querySelector('.upload-ftp-input');

    expect(ftpInput).not.toBeNull();
    expect(ftpInput.getAttribute('type')).toBe('number');

    view.setFtpValue(215);
    expect(ftpInput.value).toBe('215');
  });

  it('calls onFtpChange as soon as the FTP input holds a valid positive number', () => {
    const { root, handlers } = setup();
    const ftpInput = root.querySelector('.upload-ftp-input');

    ftpInput.value = '230';
    ftpInput.dispatchEvent(new Event('input'));

    expect(handlers.onFtpChange).toHaveBeenCalledTimes(1);
    expect(handlers.onFtpChange).toHaveBeenCalledWith(230);
  });

  it('does not call onFtpChange for a blank, zero, or negative FTP value (still mid-edit)', () => {
    const { root, handlers } = setup();
    const ftpInput = root.querySelector('.upload-ftp-input');

    for (const value of ['', '0', '-5']) {
      ftpInput.value = value;
      ftpInput.dispatchEvent(new Event('input'));
    }

    expect(handlers.onFtpChange).not.toHaveBeenCalled();
  });

  it('rounds a fractional FTP input before passing it to onFtpChange', () => {
    const { root, handlers } = setup();
    const ftpInput = root.querySelector('.upload-ftp-input');

    ftpInput.value = '199.6';
    ftpInput.dispatchEvent(new Event('input'));

    expect(handlers.onFtpChange).toHaveBeenCalledWith(200);
  });
});

describe('createUploadView: block 1 - 貼上課表文字內容 (text only, no url auto-fetch)', () => {
  it('shows a placeholder using %FTP-style examples, with no "w" watt-based example anywhere (avoids implying watts are required)', () => {
    const { root } = setup();
    const textarea = root.querySelector('.upload-paste-textarea');
    const placeholder = textarea.getAttribute('placeholder');

    expect(placeholder).toContain('%');
    expect(placeholder.toLowerCase()).not.toMatch(/\d+w\b/); // no "Nw" watt-style token anywhere
  });

  it('submits the raw (untrimmed-internally) textarea value to onPasteTextSubmit', () => {
    const { root, handlers } = setup();
    const textarea = root.querySelector('.upload-paste-textarea');
    const form = root.querySelector('.upload-paste-form');

    const pasted = '10 min @ 53w\n20 min @ 68w\n';
    textarea.value = pasted;
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onPasteTextSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onPasteTextSubmit).toHaveBeenCalledWith(pasted);
  });

  it('does not submit for a blank/whitespace-only textarea', () => {
    const { root, handlers } = setup();
    const textarea = root.querySelector('.upload-paste-textarea');
    const form = root.querySelector('.upload-paste-form');

    textarea.value = '   \n  ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onPasteTextSubmit).not.toHaveBeenCalled();
  });

  it('does not do any url detection on the pasted text - a url-shaped value is just submitted as-is', () => {
    const { root, handlers } = setup();
    const textarea = root.querySelector('.upload-paste-textarea');
    const form = root.querySelector('.upload-paste-form');

    textarea.value = 'https://app.trainerday.com/workouts/20260714-ramp-up-5';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onPasteTextSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onPasteTextSubmit).toHaveBeenCalledWith('https://app.trainerday.com/workouts/20260714-ramp-up-5');
  });
});

describe('createUploadView: block 2 - 上傳 ZWO 檔案', () => {
  it('renders the dropzone with the .zwo file input', () => {
    const { root } = setup();
    expect(root.querySelector('.upload-dropzone')).not.toBeNull();
    expect(root.querySelector('.upload-input').getAttribute('accept')).toContain('.zwo');
  });

  it('calls onFileSelected with the chosen file and resets the input', () => {
    const { root, handlers } = setup();
    const file = new File(['<workout_file></workout_file>'], 'my-workout.zwo', { type: 'application/xml' });
    const input = root.querySelector('.upload-input');
    selectFile(input, file);

    expect(handlers.onFileSelected).toHaveBeenCalledTimes(1);
    expect(handlers.onFileSelected).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('does not call onFileSelected when the change event fires with no file', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-input');
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(handlers.onFileSelected).not.toHaveBeenCalled();
  });
});

describe('createUploadView: block 3 - 使用 intervals 行事曆課表', () => {
  it('submits the trimmed event ID input', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-intervals-input');
    const form = root.querySelector('.upload-intervals-form');

    input.value = '  123456  ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onIntervalsIcuSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onIntervalsIcuSubmit).toHaveBeenCalledWith('123456');
  });

  it('does not submit when the input is blank', () => {
    const { root, handlers } = setup();
    const form = root.querySelector('.upload-intervals-form');

    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onIntervalsIcuSubmit).not.toHaveBeenCalled();
  });

  it('toggles the intervals.icu loading state on the submit button and input', () => {
    const { root, view } = setup();
    const submitBtn = root.querySelector('.upload-intervals-submit');
    const input = root.querySelector('.upload-intervals-input');

    view.setIntervalsIcuLoading(true);
    expect(submitBtn.disabled).toBe(true);
    expect(submitBtn.textContent).toBe('載入中…');
    expect(input.disabled).toBe(true);

    view.setIntervalsIcuLoading(false);
    expect(submitBtn.disabled).toBe(false);
    expect(submitBtn.textContent).toBe('載入');
    expect(input.disabled).toBe(false);
  });

  it('renders the "查詢最近一筆" lookup link, opening in a new tab', () => {
    const { root } = setup();
    const link = root.querySelector('.upload-intervals-lookup-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('點此查詢最近一筆行事曆訓練代碼');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('sets the lookup link href to the browser\'s local date, not the server/UTC date (regression: 0720 vs 0721 mixup)', () => {
    const { root } = setup();
    const link = root.querySelector('.upload-intervals-lookup-link');

    const now = new Date();
    const expectedLocalDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    expect(link.getAttribute('href')).toBe(`/api/intervals-events?today=${expectedLocalDate}`);
  });
});

describe('createUploadView: shared error area', () => {
  it('shows and clears the error message', () => {
    const { root, view } = setup();
    const errorEl = root.querySelector('.upload-error');

    view.showError('無法解析這份 .zwo 檔案：missing <workout> element');
    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toContain('missing <workout> element');

    view.clearError();
    expect(errorEl.classList.contains('hidden')).toBe(true);
    expect(errorEl.textContent).toBe('');
  });
});
