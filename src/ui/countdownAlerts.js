/**
 * 倒數提示（規格 §4.4）：組別時長 > 20 秒的正常規則——剩餘 10 秒時快速唸出
 * 下一組資訊（語速加快，盡量在 5 秒內講完）＋顯示 banner；接著最後 5 秒
 * （5-4-3-2-1）逐秒語音報數，正常語速，唸完剛好接上下一組開始。組別時長
 * <= 20 秒的短間歇例外——不觸發「下一組」預告（不論語音或 banner，組別太短，
 * 插播一段介紹會佔掉這組大半時間），只有最後 5 秒一樣逐秒語音報數（見
 * timerEngine.js 的 COUNTDOWN_WARNING／COUNTDOWN_TICK）。切組瞬間顯示下一組
 * 資訊（intervalChanged，格式不變）。
 *
 * 全程只有語音，沒有任何提示音（beep）——早期版本在 countdownWarning 當下
 * 會先播一聲提示音再講語音，後來拿掉了，改成純語音；playCountdownBeep()／
 * AudioContext 相關的程式碼因此也一併移除，不留不會再被呼叫到的函式。
 *
 * 這裡只負責「timer 事件 -> 該做什麼提示」的判斷邏輯，語音的實際播放實作
 * 是可注入的依賴（speak），方便在 jsdom 下用假函式測試觸發時機是否正確，
 * 不需要真的 SpeechSynthesis。
 *
 * 三種不同時間點、三種不同格式：
 *   - countdownWarning（正常規則專用）：「下一組」還沒真的開始，只是預告，
 *     用口語化、刻意精簡到能快速唸完的格式（formatFastCountdownSpeechText()，
 *     例如「下一組 75% 5 分鐘」），語速調快（FAST_PREVIEW_SPEECH_RATE）；
 *     banner 視覺文字不受語速時間限制，維持較完整的原有格式
 *     （formatCountdownBannerText()）。
 *   - countdownTick（兩條路徑都有）：最後 5 秒逐秒語音報數（"5"「4」...），
 *     正常語速，不額外顯示 banner——每次都用「目前實際剩餘秒數」現算現報
 *     （不是靠計數器猜第幾次），降頻分頁一次跳過好幾秒也不會報出過期的
 *     數字。
 *   - intervalChanged：已經切到新的一組，維持原本 mm:ss ＋ watts 的詳細
 *     格式（formatNextIntervalText()），這個格式沒有變。
 */
import { computeCurrentTarget, TIMER_EVENTS } from '../engine/timerEngine.js';
import { formatMinuteSecondLabel, formatMMSS } from './formatTime.js';
import { INTERVAL_TYPE_LABELS } from './intervalLabels.js';

export const COUNTDOWN_FINISHING_SOON_TEXT = '即將完成';

// 倒數預告 banner 顯示的秒數——比實際倒數的 10 秒再多留一點緩衝，讓 banner
// 一路撐到真正切組（intervalChanged 會用新內容覆蓋掉它），中間不會提早收起、
// 出現一段看不到任何預告的空白（renderPlayer.js 預設的 5 秒不夠撐完整個 10
// 秒倒數）。
const COUNTDOWN_PREVIEW_BANNER_MS = 11000;

// 「下一組」預告語音刻意講快一點，盡量在 5 秒內講完，緊接著剩下 5 秒的
// 逐秒報數（見 timerEngine.js 的 COUNTDOWN_WARNING_SECONDS/COUNTDOWN_TICK_SECONDS）。
// 瀏覽器不保證 SpeechSynthesis 唸完一段文字實際花多久（不同裝置／語音包快慢
// 不一），這個語速只是盡力而為，不是精確可控的保證值——報數本身仍然是靠
// 真正的計時器逐秒觸發，不是接在這段語音講完之後才開始，所以報數的時機
// 永遠準確，頂多語音講比較久時會跟第一聲報數稍微疊到。
const FAST_PREVIEW_SPEECH_RATE = 1.35;

/**
 * @param {string[]} events - 這次 tick/action 回傳的事件（TIMER_EVENTS 的值）
 * @param {object} ctx
 * @param {object} ctx.workout
 * @param {object} ctx.state - engine 的最新 state（含 currentIntervalIndex/powerAdjustPct）
 * @param {number} ctx.ftp
 * @param {(text: string, rate?: number) => void} ctx.speak
 * @param {(text: string, durationMs?: number) => void} ctx.showNextIntervalBanner
 */
