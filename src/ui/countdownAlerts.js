/**
 * 倒數提示（規格 §4.4）：剩餘 10 秒時同時觸發提示音＋語音；切組瞬間顯示下一組
 * 資訊。這裡只負責「timer 事件 -> 該做什麼提示」的判斷邏輯，音效／語音的實際
 * 播放實作是可注入的依賴（playBeep/speak），方便在 jsdom 下用假函式測試觸發
 * 時機是否正確，不需要真的 AudioContext／SpeechSynthesis。
 */
import { computeCurrentTarget, TIMER_EVENTS } from '../engine/timerEngine.js';
import { formatMMSS } from './formatTime.js';
import { INTERVAL_TYPE_LABELS } from './intervalLabels.js';

export const COUNTDOWN_SPEECH_TEXT = '10 秒後切換下一組';

/**
 * @param {string[]} events - 這次 tick/action 回傳的事件（TIMER_EVENTS 的值）
 * @param {object} ctx
 * @param {object} ctx.workout
 * @param {object} ctx.state - engine 的最新 state（含 currentIntervalIndex/powerAdjustPct）
 * @param {number} ctx.ftp
 * @param {() => void} ctx.playBeep
 * @param {(text: string) => void} ctx.speak
 * @param {(text: string) => void} ctx.showNextIntervalBanner
 */
export function handleTimerEvents(events, { workout, state, ftp, playBeep, speak, showNextIntervalBanner }) {
  if (events.includes(TIMER_EVENTS.COUNTDOWN_WARNING)) {
    playBeep();
    speak(COUNTDOWN_SPEECH_TEXT);
  }

  if (events.includes(TIMER_EVENTS.INTERVAL_CHANGED)) {
    showNextIntervalBanner(formatNextIntervalText(workout, state, ftp));
  }
}

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
