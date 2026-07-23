import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMER_EVENTS } from '../src/engine/timerEngine.js';
import { ALERT_MODE_BEEP, ALERT_MODE_VOICE } from '../src/ui/alertModeStore.js';
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

function makeDeps(alertMode = ALERT_MODE_VOICE) {
  return { alertMode, speak: vi.fn(), playCountdownBeeps: vi.fn(), showNextIntervalBanner: vi.fn() };
}

// countdownWarning 觸發時，語音預告用加快的語速講精簡內容（見 countdownAlerts.js）
const FAST_PREVIEW_SPEECH_RATE = 1.35;

// countdownTick 逐秒報數用比預告更快的語速，確保單一個數字唸完的時間跟畫面
// 倒數的 1 秒節奏對得上（見 countdownAlerts.js 的 DIGIT_SPEECH_RATE 說明）
const DIGIT_SPEECH_RATE = 1.8;

describe('handleTimerEvents: countdownWarning (10 seconds before the CURRENT interval ends, only for segments >20s; voice only, no beep at this point)', () => {
  it('shows a banner + speaks a fast, terse preview of the upcoming steady interval (no beep)', () => {
    const deps = makeDeps();
    // currentIntervalIndex 0 (warmup) is about to end; the upcoming interval is index 1 (steady, 88%)
    const state = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    // banner text stays the fuller existing format - no speech-timing constraint on visual text
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：20 秒 · 88% FTP', COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    // spoken preview is terser and spoken faster, so it has a chance to finish before the 5-second tick countdown begins
    expect(deps.speak).toHaveBeenCalledWith('下一組 88% 20 秒', FAST_PREVIEW_SPEECH_RATE);
    // the beep sequence only triggers off countdownTick at digit=3, not off countdownWarning
    expect(deps.playCountdownBeeps).not.toHaveBeenCalled();
  });

  it('shows the preview banner for at least the full 10-second countdown window (regression: the default 5s auto-hide left a blank gap for half the countdown)', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    const durationArg = deps.showNextIntervalBanner.mock.calls[0][1];
    expect(durationArg).toBeGreaterThanOrEqual(10000);
  });

  it('matches the "下一組：5 分鐘 · 75% FTP" banner format for a minute-scale steady interval', () => {
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
    expect(deps.speak).toHaveBeenCalledWith('下一組 75% 5 分鐘', FAST_PREVIEW_SPEECH_RATE);
  });

  it('shows/speaks a "XX% -> YY%" range (not a single number) when the upcoming interval ramps', () => {
    const deps = makeDeps();
    // currentIntervalIndex 2 (freeride) is about to end; upcoming is index 3 (cooldown, 60% -> 40%)
    const state = makeState({ currentIntervalIndex: 2 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：15 秒 · 60% → 40% FTP', COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.speak).toHaveBeenCalledWith('下一組 60% 到 40% 15 秒', FAST_PREVIEW_SPEECH_RATE);
  });

  it('applies the user\'s power adjustment to the previewed percentage', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 0, powerAdjustPct: 5 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：20 秒 · 93% FTP', COUNTDOWN_PREVIEW_BANNER_MS);
  });

  it('shows/speaks "自由騎乘" with no percentage when the upcoming interval is freeride', () => {
    const deps = makeDeps();
    // currentIntervalIndex 1 (steady) is about to end; upcoming is index 2 (freeride)
    const state = makeState({ currentIntervalIndex: 1 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：自由騎乘 · 10 秒', COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.speak).toHaveBeenCalledWith('下一組 自由騎乘 10 秒', FAST_PREVIEW_SPEECH_RATE);
  });

  it('shows/speaks "即將完成" instead of a nonexistent next interval when the CURRENT interval is the last one', () => {
    const deps = makeDeps();
    // currentIntervalIndex 3 (cooldown) is the last interval - there is no "next" interval
    const state = makeState({ currentIntervalIndex: 3 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith(COUNTDOWN_FINISHING_SOON_TEXT, COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('即將完成', COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.speak).toHaveBeenCalledWith('即將完成', FAST_PREVIEW_SPEECH_RATE);
  });
});

describe('handleTimerEvents: intervalChanged (unchanged existing format: mm:ss + watts, default banner duration)', () => {
  it('shows the next-interval banner with duration/%FTP/watts on intervalChanged', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    handleTimerEvents([TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：穩定 · 0:20 · 88% FTP · 176W');
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

    expect(deps.speak).toHaveBeenCalledTimes(1);
    // currentIntervalIndex=1 (steady) -> the upcoming/previewed interval is index 2 (freeride)
    expect(deps.speak).toHaveBeenCalledWith('下一組 自由騎乘 10 秒', FAST_PREVIEW_SPEECH_RATE);
    // both the countdown preview and the interval-changed banner fire; the last call is what's visible
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(2);
    expect(deps.showNextIntervalBanner).toHaveBeenLastCalledWith('下一組：穩定 · 0:20 · 88% FTP · 176W');
  });

  it('does nothing for workoutFinished or an empty event list', () => {
    const deps = makeDeps();
    handleTimerEvents([TIMER_EVENTS.WORKOUT_FINISHED], { workout: makeWorkout(), state: makeState(), ftp: 200, ...deps });
    handleTimerEvents([], { workout: makeWorkout(), state: makeState(), ftp: 200, ...deps });

    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.showNextIntervalBanner).not.toHaveBeenCalled();
  });
});

describe('handleTimerEvents: countdownTick (最後 5 秒逐秒語音報數，兩條路徑都有：不唸下一組預告，不顯示 banner；剩餘 3 秒額外觸發 playCountdownBeeps())', () => {
  it('speaks the current remaining second as a digit (e.g. "5"), no beep yet at digit 5', () => {
    const deps = makeDeps();
    // interval 1 (steady, duration 20) with elapsedInInterval=15 -> remaining=5
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 15 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledWith('5', DIGIT_SPEECH_RATE);
    expect(deps.playCountdownBeeps).not.toHaveBeenCalled();
    expect(deps.showNextIntervalBanner).not.toHaveBeenCalled();
  });

  it('speaks the digit at the faster DIGIT_SPEECH_RATE, not the default rate (regression: default rate=1 made a single digit take noticeably longer than the 1-second on-screen cadence, so the reported speech fell increasingly behind the visible countdown)', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 16 }); // remaining=4
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.speak).toHaveBeenCalledWith('4', DIGIT_SPEECH_RATE);
    expect(deps.playCountdownBeeps).not.toHaveBeenCalled();
  });

  it('speaks each of 5/4/3/2/1 correctly (at DIGIT_SPEECH_RATE) based on actual remaining time, never triggering playCountdownBeeps() (voice mode is beep-free even at digit 3)', () => {
    const deps = makeDeps(ALERT_MODE_VOICE);
    for (const [elapsedInInterval, expectedDigit] of [
      [15, '5'],
      [16, '4'],
      [17, '3'],
      [18, '2'],
      [19, '1'],
    ]) {
      deps.speak.mockClear();
      deps.playCountdownBeeps.mockClear();
      const state = makeState({ currentIntervalIndex: 1, elapsedInInterval });
      handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK], { workout: makeWorkout(), state, ftp: 200, ...deps });
      expect(deps.speak).toHaveBeenCalledWith(expectedDigit, DIGIT_SPEECH_RATE);
      expect(deps.playCountdownBeeps).not.toHaveBeenCalled();
    }
  });

  it('collapses multiple countdownTick occurrences in one batch (throttled tab catch-up) into a single speak() using the current actual remaining time, not stale skipped digits', () => {
    const deps = makeDeps();
    // remaining=2 "now", even though the batch has 4 entries (5,4,3,2 all crossed in one throttled tick)
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 18 });
    handleTimerEvents(
      [TIMER_EVENTS.COUNTDOWN_TICK, TIMER_EVENTS.COUNTDOWN_TICK, TIMER_EVENTS.COUNTDOWN_TICK, TIMER_EVENTS.COUNTDOWN_TICK],
      { workout: makeWorkout(), state, ftp: 200, ...deps }
    );

    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledWith('2', DIGIT_SPEECH_RATE);
    // digit collapsed to "2", not "3" - the beep should NOT fire here even though a
    // threshold of 3 was technically skipped over in this throttled batch
    expect(deps.playCountdownBeeps).not.toHaveBeenCalled();
  });

  it('(beep mode) a playCountdownBeeps() failure at digit 3 does not throw and is isolated', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps(ALERT_MODE_BEEP);
    deps.playCountdownBeeps.mockImplementation(() => {
      throw new Error('AudioContext boom');
    });
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 17 }); // remaining=3

    expect(() =>
      handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK], { workout: makeWorkout(), state, ftp: 200, ...deps })
    ).not.toThrow();

    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.playCountdownBeeps).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('does not interact with countdownWarning/intervalChanged handling when they arrive in the same batch', () => {
    const deps = makeDeps();
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK, TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    // elapsedInInterval=0 on a 20s interval -> remaining=20, not a real tick digit, but the
    // event is present regardless (engine guarantees it only fires for real 5/4/3/2/1 crossings -
    // this test only cares that intervalChanged's own banner still fires independently)
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：穩定 · 0:20 · 88% FTP · 176W');
  });

  it('a speak() failure during a countdown tick does not throw and is isolated', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps = makeDeps();
    deps.speak.mockImplementation(() => {
      throw new Error('SpeechSynthesis boom');
    });
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 15 });

    expect(() =>
      handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK], {
        workout: makeWorkout(),
        state,
        ftp: 200,
        ...deps,
      })
    ).not.toThrow();

    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('does nothing when countdownTick is absent from the event list', () => {
    const deps = makeDeps();
    handleTimerEvents([TIMER_EVENTS.WORKOUT_FINISHED], { workout: makeWorkout(), state: makeState(), ftp: 200, ...deps });
    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.playCountdownBeeps).not.toHaveBeenCalled();
  });
});

