import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    onTrainerDayUrlSubmit: vi.fn(),
    onWhatsOnZwiftUrlSubmit: vi.fn(),
    onScheduledStartTimeSet: vi.fn(),
    onScheduledStartTimeCancel: vi.fn(),
    onFtpChange: vi.fn(),
    onAlertModeChange: vi.fn(),
    onDraftInputChange: vi.fn(),
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

describe('createUploadView layout (four parallel source cards)', () => {
  it('renders exactly four source cards, in order: url, paste text, .zwo upload, intervals.icu', () => {
    const { root } = setup();
    const titles = Array.from(root.querySelectorAll('.upload-source-title')).map((el) => el.textContent);
    expect(titles).toEqual(['貼課表網址', '貼上課表文字內容', '上傳 ZWO 檔案', '使用 intervals 行事曆課表']);
  });

  it('hides the intervals.icu card from view (temporarily unused) without removing it from the DOM - the underlying form/handlers/elements are all still present and wired up', () => {
    const { root } = setup();
    const card = root.querySelector('.upload-intervals-card');
    expect(card.classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-intervals-form')).not.toBeNull();
    expect(root.querySelector('.upload-intervals-input')).not.toBeNull();
    expect(root.querySelector('.upload-intervals-submit')).not.toBeNull();
    expect(root.querySelector('.upload-intervals-lookup-link')).not.toBeNull();
  });

  it('gives every source card title the same font-size/weight via one shared class (visual consistency)', () => {
    const { root } = setup();
    const titles = root.querySelectorAll('.upload-source-title');
    expect(titles).toHaveLength(4);
    for (const title of titles) {
      expect(title.tagName).toBe('H2');
    }
  });

  it('wraps each of the four blocks in the same card class', () => {
    const { root } = setup();
    expect(root.querySelectorAll('.upload-source-card')).toHaveLength(4);
  });

  it('renders the url card\'s hint text mentioning only TrainerDay (WhatsOnZwift fetch is blocked by anti-scraping, so it must not be advertised as supported)', () => {
    const { root } = setup();
    const urlCard = root.querySelectorAll('.upload-source-card')[0];
    const hint = urlCard.querySelector('.upload-source-hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('TrainerDay');
    expect(hint.textContent).not.toContain('Zwift');
    expect(hint.textContent).not.toContain('whatsonzwift');
  });

  it('shows a hint on the paste-text card mentioning only TrainerDay and pointing to the url card as an alternative', () => {
    const { root } = setup();
    const pasteCard = root.querySelectorAll('.upload-source-card')[1];
    const hint = pasteCard.querySelector('.upload-source-hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('TrainerDay');
    expect(hint.textContent).not.toContain('Zwift');
  });

  it('keeps a single shared error area below all four cards', () => {
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

describe('createUploadView: 倒數提示模式 (voice/beep toggle, mirrors the theme-toggle pill button style, positioned right below FTP)', () => {
  it('renders two mutually-exclusive pill buttons labeled 下一組提示倒數 / 逼逼聲倒數, positioned after the FTP row', () => {
    const { root } = setup();
    const buttons = root.querySelectorAll('.upload-alertmode-btn');
    expect(buttons).toHaveLength(2);
    expect(Array.from(buttons).map((btn) => btn.textContent)).toEqual(['下一組提示倒數', '逼逼聲倒數']);
    expect(Array.from(buttons).map((btn) => btn.dataset.mode)).toEqual(['voice', 'beep']);

    const positions = Array.from(root.querySelectorAll('.upload-ftp-row, .upload-alertmode-row, .upload-schedule-row')).map(
      (el) => el.className
    );
    expect(positions).toEqual(['upload-ftp-row', 'upload-alertmode-row', 'upload-schedule-row']);
  });

  it('calls onAlertModeChange with "voice" or "beep" when the corresponding button is clicked', () => {
    const { root, handlers } = setup();
    const [voiceBtn, beepBtn] = root.querySelectorAll('.upload-alertmode-btn');

    beepBtn.click();
    expect(handlers.onAlertModeChange).toHaveBeenCalledTimes(1);
    expect(handlers.onAlertModeChange).toHaveBeenCalledWith('beep');

    voiceBtn.click();
    expect(handlers.onAlertModeChange).toHaveBeenCalledTimes(2);
    expect(handlers.onAlertModeChange).toHaveBeenLastCalledWith('voice');
  });

  it('toggles the "is-active" class between the two buttons on click, mutually exclusive', () => {
    const { root } = setup();
    const [voiceBtn, beepBtn] = root.querySelectorAll('.upload-alertmode-btn');

    beepBtn.click();
    expect(beepBtn.classList.contains('is-active')).toBe(true);
    expect(voiceBtn.classList.contains('is-active')).toBe(false);

    voiceBtn.click();
    expect(voiceBtn.classList.contains('is-active')).toBe(true);
    expect(beepBtn.classList.contains('is-active')).toBe(false);
  });

  it('view.setAlertMode() lets the caller drive the active button externally (e.g. after restoring the saved mode from localStorage)', () => {
    const { root, view } = setup();
    const [voiceBtn, beepBtn] = root.querySelectorAll('.upload-alertmode-btn');

    view.setAlertMode('beep');
    expect(beepBtn.classList.contains('is-active')).toBe(true);
    expect(voiceBtn.classList.contains('is-active')).toBe(false);

    view.setAlertMode('voice');
    expect(voiceBtn.classList.contains('is-active')).toBe(true);
    expect(beepBtn.classList.contains('is-active')).toBe(false);
  });
});

describe('createUploadView: 設定開始時間 (group-ride scheduling, positioned right below FTP)', () => {
  it('has the title "設定開始時間", positioned after the FTP row and before the four source cards', () => {
    const { root } = setup();
    const label = root.querySelector('.upload-schedule-label');
    expect(label.textContent).toBe('設定開始時間');

    const positions = Array.from(root.querySelectorAll('.upload-ftp-row, .upload-schedule-row, .upload-source-list')).map(
      (el) => el.className
    );
    expect(positions).toEqual(['upload-ftp-row', 'upload-schedule-row', 'upload-source-list']);
  });

  it('shows a hint with the exact example format "20260724 20:00"', () => {
    const { root } = setup();
    expect(root.querySelector('.upload-schedule-hint').textContent).toContain('20260724 20:00');
    expect(root.querySelector('.upload-schedule-input').getAttribute('placeholder')).toBe('20260724 20:00');
  });

  it('calls onScheduledStartTimeSet with a Date when the input has the valid "YYYYMMDD HH:mm" format', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-schedule-input');
    const submitBtn = root.querySelector('.upload-schedule-submit');

    input.value = '20260724 20:00';
    submitBtn.click();

    expect(handlers.onScheduledStartTimeSet).toHaveBeenCalledTimes(1);
    const date = handlers.onScheduledStartTimeSet.mock.calls[0][0];
    expect(date).toBeInstanceOf(Date);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getHours()).toBe(20);
  });

  it('shows the confirmed date/time and disables the input after a valid submission (does not silently do nothing)', () => {
    const { root } = setup();
    const input = root.querySelector('.upload-schedule-input');
    const submitBtn = root.querySelector('.upload-schedule-submit');

    input.value = '20260724 20:00';
    submitBtn.click();

    const status = root.querySelector('.upload-schedule-status');
    expect(status.classList.contains('hidden')).toBe(false);
    expect(status.textContent).toContain('2026/07/24 20:00');
    expect(input.disabled).toBe(true);
    expect(submitBtn.disabled).toBe(true);
  });

  it('shows a clear inline error (not a silent failure) for an invalid format, and does not call the handler', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-schedule-input');
    const submitBtn = root.querySelector('.upload-schedule-submit');
    const errorEl = root.querySelector('.upload-error');

    input.value = 'not a valid date';
    submitBtn.click();

    expect(handlers.onScheduledStartTimeSet).not.toHaveBeenCalled();
    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/日期時間格式錯誤/);
  });

  it('does nothing for a blank submission (no handler call, no error)', () => {
    const { root, handlers } = setup();
    const submitBtn = root.querySelector('.upload-schedule-submit');
    const errorEl = root.querySelector('.upload-error');

    submitBtn.click();

    expect(handlers.onScheduledStartTimeSet).not.toHaveBeenCalled();
    expect(errorEl.classList.contains('hidden')).toBe(true);
  });

  it('calls onScheduledStartTimeCancel and resets to the unset state when "取消" is clicked', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-schedule-input');
    const submitBtn = root.querySelector('.upload-schedule-submit');

    input.value = '20260724 20:00';
    submitBtn.click();

    root.querySelector('.upload-schedule-cancel').click();

    expect(handlers.onScheduledStartTimeCancel).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.upload-schedule-status').classList.contains('hidden')).toBe(true);
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('');
    expect(submitBtn.disabled).toBe(false);
  });

  it('view.showScheduleStatus() / clearScheduleStatus() let the caller drive the status display externally (e.g. after restoring a schedule from localStorage)', () => {
    const { root, view } = setup();

    view.showScheduleStatus(new Date(2026, 6, 24, 20, 0));
    expect(root.querySelector('.upload-schedule-status').classList.contains('hidden')).toBe(false);
    expect(root.querySelector('.upload-schedule-status-text').textContent).toBe('2026/07/24 20:00');

    view.clearScheduleStatus();
    expect(root.querySelector('.upload-schedule-status').classList.contains('hidden')).toBe(true);
  });
});

describe('createUploadView: block 1 - 貼課表網址 (TrainerDay + WhatsOnZwift)', () => {
  it('routes a TrainerDay url to onTrainerDayUrlSubmit', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-url-input');
    const form = root.querySelector('.upload-url-form');

    input.value = 'https://app.trainerday.com/workouts/20260714-ramp-up-5';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onTrainerDayUrlSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onTrainerDayUrlSubmit).toHaveBeenCalledWith('https://app.trainerday.com/workouts/20260714-ramp-up-5');
    expect(handlers.onWhatsOnZwiftUrlSubmit).not.toHaveBeenCalled();
    expect(handlers.onPasteTextSubmit).not.toHaveBeenCalled();
  });

  it('is case-insensitive for the protocol ("HTTP://...")', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-url-input');
    const form = root.querySelector('.upload-url-form');

    input.value = 'HTTP://app.trainerday.com/workouts/foo';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onTrainerDayUrlSubmit).toHaveBeenCalledTimes(1);
  });

  it('routes a whatsonzwift.com url to onWhatsOnZwiftUrlSubmit', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-url-input');
    const form = root.querySelector('.upload-url-form');

    input.value = 'https://whatsonzwift.com/workouts/threshold/over-unders';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onWhatsOnZwiftUrlSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onWhatsOnZwiftUrlSubmit).toHaveBeenCalledWith('https://whatsonzwift.com/workouts/threshold/over-unders');
    expect(handlers.onTrainerDayUrlSubmit).not.toHaveBeenCalled();
  });

  it('also accepts the www.whatsonzwift.com subdomain', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-url-input');
    const form = root.querySelector('.upload-url-form');

    input.value = 'https://www.whatsonzwift.com/workouts/over-unders';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onWhatsOnZwiftUrlSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error (no handler call) for a url from an unsupported host', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-url-input');
    const form = root.querySelector('.upload-url-form');
    const errorEl = root.querySelector('.upload-error');

    input.value = 'https://example.com/some-other-workout-site';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onTrainerDayUrlSubmit).not.toHaveBeenCalled();
    expect(handlers.onWhatsOnZwiftUrlSubmit).not.toHaveBeenCalled();
    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toMatch(/TrainerDay.*WhatsOnZwift|WhatsOnZwift.*TrainerDay/);
  });

  it('shows an inline "format error" for a value that is not a valid url at all', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-url-input');
    const form = root.querySelector('.upload-url-form');
    const errorEl = root.querySelector('.upload-error');

    input.value = 'not a url';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onTrainerDayUrlSubmit).not.toHaveBeenCalled();
    expect(handlers.onWhatsOnZwiftUrlSubmit).not.toHaveBeenCalled();
    expect(errorEl.classList.contains('hidden')).toBe(false);
  });

  it('rejects a non-http(s) protocol even if the hostname matches (e.g. "file://app.trainerday.com/...")', () => {
    const { root, handlers } = setup();
    const input = root.querySelector('.upload-url-input');
    const form = root.querySelector('.upload-url-form');

    input.value = 'file://app.trainerday.com/etc/passwd';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onTrainerDayUrlSubmit).not.toHaveBeenCalled();
  });

  it('does nothing for a blank submission (no handler call, no error)', () => {
    const { root, handlers } = setup();
    const form = root.querySelector('.upload-url-form');
    const errorEl = root.querySelector('.upload-error');

    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onTrainerDayUrlSubmit).not.toHaveBeenCalled();
    expect(errorEl.classList.contains('hidden')).toBe(true);
  });

  it('toggles the url-form loading state on the submit button and input', () => {
    const { root, view } = setup();
    const submitBtn = root.querySelector('.upload-url-submit');
    const input = root.querySelector('.upload-url-input');

    view.setUrlLoading(true);
    expect(submitBtn.disabled).toBe(true);
    expect(submitBtn.textContent).toBe('載入中…');
    expect(input.disabled).toBe(true);

    view.setUrlLoading(false);
    expect(submitBtn.disabled).toBe(false);
    expect(submitBtn.textContent).toBe('載入');
    expect(input.disabled).toBe(false);
  });
});

