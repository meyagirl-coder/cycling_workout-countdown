import { formatDateTimeLabel, formatDurationLabel } from './formatTime.js';

/**
 * 「一鍵開團連結」加入前的確認畫面（規格：解決 iOS Safari/Chrome 上開團連結
 * 完全無聲的問題）。
 *
 * 開團連結是頁面載入當下自動觸發的，不是使用者按鈕點擊——瀏覽器的自動播放
 * 權限解鎖（unlockAudioAndSpeechForAutoplay()）需要「使用者互動當下」的
 * 呼叫堆疊才保證有效，單靠頁面載入自動呼叫無法穩定解鎖（見 playerApp.js 先前
 * 的「賭一把」版本，真機實測仍然無聲）。這裡改成先顯示這個確認畫面（課表
 * 名稱／總時長／組數／排定開始時間 ＋ 一顆「加入團練」按鈕），使用者按下
 * 按鈕的當下才是真正的使用者互動，解鎖跟「設定開始時間」按鈕用的是同一套
 * 機制（unlockAudioAndSpeechForAutoplay()），才能保證後續自動觸發的語音／
 * 嗶聲正常播放。
 *
 * 純畫面渲染，不碰計時／localStorage／解鎖邏輯本身——呼叫端（playerApp.js）
 * 負責在 onConfirmJoin 裡呼叫解鎖跟後續的排程判斷。
 *
 * @param {HTMLElement} rootEl
 * @param {{onConfirmJoin: () => void}} handlers
 */
export function createGroupJoinConfirmView(rootEl, handlers) {
  rootEl.innerHTML = `
    <div class="group-join-confirm-screen">
      <p class="group-join-confirm-label">團體訓練邀請</p>
      <h1 class="group-join-confirm-workout-name"></h1>
      <p class="group-join-confirm-workout-meta"></p>
      <p class="group-join-confirm-start-time"></p>
      <button type="button" class="btn btn-primary btn-group-join-confirm">加入團練</button>
    </div>
  `;

  const els = {
    workoutName: rootEl.querySelector('.group-join-confirm-workout-name'),
    workoutMeta: rootEl.querySelector('.group-join-confirm-workout-meta'),
    startTime: rootEl.querySelector('.group-join-confirm-start-time'),
    confirmBtn: rootEl.querySelector('.btn-group-join-confirm'),
  };

  els.confirmBtn.addEventListener('click', () => handlers.onConfirmJoin());

  /**
   * @param {object} workout
   * @param {number} startTimestamp - 排定開始時間的 epoch ms
   */
  function update(workout, startTimestamp) {
    els.workoutName.textContent = workout.name;
    els.workoutMeta.textContent = `總時長 ${formatDurationLabel(workout.totalDuration)} · 共 ${workout.intervals.length} 組`;
    els.startTime.textContent = `開始時間：${formatDateTimeLabel(new Date(startTimestamp))}`;
  }

  return { update };
}
