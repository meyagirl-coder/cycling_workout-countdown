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
    playBeep();
    const preview = computeUpcomingIntervalPreview(workout, state, ftp);
    speak(formatCountdownSpeechText(preview));
    showNextIntervalBanner(formatCountdownBannerText(preview), COUNTDOWN_PREVIEW_BANNER_MS);
  }

  if (events.includes(TIMER_EVENTS.INTERVAL_CHANGED)) {
    showNextIntervalBanner(formatNextIntervalText(workout, state, ftp));
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
