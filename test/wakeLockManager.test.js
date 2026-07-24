import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWakeLockManager } from '../src/utils/wakeLockManager.js';

/** Minimal fake WakeLockSentinel: supports release() + the 'release' event listener. */
function makeFakeLock() {
  const listeners = {};
  const lock = {
    released: false,
    release: vi.fn(async () => {
      lock.released = true;
      (listeners.release || []).forEach((cb) => cb());
    }),
    addEventListener: vi.fn((event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    }),
    // test helper: simulate the browser revoking the lock itself (e.g. tab backgrounded)
    simulateSystemRelease() {
      lock.released = true;
      (listeners.release || []).forEach((cb) => cb());
    },
  };
  return lock;
}

function makeFakeNavigator({ supported = true, requestImpl } = {}) {
  if (!supported) return {};
  return {
    wakeLock: {
      request: requestImpl || vi.fn(async () => makeFakeLock()),
    },
  };
}

function makeFakeDocument(initialVisibility = 'visible') {
  const listeners = {};
  return {
    visibilityState: initialVisibility,
    addEventListener: vi.fn((event, cb) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(cb);
    }),
    dispatchVisibilityChange(newState) {
      this.visibilityState = newState;
      (listeners.visibilitychange || []).forEach((cb) => cb());
    },
  };
}

describe('createWakeLockManager: feature detection / graceful degradation', () => {
  it('isSupported() returns false when navigator.wakeLock does not exist', () => {
    const manager = createWakeLockManager({ navigatorRef: makeFakeNavigator({ supported: false }), documentRef: makeFakeDocument() });
    expect(manager.isSupported()).toBe(false);
  });

  it('isSupported() returns true when navigator.wakeLock exists', () => {
    const manager = createWakeLockManager({ navigatorRef: makeFakeNavigator(), documentRef: makeFakeDocument() });
    expect(manager.isSupported()).toBe(true);
  });

  it('enable() does not throw and stays inactive when the API is unsupported (silent degradation, no error surfaced to the user)', async () => {
    const manager = createWakeLockManager({ navigatorRef: makeFakeNavigator({ supported: false }), documentRef: makeFakeDocument() });
    await expect(manager.enable()).resolves.toBeUndefined();
    expect(manager.isActive()).toBe(false);
  });

  it('works with no navigator/document at all (e.g. non-browser test environment) without throwing', async () => {
    const manager = createWakeLockManager({ navigatorRef: undefined, documentRef: undefined });
    await expect(manager.enable()).resolves.toBeUndefined();
    expect(() => manager.disable()).not.toThrow();
  });

  it('logs to console.error (not a user-facing alert) and stays inactive when request() rejects', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const navigatorRef = makeFakeNavigator({ requestImpl: vi.fn().mockRejectedValue(new Error('denied (e.g. low power mode)')) });
    const manager = createWakeLockManager({ navigatorRef, documentRef: makeFakeDocument() });

    await manager.enable();

    expect(manager.isActive()).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe('createWakeLockManager: enable/disable', () => {
  it('enable() acquires a lock via navigator.wakeLock.request("screen")', async () => {
    const requestImpl = vi.fn(async () => makeFakeLock());
    const navigatorRef = makeFakeNavigator({ requestImpl });
    const manager = createWakeLockManager({ navigatorRef, documentRef: makeFakeDocument() });

    await manager.enable();

    expect(requestImpl).toHaveBeenCalledWith('screen');
    expect(manager.isActive()).toBe(true);
  });

  it('enable() called again while already active does not request a second lock', async () => {
    const requestImpl = vi.fn(async () => makeFakeLock());
    const navigatorRef = makeFakeNavigator({ requestImpl });
    const manager = createWakeLockManager({ navigatorRef, documentRef: makeFakeDocument() });

    await manager.enable();
    await manager.enable();

    expect(requestImpl).toHaveBeenCalledTimes(1);
  });

  it('disable() releases the held lock', async () => {
    const lock = makeFakeLock();
    const navigatorRef = makeFakeNavigator({ requestImpl: vi.fn(async () => lock) });
    const manager = createWakeLockManager({ navigatorRef, documentRef: makeFakeDocument() });

    await manager.enable();
    manager.disable();

    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(manager.isActive()).toBe(false);
  });

  it('disable() when never enabled does nothing (no error)', () => {
    const manager = createWakeLockManager({ navigatorRef: makeFakeNavigator(), documentRef: makeFakeDocument() });
    expect(() => manager.disable()).not.toThrow();
  });

  it('disable() then enable() again requests a fresh lock', async () => {
    const requestImpl = vi.fn(async () => makeFakeLock());
    const navigatorRef = makeFakeNavigator({ requestImpl });
    const manager = createWakeLockManager({ navigatorRef, documentRef: makeFakeDocument() });

    await manager.enable();
    manager.disable();
    await manager.enable();

    expect(requestImpl).toHaveBeenCalledTimes(2);
  });
});

describe('createWakeLockManager: re-acquires on returning to the foreground (regression: tab backgrounding silently revokes the lock)', () => {
  it('re-requests a lock when the tab becomes visible again while still "desired active" (backgrounded and revoked by the browser in between)', async () => {
    const requestImpl = vi.fn(async () => makeFakeLock());
    const navigatorRef = makeFakeNavigator({ requestImpl });
    const documentRef = makeFakeDocument('visible');
    const manager = createWakeLockManager({ navigatorRef, documentRef });

    await manager.enable();
    expect(requestImpl).toHaveBeenCalledTimes(1);

    // simulate what real browsers do: backgrounding a tab auto-releases the sentinel
    const heldLock = await navigatorRef.wakeLock.request.mock.results[0].value;
    heldLock.simulateSystemRelease();
    expect(manager.isActive()).toBe(false);

    documentRef.dispatchVisibilityChange('hidden');
    expect(requestImpl).toHaveBeenCalledTimes(1); // not re-requested while still hidden

    documentRef.dispatchVisibilityChange('visible');
    await Promise.resolve(); // let the async requestLock() inside the handler settle
    await Promise.resolve();

    expect(requestImpl).toHaveBeenCalledTimes(2);
  });

  it('does not re-request on visibilitychange if disable() was called while backgrounded (no longer "desired active")', async () => {
    const requestImpl = vi.fn(async () => makeFakeLock());
    const navigatorRef = makeFakeNavigator({ requestImpl });
    const documentRef = makeFakeDocument('visible');
    const manager = createWakeLockManager({ navigatorRef, documentRef });

    await manager.enable();
    documentRef.dispatchVisibilityChange('hidden');
    manager.disable(); // e.g. user paused the workout while the tab was backgrounded
    documentRef.dispatchVisibilityChange('visible');
    await Promise.resolve();

    expect(requestImpl).toHaveBeenCalledTimes(1); // only the original enable() call
  });

  it('does not request a duplicate lock on visibilitychange if a lock is still actually held', async () => {
    const requestImpl = vi.fn(async () => makeFakeLock());
    const navigatorRef = makeFakeNavigator({ requestImpl });
    const documentRef = makeFakeDocument('visible');
    const manager = createWakeLockManager({ navigatorRef, documentRef });

    await manager.enable();
    documentRef.dispatchVisibilityChange('visible'); // fires again but the lock was never actually revoked

    expect(requestImpl).toHaveBeenCalledTimes(1);
  });
});
