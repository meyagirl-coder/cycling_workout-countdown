import { formatDateTimeLabel, formatMinuteSecondLabel } from './formatTime.js';
import { formatRemainingLabel } from './scheduledStartRuntime.js';

/**
 * 團體訓練排程的「確認／等待」橫幅——雖然檔名跟大部分命名還留著「開團連結」
 * 這個歷史名稱（最早只是為了解決開團連結的問題才做的），但等待階段
 * （showWaitingPhase()／updateWaitingCountdown()）現在是三條路徑共用：
 * 手動「設定開始時間」＋送出課表、開團連結按下「加入團練」確認、開機時從
 * localStorage 復原還沒到時間的排程——三條路徑都呼叫 playerApp.js 的
 * armSchedule()，最終都走到這裡，確保排定時間還沒到時的畫面呈現完全一致
 * （規格：不要讓使用者覺得不同進入方式看到不一樣的等待畫面）。確認階段
 * （`.group-join-confirm-phase`）則只有開團連結這條路徑會用到（其他兩條
 * 路徑不需要額外的「確認」步驟，直接進等待階段）。
 *
 * 一頁式呈現（規格：減少「確認/等待」跟課表執行畫面切換時的跳動感）：這個
 * 橫幅疊在執行頁（playerMount）上方一起顯示，不是切到另一個獨立畫面／
 * 容器——playerApp.js 在顯示這個橫幅的同時就已經呼叫 client.init(workout)
 * 讓下面的執行頁（時間軸／下一組資訊等）先渲染成「尚未開始」的預覽狀態，
 * 使用者能先看到完整課表樣貌。因為執行頁本身已經會顯示課表名稱／總時長／
 * 組數（`.workout-name`／`.total-duration`／`.interval-progress`），這個
 * 橫幅不重複顯示同樣的資訊。確認階段跟等待階段共用同一個橫幅容器
 * （`.group-join-confirm-banner`），只切換裡面顯示哪一段內容，確保兩個
 * 階段之間也是無縫的，跟「確認/等待」→「執行頁」之間一樣沒有跳動感。
 *
 * 兩個階段：
 *   - 確認階段（`.group-join-confirm-phase`，只有開團連結這條路徑會用到）：
 *     排定開始時間、已經過去多久（或「尚未開始」）、「加入團練」按鈕。
 *   - 等待階段（`.group-join-waiting-phase`）：即時倒數（跟原本獨立的等待
 *     畫面用同一個 formatRemainingLabel()，格式一致）、提醒文字（分頁不能
 *     完全關閉）、「取消排程」按鈕——時間到會自動轉成動態播放，這個橫幅
 *     整段收起來，只留下面已經渲染好的執行頁（見 playerApp.js 的
 *     startScheduledWorkoutNow()／switchToPlayerScreen()），不會殘留等待
 *     階段的任何元素。
 *
 * 開團連結的確認階段沿革：開團連結是頁面載入當下自動觸發的，不是使用者
 * 按鈕點擊——瀏覽器的自動播放權限解鎖（unlockAudioAndSpeechForAutoplay()）
 * 需要「使用者互動當下」的呼叫堆疊才保證有效，單靠頁面載入自動呼叫無法
 * 穩定解鎖（真機實測仍然無聲）。這裡改成先顯示這個確認橫幅，使用者按下
 * 按鈕的當下才是真正的使用者互動，解鎖跟「設定開始時間」按鈕用的是同一套
 * 機制（見 playerApp.js 的 handleGroupJoinConfirm()）。
 *
 * 純畫面渲染，不碰計時／localStorage／解鎖邏輯本身。
 *
 * @param {HTMLElement} rootEl
 * @param {{onConfirmJoin: () => void, onCancelSchedule: () => void}} handlers
 */
export function createGroupJoinConfirmView(rootEl, handlers) {
  rootEl.innerHTML = `
    <div class="group-join-confirm-banner">
      <p class="group-join-confirm-label">團體訓練邀請</p>

      <div class="group-join-confirm-phase">
        <p class="group-join-confirm-start-time"></p>
        <p class="group-join-confirm-elapsed"></p>
        <button type="button" class="btn btn-primary btn-group-join-confirm">加入團練</button>
      </div>

      <div class="group-join-waiting-phase hidden">
        <div class="group-join-waiting-countdown"></div>
        <p class="group-join-waiting-warning">
          提醒：如果這個分頁被完全關閉，或裝置長時間背景休眠導致系統回收資源，時間到「自動開始」可能會失效。建議在排定時間前，至少重新打開一次這個分頁確認狀態（不需要一直盯著，但請不要完全關閉瀏覽器）。
        </p>
        <button type="button" class="btn btn-danger btn-group-join-cancel">取消排程</button>
      </div>
    </div>
  `;

  const els = {
    label: rootEl.querySelector('.group-join-confirm-label'),
    confirmPhase: rootEl.querySelector('.group-join-confirm-phase'),
    startTime: rootEl.querySelector('.group-join-confirm-start-time'),
    elapsed: rootEl.querySelector('.group-join-confirm-elapsed'),
    confirmBtn: rootEl.querySelector('.btn-group-join-confirm'),
    waitingPhase: rootEl.querySelector('.group-join-waiting-phase'),
    waitingCountdown: rootEl.querySelector('.group-join-waiting-countdown'),
    cancelBtn: rootEl.querySelector('.btn-group-join-cancel'),
  };

  els.confirmBtn.addEventListener('click', () => handlers.onConfirmJoin());
  els.cancelBtn.addEventListener('click', () => handlers.onCancelSchedule());

  /**
   * 確認階段的內容——排定開始時間、已經過去多久（或「尚未開始」）。
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

  /** 按下「加入團練」、但排定時間還沒到：切到等待階段（同一個橫幅容器內） */
  function showWaitingPhase() {
    els.label.textContent = '團體訓練排程中';
    els.confirmPhase.classList.add('hidden');
    els.waitingPhase.classList.remove('hidden');
  }

  /** @param {number} remainingMs */
  function updateWaitingCountdown(remainingMs) {
    els.waitingCountdown.textContent = formatRemainingLabel(remainingMs);
  }

  return { update, showWaitingPhase, updateWaitingCountdown };
}
