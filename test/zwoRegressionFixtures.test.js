import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createTimerEngine } from '../src/engine/timerEngine.js';
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
  it('parses into 18 intervals with the expected repeated structure (5x Threshold-ramp/Surge/Recovery), no two adjacent blocks merged or dropped', () => {
    const workout = parseZwoXml(loadFixture('IntervalCoach_閾值衝刺_正確版.zwo'));

    expect(workout.intervals).toHaveLength(18);
    expect(workout.totalDuration).toBe(5310);

    // opening warmup-style steady block
    expect(workout.intervals[0]).toMatchObject({ type: 'steady', duration: 720, powerStart: 50, powerEnd: 50 });

    // 5x repeated Threshold(ramp 95->100%)/Surge(120% steady)/Recovery(60% steady)
    for (let rep = 0; rep < 5; rep++) {
      const base = 1 + rep * 3;
      expect(workout.intervals[base]).toMatchObject({ type: 'ramp', duration: 600, powerStart: 95, powerEnd: 100 });
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
