import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIMER_EVENTS, createTimerEngine } from '../src/engine/timerEngine.js';
import { parseZwoXml } from '../src/parser/zwoParser.js';
import { handleTimerEvents } from '../src/ui/countdownAlerts.js';
import { createPlayerView } from '../src/ui/renderPlayer.js';
import { saveWorkoutProgress } from '../src/ui/workoutProgressStore.js';

/**
 * 回歸測試：完整跑一遍真實使用者回報過的 .zwo 檔案，不只是解析成 JSON
 * 就好，而是模擬整個播放流程（timerEngine.tick() -> renderPlayer.update()
 * -> countdownAlerts.handleTimerEvents() -> workoutProgressStore 存檔），
 * 用跟真正 Web Worker 一樣的 200ms tick 間隔，從頭跑到「課表完成」，確保
 * 中途不會有任何一步丟出例外——這是使用者回報「上傳後播放到一半畫面當掉」
 * 時最貼近真實情境的驗證方式（比單純呼叫 parseZwoXml() 更完整，那種測試法
 * 測不出「解析成功、但播放到某個時間點時算 target/渲染畫面時噴例外」這種
 * 問題）。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

function loadFixture(filename) {
  return readFileSync(join(FIXTURES_DIR, filename), 'utf-8');
}

/**
 * 用 200ms（跟 workerRuntime.js 的 DEFAULT_TICK_INTERVAL_MS 一致）為間隔，
 * 從頭到尾把整份課表播完，每一步都經過渲染／提示邏輯／存檔，回傳最終狀態；
 * 任何一步丟出例外都直接讓呼叫端的 expect(...).not.toThrow() 抓到。
 */
function simulateFullPlayback(workout, { ftp = 200, tickIntervalMs = 200 } = {}) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = document.getElementById('root');
  const playerView = createPlayerView(root, {
    onPlayPause: () => {},
    onSkip: () => {},
    onRedo: () => {},
    onStop: () => {},
    onReturnHome: () => {},
  });

  const engine = createTimerEngine(workout);
  engine.play(0);

  const totalMs = workout.totalDuration * 1000;
  let finalState = null;

  for (let now = 0; now <= totalMs + tickIntervalMs * 2; now += tickIntervalMs) {
    const { state, events } = engine.tick(now);

    playerView.update(workout, state, ftp);
    handleTimerEvents(events, {
      workout,
      state,
      ftp,
      alertMode: 'voice',
      speak: () => {},
      playCountdownBeeps: () => {},
      showNextIntervalBanner: playerView.showNextIntervalBanner,
    });
    saveWorkoutProgress(workout, state);

    finalState = state;
    if (state.status === 'finished') break;
  }

  return { finalState, playerView, root };
}