describe('handleTimerEvents: mode exclusivity (ALERT_MODE_VOICE vs ALERT_MODE_BEEP, 使用者在首頁二選一，見 alertModeStore.js)', () => {
  it('(beep mode) countdownWarning never calls speak(), but still shows the visual preview banner', () => {
    const deps = makeDeps(ALERT_MODE_BEEP);
    const state = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.speak).not.toHaveBeenCalled();
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：20 秒 · 88% FTP', COUNTDOWN_PREVIEW_BANNER_MS);
    expect(deps.playCountdownBeeps).not.toHaveBeenCalled();
  });

  it('(beep mode) countdownTick never calls speak() for any digit, and triggers playCountdownBeeps() exactly once, only at digit 3', () => {
    for (const [elapsedInInterval, expectedDigit] of [
      [15, '5'],
      [16, '4'],
      [17, '3'],
      [18, '2'],
      [19, '1'],
    ]) {
      const deps = makeDeps(ALERT_MODE_BEEP);
      const state = makeState({ currentIntervalIndex: 1, elapsedInInterval });
      handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK], { workout: makeWorkout(), state, ftp: 200, ...deps });
      expect(deps.speak).not.toHaveBeenCalled();
      expect(deps.playCountdownBeeps).toHaveBeenCalledTimes(expectedDigit === '3' ? 1 : 0);
    }
  });

  it('(beep mode) intervalChanged banner still shows (purely visual, unaffected by alertMode)', () => {
    const deps = makeDeps(ALERT_MODE_BEEP);
    const state = makeState({ currentIntervalIndex: 1, elapsedInInterval: 0, elapsedTotal: 12 });
    handleTimerEvents([TIMER_EVENTS.INTERVAL_CHANGED], { workout: makeWorkout(), state, ftp: 200, ...deps });

    expect(deps.showNextIntervalBanner).toHaveBeenCalledWith('下一組：穩定 · 0:20 · 88% FTP · 176W');
    expect(deps.speak).not.toHaveBeenCalled();
  });

  it('(voice mode) never calls playCountdownBeeps(), even across a full countdownWarning + countdownTick sequence', () => {
    const deps = makeDeps(ALERT_MODE_VOICE);
    const warningState = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state: warningState, ftp: 200, ...deps });
    const tickState = makeState({ currentIntervalIndex: 1, elapsedInInterval: 17 }); // remaining=3
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK], { workout: makeWorkout(), state: tickState, ftp: 200, ...deps });

    expect(deps.speak).toHaveBeenCalledTimes(2);
    expect(deps.playCountdownBeeps).not.toHaveBeenCalled();
  });

  it('switching alertMode between calls immediately changes behaviour, with no leftover state from the previous mode', () => {
    const speak = vi.fn();
    const playCountdownBeeps = vi.fn();
    const showNextIntervalBanner = vi.fn();
    const tickState = makeState({ currentIntervalIndex: 1, elapsedInInterval: 17 }); // remaining=3

    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK], {
      workout: makeWorkout(),
      state: tickState,
      ftp: 200,
      alertMode: ALERT_MODE_VOICE,
      speak,
      playCountdownBeeps,
      showNextIntervalBanner,
    });
    expect(speak).toHaveBeenCalledTimes(1);
    expect(playCountdownBeeps).not.toHaveBeenCalled();

    speak.mockClear();
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_TICK], {
      workout: makeWorkout(),
      state: tickState,
      ftp: 200,
      alertMode: ALERT_MODE_BEEP,
      speak,
      playCountdownBeeps,
      showNextIntervalBanner,
    });
    expect(speak).not.toHaveBeenCalled();
    expect(playCountdownBeeps).toHaveBeenCalledTimes(1);
  });
});

