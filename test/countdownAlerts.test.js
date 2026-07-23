import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMER_EVENTS } from '../src/engine/timerEngine.js';
import { COUNTDOWN_FINISHING_SOON_TEXT, handleTimerEvents } from '../src/ui/countdownAlerts.js';

/** 倒數預告 banner 要撐過完整的 10 秒倒數，比 renderPlayer.js 預設的 5 秒久（見 countdownAlerts.js） */
const COUNTDOWN_PREVIEW_BANNER_MS = 11000;

function makeWorkout() {
  return {
    id: 'alerts-test-workout',
    name: 'Alerts Test Workout',
    source: 'zwo',
    totalDuration: 57,
    intervals: [
      { type: 'warmup', duration: 12, powerStart: 50, powerEnd: 70, cadence: null },
      { type: 'steady', duration: 20, powerStart: 88, powerEnd: 88, cadence: 90 },
      { type: 'freeride', duration: 10, powerStart: null, powerEnd: null, cadence: null },
      { type: 'cooldown', duration: 15, powerStart: 60, powerEnd: 40, cadence: null },
    ],
  };
}

function makeState(overrides = {}) {
  return {
    status: 'running',
    currentIntervalIndex: 0,
    elapsedInInterval: 0,
    elapsedTotal: 0,
    powerAdjustPct: 0,
    startTimestamp: null,
    ...overrides,
  };
}

function makeDeps() {
  return { playBeep: vi.fn(), speak: vi.fn(), showNextIntervalBanner: vi.fn() };
}

describe('handleTimerEvents: countdownWarning (10 seconds before the CURRENT interval ends)', () => {
  it('plays a beep and shows/speaks a preview of the upcoming steady interval (duration + %FTP)', () => {
    const deps = makeDeps();
    // currentIntervalIndex 0 (warmup) is about to end; the upcoming interval is index 1 (steady, 88%)
    const state = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：20 秒 · 88% FTP', COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledWith('10 秒後進入下一組，88% FTP，持續 20 秒');
  });

  it('shows/speaks the preview banner for at least the full 10-second countdown window (regression: the default 5s auto-hide left a blank gap for half the countdown)', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    const durationArg = deps.showNextIntervalBanner.mock.calls[0][1];
    expect(durationArg).toBeGreaterThanOrEqual(10000);
  });

  it('matches the "下一組：5 分鐘 · 75% FTP" example format for a minute-scale steady interval', () => {
    const deps = makeDeps();
    const workout = {
      ...makeWorkout(),
      intervals: [
        { type: 'steady', duration: 60, powerStart: 50, powerEnd: 50, cadence: null },
        { type: 'steady', duration: 300, powerStart: 75, powerEnd: 75, cadence: null },
      ],
    };
    const state = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout, state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：5 分鐘 · 75% FTP', COUNTDOWN_PREVIEW_BANNER_MS);
  });

  it('shows a "XX% -> YY% FTP" range (not a single number) when the upcoming interval ramps', () => {
    const deps = makeDeps();
    // currentIntervalIndex 2 (freeride) is about to end; upcoming is index 3 (cooldown, 60% -> 40%)
    const state = makeState({ currentIntervalIndex: 2 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：15 秒 · 60% → 40% FTP', COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.speak).toHaveBeenCalledWith('10 秒後進入下一組，60% 到 40% FTP，持續 15 秒');
  });

  it('applies the user\'s power adjustment to the previewed percentage', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 0, powerAdjustPct: 5 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：20 秒 · 93% FTP', COUNTDOWN_PREVIEW_BANNER_MS);
  });

  it('shows "自由騎乘" with no percentage when the upcoming interval is freeride', () => {
    const deps = makeDeps();
    // currentIntervalIndex 1 (steady) is about to end; upcoming is index 2 (freeride)
    const state = makeState({ currentIntervalIndex: 1 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：自由騎乘 · 10 秒', COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.speak).toHaveBeenCalledWith('10 秒後進入下一組，自由騎乘，持續 10 秒');
  });

  it('shows "即將完成" instead of a nonexistent next interval when the CURRENT interval is the last one', () => {
    const deps = makeDeps();
    // currentIntervalIndex 3 (cooldown) is the last interval - there is no "next" interval
    const state = makeState({ currentIntervalIndex: 3 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith(COUNTDOWN_FINISHING_SOON_TEXT, COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('即將完成', COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.speak).toHaveBeenCalledWith('10 秒後即將完成');
  });
});

describe('handleTimerEvents: intervalChanged (unchanged existing format: mm:ss + watts, default banner duration)', () => {
  it('shows the next-interval banner with duration/%FTP/watts on intervalChanged', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    handleTimerEvents([TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：穩定 · 0:20 · 88% FTP · 176W');
    expect(deps.playBeep).not.toHaveBeenCalled();
    expect(deps.speak).not.toHaveBeenCalled();
  });

  it('shows a banner without wattage for a freeride segment', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 2, elapsedInInterval: 0, elapsedTotal: 32 });
    handleTimerEvents([TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ...deps, ftp: 200 });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：自由騎乘 · 0:10');
  });
});

describe('handleTimerEvents: multiple events in the same batch', () => {
  it('handles both a countdown warning and an interval change if they arrive together (interval-changed banner wins, shown last)', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING, TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    // both the countdown preview and the interval-changed banner fire; the last call is what's visible
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(2);
    expect(deps.showNextIntervalBanner).toHaveBeenLastCalledWith('下一組：穩定 · 0:20 · 88% FTP · 176W');
  });

  it('does nothing for workoutFinished or an empty event list', () => {
    const deps = makeDeps();
    handleTimerEvents([TIMER_EVENTS.WORKOUT_FINISHED], { workout: makeWorkout(), state: makeState(), ftp: 200, ...deps });
    handleTimerEvents([], { workout: makeWorkout(), state: makeState(), ftp: 200, ...deps });

    expect(deps.playBeep).not.toHaveBeenCalled();
    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.showNextIntervalBanner).not.toHaveBeenCalled();
  });
});

describe('handleTimerEvents: shortCountdownTick (短間歇例外，組別時長 <= 20 秒：只播提示音，不唸下一組預告)', () => {
  it('plays a beep but does not speak or show a banner', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1 });
    handleTimerEvents([TIMER_EVENTS.SHORT_COUNTDOWN_TICK], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.showNextIntervalBanner).not.toHaveBeenCalled();
  });

  it('plays one beep per occurrence when multiple shortCountdownTick events arrive in the same batch (throttled tab catch-up)', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1 });
    handleTimerEvents(
      [TIMER_EVENTS.SHORT_COUNTDOWN_TICK, TIMER_EVENTS.SHORT_COUNTDOWN_TICK, TIMER_EVENTS.SHORT_COUNTDOWN_TICK],
      { workout: makeWorkout(), state, ftp: 200, ...deps }
    );

    expect(deps.playBeep).toHaveBeenCalledTimes(3);
    expect(deps.speak).not.toHaveBeenCalled();
  });

  it('does not interact with countdownWarning/intervalChanged handling when they arrive in the same batch', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    handleTimerEvents([TIMER_EVENTS.SHORT_COUNTDOWN_TICK, TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：穩定 · 0:20 · 88% FTP · 176W');
  });

  it('a playBeep() failure during a short-interval tick does not throw and is isolated per occurrence', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps();
    deps.playBeep.mockImplementation(() => {
      throw new Error('AudioContext boom');
    });
    const state = makeState({ currentIntervalIndex: 1 });

    expect(() =>
      handleTimerEvents([TIMER_EVENTS.SHORT_COUNTDOWN_TICK, TIMER_EVENTS.SHORT_COUNTDOWN_TICK], {
        workout: makeWorkout(),
        state,
        ftp: 200,
        ...deps,
      })
    ).not.toThrow();

    expect(deps.playBeep).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    consoleErrorSpy.mockRestore();
  });

  it('does nothing when shortCountdownTick is absent from the event list', () => {
    const deps = makeDeps();
    handleTimerEvents([TIMER_EVENTS.WORKOUT_FINISHED], { workout: makeWorkout(), state: makeState(), ftp: 200, ...deps });
    expect(deps.playBeep).not.toHaveBeenCalled();
  });
});