describe('regression: IntervalCoach 閾值衝刺 (real-world intervals.icu export with 5 identical repeated Threshold/Surge/Recovery blocks)', () => {
  it('parses into 18 intervals with the expected repeated structure (5x Threshold-band/Surge/Recovery), no two adjacent blocks merged or dropped', () => {
    const workout = parseZwoXml(loadFixture('IntervalCoach_閾值衝刺_正確版.zwo'));

    expect(workout.intervals).toHaveLength(18);
    expect(workout.totalDuration).toBe(5310);

    // opening warmup-style steady block
    expect(workout.intervals[0]).toMatchObject({ type: 'steady', duration: 720, powerStart: 50, powerEnd: 50 });

    // 5x repeated Threshold(95-100% band, held at the 98% midpoint - not a
    // ramp, see zwoParser.js's SteadyState PowerLow/PowerHigh rationale)/
    // Surge(120% steady)/Recovery(60% steady)
    for (let rep = 0; rep < 5; rep++) {
      const base = 1 + rep * 3;
      expect(workout.intervals[base]).toMatchObject({ type: 'steady', duration: 600, powerStart: 98, powerEnd: 98 });
      expect(workout.intervals[base + 1]).toMatchObject({ type: 'steady', duration: 30, powerStart: 120, powerEnd: 120 });
      expect(workout.intervals[base + 2]).toMatchObject({ type: 'steady', duration: 120, powerStart: 60, powerEnd: 60 });
    }

    // closing Hard Finish + cooldown-style steady block
    expect(workout.intervals[16]).toMatchObject({ type: 'steady', duration: 300, powerStart: 100, powerEnd: 100 });
    expect(workout.intervals[17]).toMatchObject({ type: 'steady', duration: 540, powerStart: 50, powerEnd: 50 });
  });

  it('plays through the entire workout (5310s) at the real 200ms worker tick interval without throwing, ending cleanly in "finished"', () => {
    const workout = parseZwoXml(loadFixture('IntervalCoach_閾值衝刺_正確版.zwo'));

    let result;
    expect(() => {
      result = simulateFullPlayback(workout);
    }).not.toThrow();

    expect(result.finalState.status).toBe('finished');
    expect(result.finalState.elapsedTotal).toBe(workout.totalDuration);
  });

  it('never shows the placeholder "--"/"0:00" once playback has actually progressed past the first tick (regression for the reported "stuck at 0:00, watts show --" freeze)', () => {
    const workout = parseZwoXml(loadFixture('IntervalCoach_閾值衝刺_正確版.zwo'));

    document.body.innerHTML = '<div id="root"></div>';
    const root = document.getElementById('root');
    const playerView = createPlayerView(root, {
      onPlayPause: () => {},
      onSkip: () => {},
      onRedo: () => {},
      onStop: () => {},
      onReturnHome: () => {},
    });

    const engine = createTimerEngine(workout);
    engine.play(0);

    // sample right after the first real tick (1s in) - if update() throws before
    // it gets to set countdownNumber/targetWatt, they would still show the raw
    // HTML placeholders ("0:00"/"--") from createPlayerView()'s initial markup
    const { state } = engine.tick(1000);
    playerView.update(workout, state, 200);

    expect(playerView.elements.targetWatt.textContent).not.toBe('--');
    expect(playerView.elements.countdownNumber.textContent).not.toBe('0:00');
  });

  it('correctly transitions across every one of the 5 repeated Threshold/Surge/Recovery cycles (regression for a possible "duplicate block" index-lookup bug)', () => {
    const workout = parseZwoXml(loadFixture('IntervalCoach_閾值衝刺_正確版.zwo'));
    const engine = createTimerEngine(workout);
    engine.play(0);

    const seenIndices = [];
    let lastIndex = -1;
    for (let now = 0; now <= workout.totalDuration * 1000; now += 1000) {
      const { state } = engine.tick(now);
      if (state.currentIntervalIndex !== lastIndex) {
        seenIndices.push(state.currentIntervalIndex);
        lastIndex = state.currentIntervalIndex;
      }
    }

    // must visit every interval index exactly once, strictly in order (0..17) -
    // a broken "find next interval" implementation that got confused by
    // identical-duration repeated blocks would show a skipped or repeated index here
    expect(seenIndices).toEqual(Array.from({ length: 18 }, (_, i) => i));
  });
});

/**
 * 回歸測試（規格要求：連續多個相同時長短組別的情境，未來不能再壞掉）：
 * 使用者回報用 IntervalCoach_節奏推升間歇.zwo（開頭/結尾各 15/10 個連續
 * 60 秒小組、中間穿插 4 個 840 秒長組別，共 34 組）時，逼逼聲模式完全沒有
 * 聲音，語音模式正常——診斷後發現根本原因不是「上一組音效物件沒清理乾淨」
 * （那個假設在 handleTimerEvents() 的觸發時機層級驗證下不成立，見下方第一個
 * 測試），而是 playCountdownBeeps()（countdownAlerts.js）呼叫 ctx.resume()
 * 之後沒有真的等 Promise resolve 就搶先排程音效節點：每組只有最後 3 秒有
 * 聲音，中間長時間靜音會讓瀏覽器自動把 AudioContext 悄悄 suspend，下一次
 * 觸發時幾乎每次都會撞上「還沒真的 resume 完成」的狀態，實測會完全沒有
 * 聲音、但不會拋出任何例外。這裡用一個「每次都回報自己是 suspended」的假
 * AudioContext（模擬最壞情況：每次觸發前都已經被自動休眠），跑完整份真實
 * 課表的 200ms tick 模擬，證明修好之後每一次 COUNTDOWN_TICK 觸發都真的排程
 * 出 3 聲嗶聲，不會因為連續多個短組別而漏掉。
 */
