import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initPlayerApp } from '../src/ui/playerApp.js';

/** jsdom has no real Worker; initPlayerApp only needs postMessage/onmessage to exist without throwing for these tests. */
class MockWorker {
  postMessage() {}
  terminate() {}
}

beforeEach(() => {
  vi.stubGlobal('Worker', MockWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function selectFile(input, file) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function setup() {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  initPlayerApp(root);
  return { root };
}

const VALID_ZWO = '<workout_file><workout><SteadyState Duration="60" Power="0.7" /></workout></workout_file>';

/**
 * jsdom's File implementation in this environment doesn't support .text() (throws
 * "not a function"), so a real `File`/`Blob` can't be read here. handleFileSelected()
 * only touches `.name` and `.text()` on whatever it's given, so a plain duck-typed
 * fake object exercises the exact same code path without depending on jsdom's Blob
 * support - this mirrors how a real browser's File behaves for the purposes of this
 * validation logic.
 */
function fakeFile(name, content) {
  return { name, text: () => Promise.resolve(content) };
}

describe('initPlayerApp: .zwo file upload validation (accept attribute intentionally removed, see uploadView.js)', () => {
  it('accepts a file named with a lowercase ".zwo" extension and parses it', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('my-workout.zwo', VALID_ZWO));

    await vi.waitFor(() => {
      expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    });
  });

  it('accepts a file named with an uppercase ".ZWO" extension (case-insensitive)', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('MY-WORKOUT.ZWO', VALID_ZWO));

    await vi.waitFor(() => {
      expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(false);
    });
  });

  it('rejects a file with a non-.zwo extension with a clear error, without attempting to parse it', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('photo.jpg', 'not xml at all, just some random text'));

    await vi.waitFor(() => {
      const errorEl = root.querySelector('.upload-error');
      expect(errorEl.classList.contains('hidden')).toBe(false);
    });

    expect(root.querySelector('.upload-error').textContent).toBe('這不是合法的 zwo 檔案，請選擇副檔名為 .zwo 的課表檔案。');
    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
  });

  it('rejects a file with no extension at all', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('workout', VALID_ZWO));

    await vi.waitFor(() => {
      expect(root.querySelector('.upload-error').classList.contains('hidden')).toBe(false);
    });
    expect(root.querySelector('.upload-error').textContent).toContain('這不是合法的 zwo 檔案');
  });

  it('still surfaces the underlying parser error for a .zwo-named file with invalid content (extension check alone is not enough)', async () => {
    const { root } = setup();
    const input = root.querySelector('.upload-input');
    selectFile(input, fakeFile('broken.zwo', 'this is not xml'));

    await vi.waitFor(() => {
      const errorEl = root.querySelector('.upload-error');
      expect(errorEl.classList.contains('hidden')).toBe(false);
    });

    expect(root.querySelector('.upload-error').textContent).toContain('無法解析這份 .zwo 檔案：');
    expect(root.querySelector('.player-mount').classList.contains('hidden')).toBe(true);
  });
});
