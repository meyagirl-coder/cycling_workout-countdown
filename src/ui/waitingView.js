import { formatDurationLabel } from './formatTime.js';
import { formatRemainingLabel } from './scheduledStartRuntime.js';

/**
 * 團體訓練排程的「等待畫面」：設定了開始時間、時間還沒到時顯示，取代平常
 * 「載入完課表就進執行頁」的流程。顯示課表基本資訊（名稱／總時長／組數）
 * 加上大字倒數「距離開始還有 X天Y小時Z分W秒」（精確到秒，每秒即時更新，
 * 見 scheduledStartRuntime.js 的 formatRemainingLabel()）；並明確提示
 * 使用者分頁不能完全關閉，否則自動開始可能失效。純 DOM 渲染邏輯，不碰計時／
 * localStorage——呼叫端（playerApp.js）負責用 scheduledStartRuntime.js 算出
 * 剩餘時間，這裡只負責畫出來。
 *
 * @param {HTMLElement} rootEl
 * @param {{onCancelSchedule: () => void}} handlers
 */
export function createWaitingView(rootEl, handlers) {
  rootEl.innerHTML = `
    <div class="waiting-screen">
      <p class="waiting-label">團體訓練排程中</p>
      <h1 class="waiting-workout-name"></h1>
      <p class="waiting-workout-meta"></p>

      <div class="waiting-countdown"></div>

      <p class="waiting-warning">
        提醒：如果這個分頁被完全關閉，或裝置長時間背景休眠導致系統回收資源，時間到「自動開始」可能會失效。建議在排定時間前，至少重新打開一次這個分頁確認狀態（不需要一直盯著，但請不要完全關閉瀏覽器）。
      </p>

      <button type="button" class="btn btn-danger btn-cancel-schedule">取消排程</button>
    </div>
  `;

  const els = {
    workoutName: rootEl.querySelector('.waiting-workout-name'),
    workoutMeta: rootEl.querySelector('.waiting-workout-meta'),
    countdown: rootEl.querySelector('.waiting-countdown'),
    cancelBtn: rootEl.querySelector('.btn-cancel-schedule'),
  };

  els.cancelBtn.addEventListener('click', () => handlers.onCancelSchedule());

  /**
   * @param {object} workout
   * @param {number} remainingMs
   */
  function update(workout, remainingMs) {
    els.workoutName.textContent = workout.name;
    els.workoutMeta.textContent = `總時長 ${formatDurationLabel(workout.totalDuration)} · 共 ${workout.intervals.length} 組`;
    els.countdown.textContent = formatRemainingLabel(remainingMs);
  }

  return { update };
}