describe('handleTimerEvents: error isolation (regression - user reported "voice cut out partway through, rest of the alert vanished")', () => {
  // 使用者回報過「語音播放中途出錯，後續提示全部消失」——最像是某一段（例如
  // speak()）丟出沒被 catch 的例外，把同一次呼叫裡排在後面的程式碼整個中斷。
  // 這裡驗證語音預告／banner 互相獨立，任一段丟出例外都不會波及其他段，也
  // 不會讓例外一路往外拋、中斷呼叫端（見 countdownAlerts.js 的說明）。
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('speak() throwing does not prevent showNextIntervalBanner() from running, and does not propagate', () => {
    const deps = makeDeps();
    deps.speak.mockImplementation(() => {
      throw new Error('SpeechSynthesis boom');
    });
    const state = makeState({ currentIntervalIndex: 0 });

    expect(() => handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps })).not.toThrow();

    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.showNextIntervalBanner).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('showNextIntervalBanner() throwing during a countdownWarning does not propagate (speak already ran)', () => {
    const deps = makeDeps();
    deps.showNextIntervalBanner.mockImplementation(() => {
      throw new Error('DOM boom');
    });
    const state = makeState({ currentIntervalIndex: 0 });

    expect(() => handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state, ftp: 200, ...deps })).not.toThrow();

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

  it('a subsequent, independent countdownWarning call still speaks normally after a prior call\'s speak() failed (no lingering state corruption)', () => {
    const deps = makeDeps();
    deps.speak.mockImplementationOnce(() => {
      throw new Error('SpeechSynthesis boom');
    });
    const state0 = makeState({ currentIntervalIndex: 0 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state: state0, ftp: 200, ...deps });

    // second, independent call (e.g. the next interval's own countdown warning) - speak() no longer throws
    const state1 = makeState({ currentIntervalIndex: 2 });
    handleTimerEvents([TIMER_EVENTS.COUNTDOWN_WARNING], { workout: makeWorkout(), state: state1, ftp: 200, ...deps });

    expect(deps.speak).toHaveBeenCalledTimes(2);
  });
});

