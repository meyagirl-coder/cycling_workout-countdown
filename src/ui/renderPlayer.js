import { computeCurrentTarget } from '../engine/timerEngine.js';
import { formatDurationLabel, formatMMSS } from './formatTime.js';
import { INTERVAL_TYPE_LABELS } from './intervalLabels.js';
import { buildIntervalBoundaries, buildTimelineSegments, computeCursorPct } from './timelineSegments.js';

const STATUS_LABELS = {
  idle: '尚未開始',
  running: '進行中',
  paused: '已暫停',
  finished: '已完成',
};

/** 剩餘時間 <= 這個秒數且本組時長 > 這個秒數才進入「倒數提示」視覺狀態（規格 §4.4） */
const COUNTDOWN_URGENT_SECONDS = 10;

/** 「下一組」提示 banner 顯示多久後自動收起 */
const NEXT_INTERVAL_BANNER_MS = 5000;

/**
 * 建立執行頁 UI（規格 §5）：課表名稱/總時長/目前組別、時間軸圖、大數字倒數、
 * target watt、播放/暫停/跳組/重做/提早結束按鈕。純 DOM 渲染邏輯，不碰計時
 * 引擎或 Worker —— 呼叫端把最新的 {status, currentIntervalIndex,
 * elapsedInInterval, elapsedTotal, powerAdjustPct} 丟進 update() 就好。
 *
 * @param {HTMLElement} rootEl
 * @param {{onPlayPause: () => void, onSkip: () => void, onRedo: () => void, onStop: () => void}} handlers
 */
