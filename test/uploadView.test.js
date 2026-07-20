import { describe, expect, it, vi } from 'vitest';
import { createUploadView } from '../src/ui/uploadView.js';

function selectFile(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function makeHandlers(overrides = {}) {
  return { onFileSelected: vi.fn(), onIntervalsIcuSubmit: vi.fn(), ...overrides };
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
});