describe('createUploadView: block 2 - 貼上課表文字內容 (text only, no url detection)', () => {
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

  it('routes text that looks like a url straight to onPasteTextSubmit - no url detection happens in this field anymore', () => {
    const { root, handlers } = setup();
    const textarea = root.querySelector('.upload-paste-textarea');
    const form = root.querySelector('.upload-paste-form');

    textarea.value = 'https://app.trainerday.com/workouts/20260714-ramp-up-5';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onPasteTextSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onPasteTextSubmit).toHaveBeenCalledWith('https://app.trainerday.com/workouts/20260714-ramp-up-5');
    expect(handlers.onTrainerDayUrlSubmit).not.toHaveBeenCalled();
  });
});

describe('createUploadView: block 3 - 上傳 ZWO 檔案', () => {
  it('renders the dropzone with the file input', () => {
    const { root } = setup();
    expect(root.querySelector('.upload-dropzone')).not.toBeNull();
    expect(root.querySelector('.upload-input')).not.toBeNull();
  });

  it('does not set an "accept" attribute on the file input (regression: iOS grays out every file in cloud-drive pickers when accept is set to a non-standard extension like .zwo)', () => {
    const { root } = setup();
    expect(root.querySelector('.upload-input').hasAttribute('accept')).toBe(false);
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

describe('createUploadView: block 4 - 使用 intervals 行事曆課表', () => {
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

describe('createUploadView: draft input persistence (URL + paste text fields)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not call onDraftInputChange immediately on input - it is debounced', () => {
    const { root, handlers } = setup();
    root.querySelector('.upload-url-input').value = 'https://app.trainerday.com/workouts/abc';
    root.querySelector('.upload-url-input').dispatchEvent(new Event('input'));

    expect(handlers.onDraftInputChange).not.toHaveBeenCalled();
  });

  it('calls onDraftInputChange with both fields\' current values after the debounce delay', () => {
    const { root, handlers } = setup();
    const urlInput = root.querySelector('.upload-url-input');
    const pasteTextarea = root.querySelector('.upload-paste-textarea');

    urlInput.value = 'https://app.trainerday.com/workouts/abc';
    urlInput.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(500);

    expect(handlers.onDraftInputChange).toHaveBeenCalledTimes(1);
    expect(handlers.onDraftInputChange).toHaveBeenCalledWith({ url: 'https://app.trainerday.com/workouts/abc', pasteText: '' });

    pasteTextarea.value = '5m 50%';
    pasteTextarea.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(500);

    expect(handlers.onDraftInputChange).toHaveBeenCalledTimes(2);
    expect(handlers.onDraftInputChange).toHaveBeenLastCalledWith({ url: 'https://app.trainerday.com/workouts/abc', pasteText: '5m 50%' });
  });

  it('coalesces rapid keystrokes into a single call (resets the debounce timer on each input)', () => {
    const { root, handlers } = setup();
    const pasteTextarea = root.querySelector('.upload-paste-textarea');

    for (const partial of ['5', '5m', '5m ', '5m 5', '5m 50', '5m 50%']) {
      pasteTextarea.value = partial;
      pasteTextarea.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(100); // less than the debounce delay - each keystroke resets it
    }
    vi.advanceTimersByTime(500);

    expect(handlers.onDraftInputChange).toHaveBeenCalledTimes(1);
    expect(handlers.onDraftInputChange).toHaveBeenLastCalledWith({ url: '', pasteText: '5m 50%' });
  });

  it('setDraftInputs() restores both fields\' values from the outside (e.g. after loading a saved draft)', () => {
    const { root, view } = setup();
    view.setDraftInputs({ url: 'https://app.trainerday.com/workouts/abc', pasteText: '5m 50%\n10m 75%' });

    expect(root.querySelector('.upload-url-input').value).toBe('https://app.trainerday.com/workouts/abc');
    expect(root.querySelector('.upload-paste-textarea').value).toBe('5m 50%\n10m 75%');
  });

  it('setDraftInputs() leaves a field untouched when its value is not a string (e.g. only one field was saved)', () => {
    const { root, view } = setup();
    root.querySelector('.upload-url-input').value = 'https://app.trainerday.com/workouts/abc';
    view.setDraftInputs({ pasteText: '5m 50%' });

    expect(root.querySelector('.upload-url-input').value).toBe('https://app.trainerday.com/workouts/abc');
    expect(root.querySelector('.upload-paste-textarea').value).toBe('5m 50%');
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