export function handleTimerEvents(events, { workout, state, ftp, speak, showNextIntervalBanner }) {
  if (events.includes(TIMER_EVENTS.COUNTDOWN_WARNING)) {
    // 預告內容計算／語音／banner 各自獨立包 try-catch：使用者回報過「語音
    // 播放中途出錯，後續提示全部消失」的情況，最可能的原因是其中一段丟出
    // 例外，把同一個 tick 裡排在後面的程式碼整個中斷掉（沒被 catch 住的
    // 例外會一路往外拋，中斷當下這次 handleTimerEvents() 呼叫）。這裡讓
    // 三段互不拖累：任一段失敗只在 console 留下錯誤方便除錯，不會讓其他段
    // 也跟著遭殃。
    let preview = null;
    try {
      preview = computeUpcomingIntervalPreview(workout, state, ftp);
    } catch (err) {
      console.error('countdownAlerts: computeUpcomingIntervalPreview() failed', err);
    }

    if (preview) {
      try {
        speak(formatFastCountdownSpeechText(preview), FAST_PREVIEW_SPEECH_RATE);
      } catch (err) {
        console.error('countdownAlerts: speak() failed', err);
      }

      try {
        showNextIntervalBanner(formatCountdownBannerText(preview), COUNTDOWN_PREVIEW_BANNER_MS);
      } catch (err) {
        console.error('countdownAlerts: showNextIntervalBanner() failed', err);
      }
    }
  }

  // 最後 5 秒逐秒語音報數（COUNTDOWN_TICK，兩條路徑都有，見 timerEngine.js）：
  // 不管這次 events 裡出現幾次（降頻分頁一次 tick 跨過好幾個秒數點時會有
  // 多筆），只用「目前實際剩餘秒數」報一次數，不是每筆都報——報過期、跳過
  // 的數字（例如卡在背景時一次從 5 跳到 2）反而更容易誤導使用者，不如只報
  // 當下正確的那一個。
  if (events.includes(TIMER_EVENTS.COUNTDOWN_TICK)) {
    try {
      const digit = computeCurrentCountdownDigit(workout, state);
      if (digit !== null) speak(String(digit));
    } catch (err) {
      console.error('countdownAlerts: speak() failed (countdown tick)', err);
    }
  }

  if (events.includes(TIMER_EVENTS.INTERVAL_CHANGED)) {
    try {
      showNextIntervalBanner(formatNextIntervalText(workout, state, ftp));
    } catch (err) {
      console.error('countdownAlerts: showNextIntervalBanner() (intervalChanged) failed', err);
    }
  }
}

/** 目前這組「剩餘秒數」四捨五入到整數，用來報數（"5"「4」...「1」） */
function computeCurrentCountdownDigit(workout, state) {
  const iv = workout.intervals[state.currentIntervalIndex];
  const remaining = iv.duration - state.elapsedInInterval;
  const rounded = Math.round(remaining);
  return rounded > 0 ? rounded : null;
}

/**
 * 算出倒數 10 秒當下，「下一組」長什麼樣子——跟切組瞬間不同，這裡的「下一組」
 * 是 currentIntervalIndex + 1（現在這組還沒結束，下一組還沒開始）。目前這組
 * 已經是最後一組時，回傳 { finishing: true }，呼叫端要顯示「即將完成」而不是
 * 不存在的下一組。
 *
 * @returns {{finishing: true} | {finishing: false, freeride: true, durationLabel: string} | {finishing: false, freeride: false, durationLabel: string, isRange: boolean, startPct: number, endPct: number}}
 */
function computeUpcomingIntervalPreview(workout, state, ftp) {
  const nextIndex = state.currentIntervalIndex + 1;
  if (nextIndex >= workout.intervals.length) {
    return { finishing: true };
  }

  const iv = workout.intervals[nextIndex];
  const durationLabel = formatMinuteSecondLabel(iv.duration);

  if (iv.type === 'freeride') {
    return { finishing: false, freeride: true, durationLabel };
  }

  const startTarget = computeCurrentTarget(workout, nextIndex, 0, ftp, state.powerAdjustPct);
  const endTarget = computeCurrentTarget(workout, nextIndex, iv.duration, ftp, state.powerAdjustPct);

  return {
    finishing: false,
    freeride: false,
    durationLabel,
    isRange: iv.powerStart !== iv.powerEnd,
    startPct: Math.round(startTarget.pct),
    endPct: Math.round(endTarget.pct),
  };
}

