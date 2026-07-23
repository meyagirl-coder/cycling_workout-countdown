/**
 * 倒數提示（規格 §4.4）：兩個互斥的提示模式（見 alertModeStore.js），使用者
 * 在首頁選其中一個，存進 localStorage：
 *   - ALERT_MODE_VOICE「語音報數」（預設）：組別時長 > 20 秒時，剩餘 10 秒
 *     觸發一次快速語音預告下一組資訊＋banner；接著最後 5 秒（5-4-3-2-1）
 *     逐秒語音報數。組別時長 <= 20 秒的短間歇例外不觸發預告，只有最後 5 秒
 *     逐秒語音報數。全程沒有任何嗶聲。
 *   - ALERT_MODE_BEEP「逼逼聲倒數」：完全不語音，「下一組預告」只顯示文字
 *     banner（不唸動態內容）；最後 3 秒（兩條規則都有）改成播放三聲「嗶」
 *     提示音（playCountdownBeeps()）取代語音報數。
 * 兩者互斥：同一時刻只會啟用其中一個，不會語音跟嗶聲同時出現。
 *
 * 加嗶聲模式回來是刻意的：SpeechSynthesis 的音訊輸出是系統層級的，不會被
 * 瀏覽器的「分頁音訊分享」（例如 Google Meet 畫面分享）捕捉到（Chromium bug
 * #1185527），但 Web Audio API 合成的音訊會走分頁自己的媒體管線，可以被
 * 正確捕捉——語音模式適合自己一個人騎、想聽到完整口語內容；嗶聲模式適合
 * 團體訓練透過視訊分享畫面帶練，至少能讓遠端參與者聽到聲音提示。
 *
 * 這裡只負責「timer 事件 -> 該做什麼提示」的判斷邏輯，語音／提示音的實際
 * 播放實作是可注入的依賴（speak/playCountdownBeeps），方便在 jsdom 下用
 * 假函式測試觸發時機是否正確，不需要真的 SpeechSynthesis／AudioContext。
 *
 * 三種不同時間點、三種不同格式：
 *   - countdownWarning（正常規則專用）：「下一組」還沒真的開始，只是預告，
 *     語音模式下用口語化、刻意精簡到能快速唸完的格式
 *     （formatFastCountdownSpeechText()，例如「下一組 75% 5 分鐘」），語速
 *     調快（FAST_PREVIEW_SPEECH_RATE）；banner 視覺文字兩種模式都會顯示、
 *     不受語速時間限制，維持較完整的原有格式（formatCountdownBannerText()）。
 *   - countdownTick（兩條路徑都有）：最後 5 秒逐秒觸發——語音模式報數
 *     （"5"「4」...），語速調快（DIGIT_SPEECH_RATE，見該常數定義處的說明：
 *     單一個數字唸完實際花的時間如果跟畫面倒數的 1 秒對不上，聽起來會覺得
 *     報數「拖拍」），不額外顯示 banner；每次都用「目前實際剩餘秒數」現算
 *     現報（不是靠計數器猜第幾次），降頻分頁一次跳過好幾秒也不會報出過期
 *     的數字。嗶聲模式則是剩餘 3 秒那一次觸發 playCountdownBeeps()（見上）。
 *   - intervalChanged：已經切到新的一組，維持原本 mm:ss ＋ watts 的詳細
 *     格式（formatNextIntervalText()），這個格式沒有變，兩種模式都一樣
 *     （純視覺 banner，不涉及語音／嗶聲）。
 */
import { computeCurrentTarget, TIMER_EVENTS } from '../engine/timerEngine.js';
import { ALERT_MODE_BEEP, ALERT_MODE_VOICE } from './alertModeStore.js';
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

// 5-4-3-2-1 逐秒報數：使用者實測回報過預設語速（rate=1）唸完單一個數字實際
// 花的時間比畫面上的 1 秒還久，5 個數字累計下來明顯超過 5 秒、跟畫面倒數的
// 節奏對不上——念單一個數字這種極短句子，TTS 引擎本身的啟動/收尾開銷占比
// 遠比長句子高，所以需要比 FAST_PREVIEW_SPEECH_RATE（唸一整句用的語速）更快
// 才夠。跟上面同樣的限制：瀏覽器不保證實際唸完要多久，這個值是盡力而為的
// 估計值，不是精確保證——如果實測後這台裝置還是覺得太趕或太慢，只要調整
// 這個常數即可，報數本身的觸發時機不受影響（見上方對應的模組說明）。
const DIGIT_SPEECH_RATE = 1.8;

