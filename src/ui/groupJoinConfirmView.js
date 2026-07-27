import { formatDateTimeLabel, formatMinuteSecondLabel } from './formatTime.js';

/**
 * 「一鍵開團連結」加入前的確認橫幅（規格：解決 iOS Safari/Chrome 上開團連結
 * 完全無聲的問題，見沿革）。
 *
 * 一頁式呈現（規格：減少確認畫面跟課表執行畫面切換時的跳動感）：這個橫幅
 * 疊在執行頁（playerMount）上方一起顯示，playerApp.js 在顯示確認橫幅的
 * 同時就已經呼叫 client.init(workout) 讓下面的執行頁（時間軸／下一組資訊
 * 等）先渲染成「尚未開始」的預覽狀態——使用者按下「加入團練」前就能先看到
 * 完整課表樣貌，不是進了另一個畫面才看到。因為執行頁本身已經會顯示課表
 * 名稱／總時長／組數（`.workout-name`／`.total-duration`／
 * `.interval-progress`），這個橫幅不重複顯示同樣的資訊，只放「橫幅本身
 * 特有」的內容：邀請標籤、排定開始時間、已經過去多久、確認按鈕。
 *
 * 沿革：開團連結是頁面載入當下自動觸發的，不是使用者按鈕點擊——瀏覽器的
 * 自動播放權限解鎖（unlockAudioAndSpeechForAutoplay()）需要「使用者互動
 * 當下」的呼叫堆疊才保證有效，單靠頁面載入自動呼叫無法穩定解鎖（真機實測
 * 仍然無聲）。這裡改成先顯示這個確認橫幅，使用者按下按鈕的當下才是真正的
 * 使用者互動，解鎖跟「設定開始時間」按鈕用的是同一套機制（見
 * playerApp.js 的 handleGroupJoinConfirm()）。
 *
 * 純畫面渲染，不碰計時／localStorage／解鎖邏輯本身。
 *
 * @param {HTMLElement} rootEl
 * @param {{onConfirmJoin: () => void}} handlers
 */
export function createGroupJoinConfirmView(rootEl, handlers) {
  rootEl.innerHTML = `
    <div class="group-join-confirm-banner">
      <p class="group-join-confirm-label">團體訓練邀請</p>
      <p class="group-join-confirm-start-time"></p>
      <p class="group-join-confirm-elapsed"></p>
      <button type="button" class="btn btn-primary btn-group-join-confirm">加入團練</button>
    </div>
  `;

  const els = {
    startTime: rootEl.querySelector('.group-join-confirm-start-time'),
    elapsed: rootEl.querySelector('.group-join-confirm-elapsed'),
    confirmBtn: rootEl.querySelector('.btn-group-join-confirm'),
  };

  els.confirmBtn.addEventListener('click', () => handlers.onConfirmJoin());

  /**
   * @param {number} startTimestamp - 排定開始時間的 epoch ms
   */
  function update(startTimestamp) {
    els.startTime.textContent = `開始時間：${formatDateTimeLabel(new Date(startTimestamp))}`;

    const elapsedSeconds = (Date.now() - startTimestamp) / 1000;
    // 排定時間還沒到就顯示「尚未開始」；已經過去就明確告知已經過去多久
    // ——讓使用者在按下確認前，就知道自己按下去會直接跳到對應的進度，
    // 不是從頭開始（規格：跟 armSchedule()／startScheduledWorkoutNow() 的
    // 「遲到追上進度」行為互相呼應）。
    els.elapsed.textContent = elapsedSeconds > 0 ? `已進行 ${formatMinuteSecondLabel(elapsedSeconds)}` : '尚未開始';
  }

  return { update };
}
