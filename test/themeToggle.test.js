import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, createThemeToggle } from '../src/ui/themeToggle.js';

/** Minimal fake Storage so tests don't depend on/leak into a shared localStorage instance. */
function makeFakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

/** Minimal fake "document" exposing only what applyTheme()/createThemeToggle() touch. */
function makeFakeDoc() {
  const attrs = {};
  return {
    documentElement: {
      setAttribute: (name, value) => {
        attrs[name] = value;
      },
      getAttribute: (name) => attrs[name] ?? null,
    },
  };
}

function setup(options = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  const storage = options.storage ?? makeFakeStorage();
  const doc = options.doc ?? makeFakeDoc();
  const view = createThemeToggle(root, { storage, doc });
  return { root, storage, doc, view };
}

describe('applyTheme', () => {
  it('sets the "data-theme" attribute on the document element to the given theme', () => {
    const doc = makeFakeDoc();
    applyTheme('dark', doc);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('overwrites a previously set theme', () => {
    const doc = makeFakeDoc();
    applyTheme('dark', doc);
    applyTheme('light', doc);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('sets the literal string "auto" (not removing the attribute) - CSS treats "auto" the same as no attribute', () => {
    const doc = makeFakeDoc();
    applyTheme('auto', doc);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('auto');
  });
});

describe('createThemeToggle', () => {
  it('renders exactly three buttons: dark, light, auto (in that order)', () => {
    const { root } = setup();
    const buttons = root.querySelectorAll('.theme-toggle-btn');
    expect(buttons).toHaveLength(3);
    expect(Array.from(buttons).map((b) => b.dataset.themeOption)).toEqual(['dark', 'light', 'auto']);
  });

  it('applies the saved theme immediately on mount (no click needed)', () => {
    const { doc } = setup({ storage: makeFakeStorage({ user_theme: 'dark' }) });
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('defaults to "auto" when nothing has been saved yet', () => {
    const { doc } = setup();
    expect(doc.documentElement.getAttribute('data-theme')).toBe('auto');
  });

  it('marks the currently active theme\'s button on mount', () => {
    const { root } = setup({ storage: makeFakeStorage({ user_theme: 'light' }) });
    const lightBtn = root.querySelector('[data-theme-option="light"]');
    const darkBtn = root.querySelector('[data-theme-option="dark"]');
    expect(lightBtn.classList.contains('is-active')).toBe(true);
    expect(lightBtn.getAttribute('aria-pressed')).toBe('true');
    expect(darkBtn.classList.contains('is-active')).toBe(false);
    expect(darkBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking "dark" applies data-theme="dark" and persists it to storage', () => {
    const { root, doc, storage } = setup();
    root.querySelector('[data-theme-option="dark"]').click();
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(storage.getItem('user_theme')).toBe('dark');
  });

  it('clicking "light" applies data-theme="light" and persists it, overriding a previous selection', () => {
    const { root, doc, storage } = setup({ storage: makeFakeStorage({ user_theme: 'dark' }) });
    root.querySelector('[data-theme-option="light"]').click();
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light');
    expect(storage.getItem('user_theme')).toBe('light');
  });

  it('clicking "auto" applies data-theme="auto" (lets the prefers-color-scheme media query decide) and persists it', () => {
    const { root, doc, storage } = setup({ storage: makeFakeStorage({ user_theme: 'dark' }) });
    root.querySelector('[data-theme-option="auto"]').click();
    expect(doc.documentElement.getAttribute('data-theme')).toBe('auto');
    expect(storage.getItem('user_theme')).toBe('auto');
  });

  it('moves the "is-active" class to whichever button was clicked most recently', () => {
    const { root } = setup();
    root.querySelector('[data-theme-option="dark"]').click();
    expect(root.querySelector('[data-theme-option="dark"]').classList.contains('is-active')).toBe(true);

    root.querySelector('[data-theme-option="light"]').click();
    expect(root.querySelector('[data-theme-option="dark"]').classList.contains('is-active')).toBe(false);
    expect(root.querySelector('[data-theme-option="light"]').classList.contains('is-active')).toBe(true);
  });

  it('getActiveTheme() reflects the currently saved theme after a click', () => {
    const { root, view } = setup();
    root.querySelector('[data-theme-option="light"]').click();
    expect(view.getActiveTheme()).toBe('light');
  });
});

describe('createThemeToggle: real document/localStorage integration (default arguments)', () => {
  beforeEach(() => {
    window.localStorage.removeItem('user_theme');
    document.documentElement.removeAttribute('data-theme');
  });

  it('applies to the real document.documentElement and real localStorage when no options are given', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    createThemeToggle(root);

    root.querySelector('[data-theme-option="dark"]').click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('user_theme')).toBe('dark');

    document.documentElement.removeAttribute('data-theme');
    window.localStorage.removeItem('user_theme');
  });
});