describe('handleTimerEvents: error isolation (regression - user reported "one beep then total silence")', () => {
  // 使用者回報過「只聽到一聲提示音，之後語音跟後續提示音全部消失」——最像是
  // 某一段（例如 speak()）丟出沒被 catch 的例外，把同一次呼叫裡排在後面的
  // 程式碼整個中斷。這裡驗證 playBeep／語音預告／banner 三段互相獨立，任一段
  // 丟出例外都不會波及其他段，也不會讓例外一路往外拋、中斷呼叫端（見
  // countdownAlerts.js 的說明）。
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('playBeep() throwing does not prevent speak() or showNextIntervalBanner() from running, and does not propagate', () => {
    const deps = makeDeps();
    deps.playBeep.mockImplementation(() => {
      throw new Error('AudioContext boom');
    });
    const state = makeState({ currentIntervalIndex: 0 });

    expect(() => handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps })).not.toThrow();

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('speak() throwing does not prevent playBeep() (already ran) or showNextIntervalBanner() from running, and does not propagate', () => {
    const deps = makeDeps();
    deps.speak.mockImplementation(() => {
      throw new Error('SpeechSynthesis boom');
    });
    const state = makeState({ currentIntervalIndex: 0 });

    expect(() => handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps })).not.toThrow();

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('showNextIntervalBanner() throwing during a countdownWarning does not propagate (playBeep/speak already ran)', () => {
    const deps = makeDeps();
    deps.showNextIntervalBanner.mockImplementation(() => {
      throw new Error('DOM boom');
    });
    const state = makeState({ currentIntervalIndex: 0 });

    expect(() => handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps })).not.toThrow();

    expect(deps.playBeep).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('showNextIntervalBanner() throwing during an intervalChanged event does not propagate', () => {
    const deps = makeDeps();
    deps.showNextIntervalBanner.mockImplementation(() => {
      throw new Error('DOM boom');
    });
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });

    expect(() => handleTimerEvents([TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps })).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('a subsequent, independent countdownWarning call still plays the beep normally after a prior call\'s speak() failed (no lingering state corruption)', () => {
    const deps = makeDeps();
    deps.speak.mockImplementationOnce(() => {
      throw new Error('SpeechSynthesis boom');
    });
    const state0 = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state: state0, ftp: 200, ...deps });

    // second, independent call (e.g. the next interval's own countdown warning) - speak() no longer throws
    const state1 = makeState({ currentIntervalIndex: 2 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state: state1, ftp: 200, ...deps });

    expect(deps.playBeep).toHaveBeenCalledTimes(2);
    expect(deps.speak).toHaveBeenCalledTimes(2);
  });
});