describe('regression: beep mode across many consecutive short intervals (IntervalCoach_節奏推升間歇.zwo - reported "beep mode is completely silent" bug)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubAlwaysSuspendedAudioContext() {
    const oscillators = [];
    const ctx = {
      createOscillator: vi.fn(() => {
        const oscillator = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: {} };
        oscillators.push(oscillator);
        return oscillator;
      }),
      createGain: vi.fn(() => ({ connect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } })),
      destination: {},
      currentTime: 0,
      // 每次都回報 suspended，模擬「每次觸發前都已經被瀏覽器自動休眠」的
      // 最壞情況（見上方模組註解）——resume() 回傳一個真的 Promise，不是
      // 同步 resolve，逼近真實瀏覽器的非同步行為。
      state: 'suspended',
      resume: vi.fn(() => Promise.resolve()),
    };
    vi.stubGlobal('AudioContext', vi.fn(() => ctx));
    return { oscillators };
  }

  it('logic layer: handleTimerEvents() triggers playCountdownBeeps() exactly once per interval that is long enough to have a countdown, with no missed or duplicate triggers across all 34 intervals (rules out a stale-scheduling/conflict bug at the trigger-logic level)', () => {
    const workout = parseZwoXml(loadFixture('IntervalCoach_節奏推升間歇.zwo'));
    const engine = createTimerEngine(workout);
    engine.play(0);

    let beepCallCount = 0;
    const totalMs = workout.totalDuration * 1000;
    for (let now = 0; now <= totalMs + 400; now += 200) {
      const { state, events } = engine.tick(now);
      handleTimerEvents(events, {
        workout,
        state,
        ftp: 200,
        alertMode: 'beep',
        speak: () => {},
        playCountdownBeeps: () => beepCallCount++,
        showNextIntervalBanner: () => {},
      });
      if (state.status === 'finished') break;
    }

    // every one of the 34 intervals is long enough (>20s, well above the
    // short-interval threshold) to reach a "3 seconds remaining" countdown tick
    expect(beepCallCount).toBe(34);
  });

  it('audio layer: the real playCountdownBeeps() actually schedules all 3 tones on every single trigger, even when the shared AudioContext reports itself as suspended every time (worst-case auto-suspend between the ~57s of silence in each 60s interval) - regression for the real root cause (resume() not being awaited before scheduling)', async () => {
    const { oscillators } = stubAlwaysSuspendedAudioContext();
    const { playCountdownBeeps } = await import('../src/ui/countdownAlerts.js');

    const workout = parseZwoXml(loadFixture('IntervalCoach_節奏推升間歇.zwo'));
    const engine = createTimerEngine(workout);
    engine.play(0);

    let beepCallCount = 0;
    let checkedFirstTriggerIsDeferred = false;
    const totalMs = workout.totalDuration * 1000;
    for (let now = 0; now <= totalMs + 400; now += 200) {
      const { state, events } = engine.tick(now);
      if (events.includes(TIMER_EVENTS.COUNTDOWN_TICK)) {
        // mirrors handleTimerEvents()'s own digit===3 gating (see
        // countdownAlerts.js) without re-importing its private helpers
        const iv = workout.intervals[state.currentIntervalIndex];
        const remaining = Math.round(iv.duration - state.elapsedInInterval);
        if (remaining === 3) {
          beepCallCount++;
          playCountdownBeeps();

          // regression: on the very first trigger, no tones may be scheduled
          // yet (the loop hasn't awaited anything, so the resume().then(...)
          // microtask is still pending) - this is what actually catches the
          // root-cause bug; the final total-count assertion below would
          // still pass even with the old buggy code, since it doesn't care
          // WHEN the tones were scheduled, only that they eventually were.
          if (!checkedFirstTriggerIsDeferred) {
            checkedFirstTriggerIsDeferred = true;
            expect(oscillators).toHaveLength(0);
          }
        }
      }
      if (state.status === 'finished') break;
    }

    expect(beepCallCount).toBe(34);
    // the fix defers scheduling until resume() resolves (a microtask) - flush
    // it before counting the actually-scheduled tones
    await Promise.resolve();
    await Promise.resolve();

    expect(oscillators).toHaveLength(34 * 3);
  });
});