/**
 * @param {string[]} events - 這次 tick/action 回傳的事件（TIMER_EVENTS 的值）
 * @param {object} ctx
 * @param {object} ctx.workout
 * @param {object} ctx.state - engine 的最新 state（含 currentIntervalIndex/powerAdjustPct）
 * @param {number} ctx.ftp
 * @param {'voice'|'beep'} ctx.alertMode - ALERT_MODE_VOICE 或 ALERT_MODE_BEEP，兩者互斥
 * @param {(text: string, rate?: number) => void} ctx.speak
 * @param {() => void} ctx.playCountdownBeeps
 * @param {(text: string, durationMs?: number) => void} ctx.showNextIntervalBanner
 */
export function handleTimerEvents(events, { workout, state, ftp, alertMode, speak, playCountdownBeeps, showNextIntervalBanner }) {
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
      if (alertMode === ALERT_MODE_VOICE) {
        try {
          speak(formatFastCountdownSpeechText(preview), FAST_PREVIEW_SPEECH_RATE);
        } catch (err) {
          console.error('countdownAlerts: speak() failed', err);
        }
      }

      // banner 是純視覺文字，兩個模式都要顯示——嗶聲模式沒有語音唸出動態
      // 內容，「下一組預告」就只靠這段文字傳達（見模組開頭說明）。
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
    let digit = null;
    try {
      digit = computeCurrentCountdownDigit(workout, state);
    } catch (err) {
      console.error('countdownAlerts: computeCurrentCountdownDigit() failed', err);
    }

    if (digit !== null) {
      if (alertMode === ALERT_MODE_VOICE) {
        try {
          speak(String(digit), DIGIT_SPEECH_RATE);
        } catch (err) {
          console.error('countdownAlerts: speak() failed (countdown tick)', err);
        }
      }

      // 嗶聲模式：剩餘 3 秒那一刻觸發三聲「嗶」取代逐秒報數——只在這裡呼叫
      // 一次，playCountdownBeeps() 內部自己排程 3 聲的節奏，不是外部重複
      // 呼叫 3 次（見上方模組說明，這是為了 Google Meet 分頁音訊分享能捕捉
      // 到的 Web Audio API 提示音，跟語音的分享限制無關，兩個模式互斥不會
      // 同時發生）。
      if (alertMode === ALERT_MODE_BEEP && digit === 3) {
        try {
          playCountdownBeeps();
        } catch (err) {
          console.error('countdownAlerts: playCountdownBeeps() failed', err);
        }
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

let sharedAudioContext = null;

const BEEP_COUNT = 3;
const BEEP_DURATION_SECONDS = 0.25; // 實測回報 0.15 秒聽感偏「噹」（敲擊聲）不是「嗶」，拉長到 0.25 秒
const BEEP_INTERVAL_SECONDS = 1; // 每聲間隔 1 秒，落在剩餘 3／2／1 秒附近
const BEEP_FREQUENCY_HZ = 1568; // 比舊版「嘟」的 880Hz 高一截，音色更尖銳清脆
const BEEP_PEAK_GAIN = 0.4; // 實測回報舊版（0.2）音量偏小，調大一倍
const BEEP_ATTACK_SECONDS = 0.01; // 起音斜坡：避免瞬間跳到滿音量產生的「喀」聲/敲擊感
const BEEP_RELEASE_SECONDS = 0.05; // 收尾斜坡：最後這段時間才淡出，前面維持滿音量的「平台」

/**
 * 最後 3 秒的「嗶嗶嗶」提示音：Web Audio API 合成（oscillator + gain），不是
 * 播放音檔。跟 SpeechSynthesis 不同，這種合成音走的是分頁自己的音訊管線，
 * 會被瀏覽器的分頁音訊分享（例如 Google Meet 的「分享此分頁音訊」）正確
 * 捕捉到——加回這個提示音就是為了讓遠端參與者至少聽到一個聲音提示，補上
 * 語音內容沒辦法分享出去的缺口（見模組開頭說明）。
 *
 * 3 聲的節奏是用 AudioContext 自己的時間軸（ctx.currentTime）一次排程好，
 * 不是外部呼叫端迴圈呼叫 3 次——排程一旦送出，實際發聲時間由音訊渲染執行緒
 * 精準處理，不會被呼叫當下 JS 主執行緒忙碌與否影響間隔精準度。
 *
 * 音量包絡（gain envelope）刻意分三段，不是舊版那種「瞬間跳到滿音量 + 全程
 * 持續衰減」：實測回報過舊版聽起來像「噹」（敲擊聲/鐘聲）而不是「嗶」——
 * 瞬間起音會產生類似「喀」一聲的爆音transient，而全程都在衰減（沒有平台期）
 * 聽起來像撥弦樂器的「一彈就弱掉」，兩者疊加起來就是鐘聲/敲擊聲的音色特徵。
 * 改成起音斜坡（BEEP_ATTACK_SECONDS）→ 滿音量平台 → 收尾斜坡
 * （BEEP_RELEASE_SECONDS）這種形狀，避免瞬間爆音、且中段維持穩定音量，才會
 * 聽起來像警示音那種平穩的「嗶」聲。
 */
export function playCountdownBeeps() {
  const AudioContextCtor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioContextCtor) return;

  if (!sharedAudioContext) sharedAudioContext = new AudioContextCtor();
  const ctx = sharedAudioContext;
  // iOS Safari 已知行為：交替使用 SpeechSynthesis 之後，共用的 AudioContext
  // 可能被瀏覽器悄悄中斷（suspended），之後即使程式碼正常執行、沒有拋出任何
  // 例外，oscillator 也不會真的發出聲音——每次播放前都主動 resume 一次，跟
  // unlockAudioAndSpeechForAutoplay() 的作法一致，不能只靠一開始 unlock 那一次。
  if (typeof ctx.resume === 'function' && ctx.state === 'suspended') ctx.resume();

  for (let i = 0; i < BEEP_COUNT; i++) {
    const startTime = ctx.currentTime + i * BEEP_INTERVAL_SECONDS;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.frequency.value = BEEP_FREQUENCY_HZ;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(BEEP_PEAK_GAIN, startTime + BEEP_ATTACK_SECONDS);
    gain.gain.setValueAtTime(BEEP_PEAK_GAIN, startTime + BEEP_DURATION_SECONDS - BEEP_RELEASE_SECONDS);
    gain.gain.linearRampToValueAtTime(0.0001, startTime + BEEP_DURATION_SECONDS);

    oscillator.start(startTime);
    oscillator.stop(startTime + BEEP_DURATION_SECONDS);
  }
}

/**
 * 真正的語音實作：SpeechSynthesis API，瀏覽器不支援就靜默跳過。
 * @param {string} text
 * @param {number} [rate] - 語速倍率，預設 1（正常語速）；下一組快速預告會傳
 *   FAST_PREVIEW_SPEECH_RATE，5-4-3-2-1 逐秒報數會傳更快的 DIGIT_SPEECH_RATE
 *   （單一個數字的極短句子需要比整句預告更快，才能在 1 秒內講完，見上方
 *   常數定義處的說明）。
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
 * 音效／語音播放，藉此解鎖瀏覽器的自動播放權限——瀏覽器（尤其 iOS Safari）
 * 通常只允許在真正的使用者互動（點擊／按鍵）當下、同步呼叫堆疊裡建立或
 * 播放音訊，之後排程時間到、由 setInterval／setTimeout 自動觸發播放時已經
 * 沒有使用者互動了，如果 AudioContext／SpeechSynthesis 是第一次使用，很
 * 容易被瀏覽器悄悄擋掉——必須在呼叫端的按鈕 click handler「當下」同步呼叫
 * 這個函式（不能包在 async 函式的 await 之後、或 setTimeout 裡，那樣就不算
 * 使用者互動的當下了），才能讓後續真正自動觸發的提示音／語音正常播放。
 *
 * playCountdownBeeps() 共用同一個 sharedAudioContext，這裡建立／resume 它，
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