describe('unlockAudioAndSpeechForAutoplay (團體訓練排程：「設定開始時間」當下解鎖自動播放權限)', () => {
  // countdownAlerts.js 的 sharedAudioContext 是模組層級變數，playCountdownBeep()
  // 也共用它——每個測試都用 vi.resetModules() + 動態 import 拿一份全新的模組
  // 實例，避免某個測試建立過 AudioContext 之後，後面的測試誤判成「沒有再建立
  // 一個新的」。
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubAudioContext() {
    const oscillator = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: {} };
    const gain = { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
    const ctx = {
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
      destination: {},
      currentTime: 0,
      state: 'suspended',
      resume: vi.fn(),
    };
    const AudioContextCtor = vi.fn(() => ctx);
    vi.stubGlobal('AudioContext', AudioContextCtor);
    return { AudioContextCtor, ctx, oscillator, gain };
  }

  it('creates and resumes an AudioContext, then plays a silent (zero-gain) blip to fully unlock it', async () => {
    const { AudioContextCtor, ctx, oscillator, gain } = stubAudioContext();
    const { unlockAudioAndSpeechForAutoplay } = await import('../src/ui/countdownAlerts.js');

    unlockAudioAndSpeechForAutoplay();

    expect(AudioContextCtor).toHaveBeenCalledTimes(1);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, ctx.currentTime); // silent, not the audible 0.2 level playCountdownBeep uses
    expect(oscillator.start).toHaveBeenCalledTimes(1);
  });

  it('reuses the same shared AudioContext across multiple calls instead of creating a new one each time', async () => {
    const { AudioContextCtor } = stubAudioContext();
    const { unlockAudioAndSpeechForAutoplay } = await import('../src/ui/countdownAlerts.js');

    unlockAudioAndSpeechForAutoplay();
    unlockAudioAndSpeechForAutoplay();

    expect(AudioContextCtor).toHaveBeenCalledTimes(1);
  });

  it('speaks a near-silent (volume 0) utterance to unlock SpeechSynthesis for later automatic warnings', async () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(text) {
          this.text = text;
          this.volume = 1;
        }
      }
    );
    const { unlockAudioAndSpeechForAutoplay } = await import('../src/ui/countdownAlerts.js');

    unlockAudioAndSpeechForAutoplay();

    expect(speak).toHaveBeenCalledTimes(1);
    const utterance = speak.mock.calls[0][0];
    expect(utterance.volume).toBe(0);
  });

  it('does not throw when AudioContext/speechSynthesis are unavailable (e.g. an unsupported browser)', async () => {
    const { unlockAudioAndSpeechForAutoplay } = await import('../src/ui/countdownAlerts.js');
    expect(() => unlockAudioAndSpeechForAutoplay()).not.toThrow();
  });
});

describe('playCountdownBeep (regression: iOS Safari can silently suspend the shared AudioContext between beeps)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubAudioContext(initialState) {
    const oscillator = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: {} };
    const gain = { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
    const ctx = {
      createOscillator: vi.fn(() => oscillator),
      createGain: vi.fn(() => gain),
      destination: {},
      currentTime: 0,
      state: initialState,
      resume: vi.fn(),
    };
    const AudioContextCtor = vi.fn(() => ctx);
    vi.stubGlobal('AudioContext', AudioContextCtor);
    return { AudioContextCtor, ctx, oscillator };
  }

  it('calls ctx.resume() before playing when the shared AudioContext is suspended (e.g. after SpeechSynthesis interrupted it)', async () => {
    const { ctx, oscillator } = stubAudioContext('suspended');
    const { playCountdownBeep } = await import('../src/ui/countdownAlerts.js');

    playCountdownBeep();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(oscillator.start).toHaveBeenCalledTimes(1);
  });

  it('does not call ctx.resume() when the context is already running (no unnecessary calls)', async () => {
    const { ctx } = stubAudioContext('running');
    const { playCountdownBeep } = await import('../src/ui/countdownAlerts.js');

    playCountdownBeep();

    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('re-checks and resumes on every call, not just the first (a beep several intervals later can still be suspended again)', async () => {
    const { ctx } = stubAudioContext('suspended');
    const { playCountdownBeep } = await import('../src/ui/countdownAlerts.js');

    playCountdownBeep();
    playCountdownBeep();

    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });
});