function formatCountdownBannerText(preview) {
  if (preview.finishing) return COUNTDOWN_FINISHING_SOON_TEXT;
  if (preview.freeride) return `下一組：${INTERVAL_TYPE_LABELS.freeride} · ${preview.durationLabel}`;

  const pctLabel = preview.isRange ? `${preview.startPct}% → ${preview.endPct}% FTP` : `${preview.startPct}% FTP`;
  return `下一組：${preview.durationLabel} · ${pctLabel}`;
}

/**
 * 「下一組」語音預告，刻意精簡（不像 formatCountdownBannerText() 那樣完整），
 * 搭配 FAST_PREVIEW_SPEECH_RATE 加快的語速，盡量在 5 秒內講完，好讓緊接著
 * 的 5 秒逐秒報數準確接上下一組開始，例如「下一組 75% 5 分鐘」。
 */
function formatFastCountdownSpeechText(preview) {
  if (preview.finishing) return COUNTDOWN_FINISHING_SOON_TEXT;
  if (preview.freeride) return `下一組 ${INTERVAL_TYPE_LABELS.freeride} ${preview.durationLabel}`;

  const pctLabel = preview.isRange ? `${preview.startPct}% 到 ${preview.endPct}%` : `${preview.startPct}%`;
  return `下一組 ${pctLabel} ${preview.durationLabel}`;
}

/** 切組瞬間的下一組資訊（規格既有格式，mm:ss ＋ watts，沒有變動） */
function formatNextIntervalText(workout, state, ftp) {
  const iv = workout.intervals[state.currentIntervalIndex];
  const typeLabel = INTERVAL_TYPE_LABELS[iv.type];
  const durationLabel = formatMMSS(iv.duration);
  const target = computeCurrentTarget(workout, state.currentIntervalIndex, 0, ftp, state.powerAdjustPct);

  if (target.watts === null) {
    return `下一組：${typeLabel} · ${durationLabel}`;
  }
  return `下一組：${typeLabel} · ${durationLabel} · ${Math.round(target.pct)}% FTP · ${target.watts}W`;
}

/**
 * 真正的語音實作：SpeechSynthesis API，瀏覽器不支援就靜默跳過。
 * @param {string} text
 * @param {number} [rate] - 語速倍率，預設 1（正常語速）；下一組快速預告會傳
 *   FAST_PREVIEW_SPEECH_RATE 加快，5-4-3-2-1 報數維持預設正常語速。
 */
export function speakCountdownWarning(text, rate = 1) {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-TW';
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
}

/**
 * 團體訓練排程功能用：使用者「設定開始時間」這個動作本身觸發一次幾乎無聲的
 * 語音播放，藉此解鎖瀏覽器的自動播放權限——瀏覽器（尤其 iOS Safari）通常只
 * 允許在真正的使用者互動（點擊／按鍵）當下、同步呼叫堆疊裡第一次呼叫
 * SpeechSynthesis，之後排程時間到、由 setInterval／setTimeout 自動觸發播放
 * 時已經沒有使用者互動了，如果是第一次使用，很容易被瀏覽器悄悄擋掉——必須
 * 在呼叫端的按鈕 click handler「當下」同步呼叫這個函式（不能包在 async
 * 函式的 await 之後、或 setTimeout 裡，那樣就不算使用者互動的當下了），
 * 才能讓後續真正自動觸發的語音正常播放。
 *
 * 唸一次音量 0 的極短內容來解鎖之後的語音播放（Safari／iOS 對第一次呼叫
 * speak() 比較嚴格，這是常見的繞過方式）。全程只有語音、沒有提示音（beep），
 * 所以這裡不再需要建立／解鎖 AudioContext。
 */
export function unlockAudioAndSpeechForAutoplay() {
  if (typeof window !== 'undefined' && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
    const utterance = new SpeechSynthesisUtterance(' ');
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
  }
}
