import { describe, expect, it, vi } from 'vitest';
import { createUploadView } from '../src/ui/uploadView.js';

function selectFile(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('createUploadView', () => {
  it('renders the upload prompt with the error message hidden', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    createUploadView(root, { onFileSelected: vi.fn() });

    expect(root.querySelector('.upload-title').textContent).toContain('上傳課表');
    expect(root.querySelector('.upload-input').getAttribute('accept')).toContain('.zwo');
    expect(root.querySelector('.upload-error').classList.contains('hidden')).toBe(true);
  });

  it('calls onFileSelected with the chosen file and resets the input', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const onFileSelected = vi.fn();
    createUploadView(root, { onFileSelected });

    const file = new File(['<workout_file></workout_file>'], 'my-workout.zwo', { type: 'application/xml' });
    const input = root.querySelector('.upload-input');
    selectFile(input, file);

    expect(onFileSelected).toHaveBeenCalledTimes(1);
    expect(onFileSelected).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('does not call onFileSelected when the change event fires with no file', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const onFileSelected = vi.fn();
    createUploadView(root, { onFileSelected });

    const input = root.querySelector('.upload-input');
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(onFileSelected).not.toHaveBeenCalled();
  });

  it('shows and clears the error message', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const view = createUploadView(root, { onFileSelected: vi.fn() });
    const errorEl = root.querySelector('.upload-error');

    view.showError('無法解析這份 .zwo 檔案：missing <workout> element');
    expect(errorEl.classList.contains('hidden')).toBe(false);
    expect(errorEl.textContent).toContain('missing <workout> element');

    view.clearError();
    expect(errorEl.classList.contains('hidden')).toBe(true);
    expect(errorEl.textContent).toBe('');
  });
});