export function createPlayerView(rootEl, handlers) {
  rootEl.innerHTML = `
    <div class="player">
      <header class="player-header">
        <h1 class="workout-name"></h1>
        <div class="workout-meta">
          <span class="total-duration"></span>
          <span class="interval-progress"></span>
        </div>
      </header>

      <div class="timeline">
        <div class="timeline-track"></div>
        <div class="timeline-cursor"></div>
      </div>

      <div class="next-interval-banner hidden"></div>

      <div class="status-panel">
        <div class="countdown-block">
          <div class="countdown-number">0:00</div>
          <div class="countdown-label">本組剩餘</div>
        </div>
        <div class="target-block">
          <div class="target-watt">--</div>
          <div class="target-pct"></div>
        </div>
      </div>

      <div class="controls">
        <button type="button" class="btn btn-skip">跳組</button>
        <button type="button" class="btn btn-play-pause btn-primary">▶ 開始</button>
        <button type="button" class="btn btn-redo">重做本組</button>
        <button type="button" class="btn btn-stop btn-danger">提早結束</button>
      </div>

      <div class="finished-banner hidden">課表完成！</div>
    </div>
  `;

  const els = {
    player: rootEl.querySelector('.player'),
    workoutName: rootEl.querySelector('.workout-name'),
    totalDuration: rootEl.querySelector('.total-duration'),
    intervalProgress: rootEl.querySelector('.interval-progress'),
    timelineTrack: rootEl.querySelector('.timeline-track'),
    timelineCursor: rootEl.querySelector('.timeline-cursor'),
    nextIntervalBanner: rootEl.querySelector('.next-interval-banner'),
    statusPanel: rootEl.querySelector('.status-panel'),
    countdownNumber: rootEl.querySelector('.countdown-number'),
    countdownLabel: rootEl.querySelector('.countdown-label'),
    targetWatt: rootEl.querySelector('.target-watt'),
    targetPct: rootEl.querySelector('.target-pct'),
    playPauseBtn: rootEl.querySelector('.btn-play-pause'),
    skipBtn: rootEl.querySelector('.btn-skip'),
    redoBtn: rootEl.querySelector('.btn-redo'),
    stopBtn: rootEl.querySelector('.btn-stop'),
    finishedBanner: rootEl.querySelector('.finished-banner'),
  };

  els.playPauseBtn.addEventListener('click', () => handlers.onPlayPause());
  els.skipBtn.addEventListener('click', () => handlers.onSkip());
  els.redoBtn.addEventListener('click', () => handlers.onRedo());
  els.stopBtn.addEventListener('click', () => handlers.onStop());

  let renderedTimelineKey = null;

  function renderTimelineIfNeeded(workout, adjustPct) {
    const key = `${workout.id}::${adjustPct}`;
    if (renderedTimelineKey === key) return;
    renderedTimelineKey = key;

    // 顏色分段用瞬時功率區間（跟大字卡片背景色同一套 getZoneColor 邏輯）；
    // 分隔線另外疊在上面，不管相鄰顏色是否相同都要看得出組別交界。
    const segments = buildTimelineSegments(workout, adjustPct);
    const segmentsHtml = segments
      .map(
        (seg) =>
          `<div class="timeline-segment ${seg.color ? `zone-${seg.color}` : 'zone-none'}" style="left:${seg.startPct}%;width:${seg.widthPct}%" title="${INTERVAL_TYPE_LABELS[seg.type]}"></div>`
      )
      .join('');

    const dividersHtml = buildIntervalBoundaries(workout)
      .map((pct) => `<div class="timeline-divider" style="left:${pct}%"></div>`)
      .join('');

    els.timelineTrack.innerHTML = segmentsHtml + dividersHtml;
  }

  function update(workout, state, ftp) {
    renderTimelineIfNeeded(workout, state.powerAdjustPct);

    els.workoutName.textContent = workout.name;
    els.totalDuration.textContent = `總時長 ${formatDurationLabel(workout.totalDuration)}`;
    els.intervalProgress.textContent = `第 ${state.currentIntervalIndex + 1} / ${workout.intervals.length} 組 · ${STATUS_LABELS[state.status]}`;

    els.timelineCursor.style.left = `${computeCursorPct(state.elapsedTotal, workout.totalDuration)}%`;

    const currentInterval = workout.intervals[state.currentIntervalIndex];
    const remaining = currentInterval.duration - state.elapsedInInterval;
    els.countdownNumber.textContent = formatMMSS(remaining);
    els.countdownLabel.textContent = `本組剩餘 · ${INTERVAL_TYPE_LABELS[currentInterval.type]}`;

    // 剩餘 <=10 秒且本組時長 >10 秒才進入倒數提示視覺狀態，避免短組被誤判（規格 §4.4）
    const isCountdownUrgent = currentInterval.duration > COUNTDOWN_URGENT_SECONDS && remaining > 0 && remaining <= COUNTDOWN_URGENT_SECONDS;
    els.countdownNumber.classList.toggle('countdown-urgent', isCountdownUrgent);

    const target = computeCurrentTarget(workout, state.currentIntervalIndex, state.elapsedInInterval, ftp, state.powerAdjustPct);
    if (target.watts === null) {
      els.targetWatt.textContent = '自由騎乘';
      els.targetPct.textContent = '';
      els.statusPanel.className = 'status-panel zone-none';
    } else {
      els.targetWatt.textContent = `${target.watts} W`;
      els.targetPct.textContent = `${Math.round(target.pct)}% FTP`;
      els.statusPanel.className = `status-panel zone-${target.zoneColor.color}`;
    }

    const isRunning = state.status === 'running';
    const isFinished = state.status === 'finished';
    els.playPauseBtn.textContent = isRunning ? '⏸ 暫停' : '▶ 開始';
    els.playPauseBtn.disabled = isFinished;
    els.skipBtn.disabled = isFinished;
    els.redoBtn.disabled = isFinished;
    els.stopBtn.disabled = isFinished;
    els.finishedBanner.classList.toggle('hidden', !isFinished);
  }

  let nextIntervalBannerTimeoutId = null;

  /** 切組瞬間顯示下一組資訊（時間/%FTP/瓦數），幾秒後自動收起（規格 §4.4） */
  function showNextIntervalBanner(text) {
    els.nextIntervalBanner.textContent = text;
    els.nextIntervalBanner.classList.remove('hidden');

    if (nextIntervalBannerTimeoutId !== null) clearTimeout(nextIntervalBannerTimeoutId);
    nextIntervalBannerTimeoutId = setTimeout(() => {
      els.nextIntervalBanner.classList.add('hidden');
      nextIntervalBannerTimeoutId = null;
    }, NEXT_INTERVAL_BANNER_MS);
  }

  return { update, showNextIntervalBanner, elements: els };
}