describe('unlockAudioAndSpeechForAutoplay (團體訓練排程：「設定開始時間」當下解鎖自動播放權限)', () => {
  // countdownAlerts.js 的 sharedAudioContext 是模組層級變數，playCountdownBeeps()
  // 也共用它——每個測試都用 vi.resetModules() + 動態 import 拿一份全新的模組
  // 實例，避免某個測試建立過 AudioContext 之後，後面的測試誤判成「沒有再建立
  // 一個新的」。
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubAudioContext() {
    const oscillator = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: {} };
    const gain = { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } };
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
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0, ctx.currentTime); // silent, not the audible peak gain playCountdownBeeps uses
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

describe('playCountdownBeeps (regression: Google Meet tab-audio sharing does not capture SpeechSynthesis, but does capture Web Audio API output)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubAudioContext(initialState) {
    const oscillators = [];
    const gains = [];
    const ctx = {
      createOscillator: vi.fn(() => {
        const oscillator = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: {} };
        oscillators.push(oscillator);
        return oscillator;
      }),
      createGain: vi.fn(() => {
        const gain = { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } };
        gains.push(gain);
        return gain;
      }),
      destination: {},
      currentTime: 100, // arbitrary non-zero baseline to prove offsets are relative, not absolute
      state: initialState,
      resume: vi.fn(),
    };
    const AudioContextCtor = vi.fn(() => ctx);
    vi.stubGlobal('AudioContext', AudioContextCtor);
    return { AudioContextCtor, ctx, oscillators, gains };
  }

  it('schedules exactly 3 short tones at 1-second offsets from the current AudioContext time', async () => {
    const { ctx, oscillators } = stubAudioContext('running');
    const { playCountdownBeeps } = await import('../src/ui/countdownAlerts.js');

    playCountdownBeeps();

    expect(oscillators).toHaveLength(3);
    expect(oscillators[0].start).toHaveBeenCalledWith(100);
    expect(oscillators[1].start).toHaveBeenCalledWith(101);
    expect(oscillators[2].start).toHaveBeenCalledWith(102);
    // each tone stops shortly after it starts (short "beep", not a sustained tone)
    expect(oscillators[0].stop).toHaveBeenCalledWith(100.25);
  });

  it('uses a higher pitch than the old single tone (crisper "beep" rather than a duller "boop")', async () => {
    const { oscillators } = stubAudioContext('running');
    const { playCountdownBeeps } = await import('../src/ui/countdownAlerts.js');

    playCountdownBeeps();

    for (const oscillator of oscillators) {
      expect(oscillator.frequency.value).toBeGreaterThan(880); // old tone was 880Hz
    }
  });

  it('uses an attack/sustain/release gain envelope, not an instant jump to peak followed by continuous decay (regression: users reported the old envelope sounding like a "噹" bell/chime hit rather than a flat "嗶" beep)', async () => {
    const { gains } = stubAudioContext('running');
    const { playCountdownBeeps } = await import('../src/ui/countdownAlerts.js');

    playCountdownBeeps();

    expect(gains).toHaveLength(3);
    const [firstGain] = gains;

    // starts silent, ramps up to peak (attack) - not an instant step to peak
    expect(firstGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 100);
    expect(firstGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(expect.any(Number), 100.01);
    const [attackPeakGain] = firstGain.gain.linearRampToValueAtTime.mock.calls[0];
    expect(attackPeakGain).toBeGreaterThan(0.2); // louder than the old 0.2 peak gain

    // holds flat at peak for a sustain window before releasing, not decaying continuously
    expect(firstGain.gain.setValueAtTime).toHaveBeenCalledWith(attackPeakGain, 100.2); // 100 + (0.25 duration - 0.05 release)

    // releases down to near-zero only at the very end
    expect(firstGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0001, 100.25);
  });

  it('calls ctx.resume() before scheduling when the shared AudioContext is suspended (e.g. after SpeechSynthesis interrupted it)', async () => {
    const { ctx, oscillators } = stubAudioContext('suspended');
    const { playCountdownBeeps } = await import('../src/ui/countdownAlerts.js');

    playCountdownBeeps();

    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(3);
  });

  it('does not call ctx.resume() when the context is already running (no unnecessary calls)', async () => {
    const { ctx } = stubAudioContext('running');
    const { playCountdownBeeps } = await import('../src/ui/countdownAlerts.js');

    playCountdownBeeps();

    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('does not throw when AudioContext is unavailable (e.g. an unsupported browser)', async () => {
    const { playCountdownBeeps } = await import('../src/ui/countdownAlerts.js');
    expect(() => playCountdownBeeps()).not.toThrow();
  });
});

describe('speakCountdownWarning (regression: fast preview speech and digit countdown speech both need controllable, non-default rates)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubSpeechSynthesis() {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(text) {
          this.text = text;
          this.lang = '';
          this.rate = 1;
        }
      }
    );
    return { speak };
  }

  it('defaults to rate 1 (normal speed) when no rate argument is given', async () => {
    const { speak } = stubSpeechSynthesis();
    const { speakCountdownWarning } = await import('../src/ui/countdownAlerts.js');

    speakCountdownWarning('5');

    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0].rate).toBe(1);
  });

  it('applies a custom rate when given (used by the fast next-interval preview)', async () => {
    const { speak } = stubSpeechSynthesis();
    const { speakCountdownWarning } = await import('../src/ui/countdownAlerts.js');

    speakCountdownWarning('下一組 75% 5 分鐘', 1.35);

    expect(speak.mock.calls[0][0].rate).toBe(1.35);
  });

  it('does not throw when speechSynthesis is unavailable', async () => {
    const { speakCountdownWarning } = await import('../src/ui/countdownAlerts.js');
    expect(() => speakCountdownWarning('5')).not.toThrow();
  });
});
