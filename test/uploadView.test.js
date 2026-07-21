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

describe('createUploadView', () => {
  it('renders the upload prompt with the error message hidden', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    createUploadView(root, makeHandlers());

    expect(root.querySelector('.upload-title').textContent).toContain('上傳課表');
    expect(root.querySelector('.upload-input').getAttribute('accept')).toContain('.zwo');
    expect(root.querySelector('.upload-error').classList.contains('hidden')).toBe(true);
    expect(root.querySelector('.upload-intervals-input')).not.toBeNull();
    expect(root.querySelector('.upload-intervals-submit').textContent).toBe('載入');
  });

  it('calls onFileSelected with the chosen file and resets the input', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = makeHandlers();
    createUploadView(root, handlers);

    const file = new File(['<workout_file></workout_file>'], 'my-workout.zwo', { type: 'application/xml' });
    const input = root.querySelector('.upload-input');
    selectFile(input, file);

    expect(handlers.onFileSelected).toHaveBeenCalledTimes(1);
    expect(handlers.onFileSelected).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('does not call onFileSelected when the change event fires with no file', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = makeHandlers();
    createUploadView(root, handlers);

    const input = root.querySelector('.upload-input');
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(handlers.onFileSelected).not.toHaveBeenCalled();
  });

  it('shows and clears the error message', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createUploadView(root, makeHandlers());
    const errorEl = root.querySelector('.upload-error');

    view.showError('無法解析這份 .zwo 檔案：missing <workout> element');
    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toContain('missing <workout> element');

    view.clearError();
    expect(errorEl.classList.contains('hidden')).toBe(true);
    expect(errorEl.textContent).toBe('');
  });

  it('submits the intervals.icu form with the trimmed input value', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = makeHandlers();
    createUploadView(root, handlers);

    const input = root.querySelector('.upload-intervals-input');
    const form = root.querySelector('.upload-intervals-form');
    input.value = '  https://intervals.icu/workouts/123456  ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onIntervalsIcuSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onIntervalsIcuSubmit).toHaveBeenCalledWith('https://intervals.icu/workouts/123456');
  });

  it('does not submit the intervals.icu form when the input is blank', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = makeHandlers();
    createUploadView(root, handlers);

    const form = root.querySelector('.upload-intervals-form');
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onIntervalsIcuSubmit).not.toHaveBeenCalled();
  });

  it('toggles the intervals.icu loading state on the submit button and input', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createUploadView(root, makeHandlers());
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

  it('renders the "查詢最近一筆" lookup link below the intervals.icu input, opening in a new tab', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    createUploadView(root, makeHandlers());

    const link = root.querySelector('.upload-intervals-lookup-link');
    expect(link).not.toBeNull();
    expect(link.textContent).toBe('點此查詢最近一筆行事曆訓練代碼');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');

    // Must sit after the input+submit row, inside the intervals.icu form,
    // so it reads as "look up an ID here, then come back and paste it below".
    const row = root.querySelector('.upload-intervals-row');
    expect(row.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.closest('.upload-intervals-form')).not.toBeNull();
  });

  it('sets the lookup link href to the browser\'s local date, not the server/UTC date (regression: 0720 vs 0721 mixup)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    createUploadView(root, makeHandlers());
    const link = root.querySelector('.upload-intervals-lookup-link');

    // Computed the same way the view does (local getters), so this is
    // correct in whatever timezone the test happens to run in.
    const now = new Date();
    const expectedLocalDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    expect(link.getAttribute('href')).toBe(`/api/intervals-events?today=${expectedLocalDate}`);
  });

  it('puts the intervals.icu section before the .zwo file upload section (primary use case first)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    createUploadView(root, makeHandlers());

    const intervalsForm = root.querySelector('.upload-intervals-form');
    const uploadTitle = root.querySelector('.upload-title');
    expect(intervalsForm.compareDocumentPosition(uploadTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders an FTP input, settable via setFtpValue', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createUploadView(root, makeHandlers());
    const ftpInput = root.querySelector('.upload-ftp-input');

    expect(ftpInput).not.toBeNull();
    expect(ftpInput.getAttribute('type')).toBe('number');

    view.setFtpValue(215);
    expect(ftpInput.value).toBe('215');
  });

  it('calls onFtpChange as soon as the FTP input holds a valid positive number', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = makeHandlers();
    createUploadView(root, handlers);
    const ftpInput = root.querySelector('.upload-ftp-input');

    ftpInput.value = '230';
    ftpInput.dispatchEvent(new Event('input'));

    expect(handlers.onFtpChange).toHaveBeenCalledTimes(1);
    expect(handlers.onFtpChange).toHaveBeenCalledWith(230);
  });

  it('does not call onFtpChange for a blank, zero, or negative FTP value (still mid-edit)', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = makeHandlers();
    createUploadView(root, handlers);
    const ftpInput = root.querySelector('.upload-ftp-input');

    for (const value of ['', '0', '-5']) {
      ftpInput.value = value;
      ftpInput.dispatchEvent(new Event('input'));
    }

    expect(handlers.onFtpChange).not.toHaveBeenCalled();
  });

  it('rounds a fractional FTP input before passing it to onFtpChange', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = makeHandlers();
    createUploadView(root, handlers);
    const ftpInput = root.querySelector('.upload-ftp-input');

    ftpInput.value = '199.6';
    ftpInput.dispatchEvent(new Event('input'));

    expect(handlers.onFtpChange).toHaveBeenCalledWith(200);
  });

  it('renders a paste-text textarea and submits its full (untrimmed-internally) value', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = makeHandlers();
    createUploadView(root, handlers);

    const textarea = root.querySelector('.upload-paste-textarea');
    const form = root.querySelector('.upload-paste-form');
    expect(textarea).not.toBeNull();

    const pasted = '10 min @ 53w\n20 min @ 68w\n';
    textarea.value = pasted;
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onPasteTextSubmit).toHaveBeenCalledTimes(1);
    expect(handlers.onPasteTextSubmit).toHaveBeenCalledWith(pasted);
  });

  it('does not submit the paste-text form when the textarea is blank/whitespace-only', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const handlers = makeHandlers();
    createUploadView(root, handlers);

    const textarea = root.querySelector('.upload-paste-textarea');
    const form = root.querySelector('.upload-paste-form');

    textarea.value = '   \n  ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handlers.onPasteTextSubmit).not.toHaveBeenCalled();
  });
});
