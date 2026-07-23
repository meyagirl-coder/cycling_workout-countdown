/**
 * 倒數提示（規格 §4.4）：剩餘 10 秒時同時觸發提示音＋語音＋下一組預告；切組
 * 瞬間顯示下一組資訊。這裡只負責「timer 事件 -> 該做什麼提示」的判斷邏輯，
 * 音效／語音的實際播放實作是可注入的依賴（playBeep/speak），方便在 jsdom 下
 * 用假函式測試觸發時機是否正確，不需要真的 AudioContext／SpeechSynthesis。
 *
 * 倒數 10 秒的預告（countdownWarning）跟切組瞬間的顯示（intervalChanged）
 * 是兩個不同時間點、格式也不同：
 *   - countdownWarning 這時候「下一組」還沒真的開始，只是預告，用口語化的
 *     「X 分鐘」時長格式＋「下一組：X 分鐘 · Y% FTP」／有漸變就顯示
 *     「XX% → YY% FTP」／freeride 顯示「自由騎乘」不顯示百分比／已經是
 *     最後一組就顯示「即將完成」，不能講一個不存在的「下一組」。
 *   - intervalChanged 這時候已經切到新的一組，維持原本 mm:ss ＋ watts 的
 *     詳細格式（formatNextIntervalText()），這個格式沒有變。
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

/**
 * @param {string[]} events - 這次 tick/action 回傳的事件（TIMER_EVENTS 的值）
 * @param {object} ctx
 * @param {object} ctx.workout
 * @param {object} ctx.state - engine 的最新 state（含 currentIntervalIndex/powerAdjustPct）
 * @param {number} ctx.ftp
 * @param {() => void} ctx.playBeep
 * @param {(text: string) => void} ctx.speak
 * @param {(text: string, durationMs?: number) => void} ctx.showNextIntervalBanner
 */
export function handleTimerEvents(events, { workout, state, ftp, playBeep, speak, showNextIntervalBanner }) {
  if (events.includes(TIMER_EVENTS.COUNTDOWN_WARNING)) {
    // 提示音／預告內容計算／語音／banner 各自獨立包 try-catch：使用者回報過
    // 「只聽到一聲提示音，之後語音跟後續提示音全部消失」的情況，最可能的
    // 原因是其中一段丟出例外，把同一個 tick 裡排在後面的程式碼整個中斷掉
    // （沒被 catch 住的例外會一路往外拋，中斷當下這次 handleTimerEvents()
    // 呼叫）。這裡讓四段互不拖累：任一段失敗只在 console 留下錯誤方便除錯，
    // 不會讓提示音這種最基本的功能也跟著遭殃。
    try {
      playBeep();
    } catch (err) {
      console.error('countdownAlerts: playBeep() failed', err);
    }

    let preview = null;
    try {
      preview = computeUpcomingIntervalPreview(workout, state, ftp);
    } catch (err) {
      console.error('countdownAlerts: computeUpcomingIntervalPreview() failed', err);
    }

    if (preview) {
      try {
        speak(formatCountdownSpeechText(preview));
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

  if (events.includes(TIMER_EVENTS.INTERVAL_CHANGED)) {
    try {
      showNextIntervalBanner(formatNextIntervalText(workout, state, ftp));
    } catch (err) {
      console.error('countdownAlerts: showNextIntervalBanner() (intervalChanged) failed', err);
    }
  }
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

function formatCountdownSpeechText(preview) {
  if (preview.finishing) return `10 秒後${COUNTDOWN_FINISHING_SOON_TEXT}`;
  if (preview.freeride) return `10 秒後進入下一組，${INTERVAL_TYPE_LABELS.freeride}，持續 ${preview.durationLabel}`;

  const pctLabel = preview.isRange ? `${preview.startPct}% 到 ${preview.endPct}% FTP` : `${preview.startPct}% FTP`;
  return `10 秒後進入下一組，${pctLabel}，持續 ${preview.durationLabel}`;
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

let sharedAudioContext = null;

/** 真正的提示音實作：Web Audio API，瀏覽器不支援就靜默跳過 */
export function playCountdownBeep() {
  const AudioContextCtor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioContextCtor) return;

  if (!sharedAudioContext) sharedAudioContext = new AudioContextCtor();
  const ctx = sharedAudioContext;
  // iOS Safari 已知行為：交替使用 SpeechSynthesis 之後，共用的 AudioContext
  // 可能被瀏覽器悄悄中斷（suspended），之後即使程式碼正常執行、沒有拋出任何
  // 例外，oscillator 也不會真的發出聲音——每次播放前都主動 resume 一次，跟
  // unlockAudioAndSpeechForAutoplay() 的作法一致，不能只靠一開始 unlock 那一次。
  if (typeof ctx.resume === 'function' && ctx.state === 'suspended') ctx.resume();

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);

  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.3);
}

/** 真正的語音實作：SpeechSynthesis API，瀏覽器不支援就靜默跳過 */
export function speakCountdownWarning(text) {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-TW';
  window.speechSynthesis.speak(utterance);
}

/**
 * 團體訓練排程功能用：使用者「設定開始時間」這個動作本身觸發一次幾乎無聲的
 * 音效／語音播放，藉此解鎖瀏覽器的自動播放權限——瀏覽器（尤其 iOS Safari）
 * 通常只允許在真正的使用者互動（點擊／按鍵）當下、同步呼叫堆疊裡建立或
 * 播放音訊，之後排程時間到、由 setInterval／setTimeout 自動觸發播放時已經
 * 沒有使用者互動了，如果 AudioContext／SpeechSynthesis 是第一次使用，很
 * 容易被瀏覽器悄悄擋掉——必須在呼叫端的按鈕 click handler「當下」同步呼叫
 * 這個函式（不能包在 async 函式的 await 之後、或 setTimeout 裡，那樣就不算
 * 使用者互動的當下了），才能讓後續真正自動觸發的提示音／語音正常播放。
 *
 * playCountdownBeep() 共用同一個 sharedAudioContext，這裡建立／resume 它，
 * 並播放一段音量為 0 的極短音效——單純呼叫 new AudioContext() 在部分瀏覽器
 * 還不夠「解鎖」，需要真的播放一次（即使無聲）才算數。SpeechSynthesis 也
 * 一樣，唸一次音量 0 的極短內容來解鎖之後的語音播放（Safari／iOS 對第一次
 * 呼叫 speak() 比較嚴格，這是常見的繞過方式）。
 */
export function unlockAudioAndSpeechForAutoplay() {
  const AudioContextCtor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (AudioContextCtor) {
    if (!sharedAudioContext) sharedAudioContext = new AudioContextCtor();
    const ctx = sharedAudioContext;
    if (typeof ctx.resume === 'function' && ctx.state === 'suspended') ctx.resume();

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0, ctx.currentTime); // 無聲
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.05);
  }

  if (typeof window !== 'undefined' && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
    const utterance = new SpeechSynthesisUtterance(' ');
    utterance.volume = 0;
    window.speechSynthesis.speak(utterance);
  }
}
