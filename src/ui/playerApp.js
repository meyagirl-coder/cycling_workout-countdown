import { extractEventId } from '../integrations/intervalsIcu.js';
import { parseAutoDetectedPasteText } from '../parser/pasteTextRouter.js';
import { parseTrainerDayWorkoutStructureText } from '../parser/trainerDayWorkoutStructureParser.js';
import { parseWhatsOnZwiftText } from '../parser/whatsOnZwiftParser.js';
import { parseZwoXml } from '../parser/zwoParser.js';
import { createTimerWorkerClient } from '../worker/timerWorkerClient.js';
import { createAppBanner } from './appBanner.js';
import { handleTimerEvents, playCountdownBeep, speakCountdownWarning, unlockAudioAndSpeechForAutoplay } from './countdownAlerts.js';
import { DEFAULT_FTP, loadFtp, saveFtp } from './ftpStore.js';
import { createPlayerView } from './renderPlayer.js';
import { createScheduledStartRuntime } from './scheduledStartRuntime.js';
import { clearSchedule, loadSchedule, saveSchedule } from './scheduleStore.js';
import { createUploadView } from './uploadView.js';
import { createWaitingView } from './waitingView.js';

const INTERVALS_ICU_PROXY_URL = '/api/intervals-zwo';
const TRAINERDAY_PROXY_URL = '/api/trainerday-workout';
const WHATSONZWIFT_PROXY_URL = '/api/whatsonzwift-workout';

/**
 * 執行頁的組裝入口：先顯示上傳畫面，使用者可以選 .zwo 檔案、貼 intervals.icu
 * 課表網址／ID（透過 /api/intervals-zwo 這個 Vercel Serverless Function 代理
 * 下載），或直接貼上純文字課表。不管哪種來源，最後都用對應的 parser 轉成同一份
 * Workout JSON，成功才切到執行頁並接上 Web Worker 計時引擎；解析或下載失敗則
 * 在上傳畫面顯示錯誤訊息，讓使用者重試。
 *
 * 團體訓練排程（選填）：使用者在上傳畫面設定了開始時間後，課表載入成功時
 * 不會直接進執行頁，而是交給 armSchedule() 判斷——時間已經過去就直接開始
 * 播放，還沒到就切到等待畫面（waitingView.js）倒數，時間到才自動觸發開始。
 * 排程（課表＋開始時間）存進 localStorage（scheduleStore.js），App 開機時
 * 會檢查一次，撐過分頁切換／短暫關閉重開；但沒辦法撐過分頁完全關閉或裝置
 * 長時間背景休眠，這個限制會在等待畫面上明確告知使用者。
 *
 * @param {HTMLElement} rootEl
 * @returns {{ client: ReturnType<typeof createTimerWorkerClient> }}
 */
export function initPlayerApp(rootEl) {
  rootEl.innerHTML =
    '<div class="app-banner-mount"></div><div class="upload-mount"></div><div class="waiting-mount hidden"></div><div class="player-mount hidden"></div>';
  const bannerMount = rootEl.querySelector('.app-banner-mount');
  const uploadMount = rootEl.querySelector('.upload-mount');
  const waitingMount = rootEl.querySelector('.waiting-mount');
  const playerMount = rootEl.querySelector('.player-mount');

  const appBanner = createAppBanner(bannerMount);

  const client = createTimerWorkerClient();
  let latestState = null;
  let currentWorkout = null;

  // 規格 §6：App 啟動時讀 localStorage 的 user_ftp；沒設定過就先用預設值，
  // 畫面上（FTP 輸入欄位）會清楚顯示這個數字，使用者隨時可以改。
  let currentFtp = loadFtp() ?? DEFAULT_FTP;

  // 團體訓練排程：使用者按下「設定」時先記在這裡（還沒有課表可以配對），
  // 等下一次任何方式的課表載入成功時才真正套用、存進 localStorage、清掉這個
  // 暫存值（見 loadWorkout()）。scheduleRuntime 是等待畫面倒數用的可停止
  // 計時器（見 scheduledStartRuntime.js），同時間最多只有一個在跑。
  let pendingScheduledStartTimestamp = null;
  let scheduleRuntime = null;

  const uploadView = createUploadView(uploadMount, {
    onFileSelected: (file) => handleFileSelected(file),
    onIntervalsIcuSubmit: (rawText) => handleIntervalsIcuSubmit(rawText),
    onPasteTextSubmit: (rawText) => handlePasteTextSubmit(rawText),
    onTrainerDayUrlSubmit: (url) => handleTrainerDayUrlSubmit(url),
    onWhatsOnZwiftUrlSubmit: (url) => handleWhatsOnZwiftUrlSubmit(url),
    onScheduledStartTimeSet: (date) => handleScheduledStartTimeSet(date),
    onScheduledStartTimeCancel: () => handleScheduledStartTimeCancel(),
    onFtpChange: (ftp) => {
      currentFtp = ftp;
      saveFtp(ftp);
      // 執行頁如果已經在跑，瓦數要立即用新的 FTP 重繪，不用等下一次 timer tick。
      if (currentWorkout && latestState) {
        playerView.update(currentWorkout, latestState, currentFtp);
      }
    },
  });
  uploadView.setFtpValue(currentFtp);

  const waitingView = createWaitingView(waitingMount, {
    onCancelSchedule: () => handleCancelSchedule(),
  });

  const playerView = createPlayerView(playerMount, {
    onPlayPause: () => {
      if (latestState && latestState.status === 'running') {
        client.pause();
      } else {
        client.play();
      }
    },
    onSkip: () => client.skip(),
    onRedo: () => client.redo(),
    onStop: () => client.stop(),
    onReturnHome: () => returnToHome(),
  });

  /** 執行頁完成橫幅的「回到主畫面」按鈕（規格 §4.5）：純畫面切換，不用重置引擎 */
  function returnToHome() {
    playerMount.classList.add('hidden');
    waitingMount.classList.add('hidden');
    uploadMount.classList.remove('hidden');
    appBanner.show();
    uploadView.clearError();
    currentWorkout = null;
  }

  client.onUpdate((state, events) => {
    latestState = state;
    if (!currentWorkout) return;

    playerView.update(currentWorkout, state, currentFtp);
    handleTimerEvents(events, {
      workout: currentWorkout,
      state,
      ftp: currentFtp,
      playBeep: playCountdownBeep,
      speak: speakCountdownWarning,
      showNextIntervalBanner: playerView.showNextIntervalBanner,
    });
  });

  /**
   * 解析成功就切到執行頁；失敗就把訊息顯示在上傳畫面，回傳是否成功。
   *
   * 如果使用者先按過「設定開始時間」的「設定」，pendingScheduledStartTimestamp
   * 會有值——這時候不直接進執行頁，改成交給團體訓練排程流程判斷（規格：
   * 已經過去就立刻開始播放、還沒到就進等待畫面），不管這份課表是透過哪種
   * 輸入方式載入的都一樣（貼文字／貼網址／上傳 .zwo／intervals.icu）。
   */
  function loadWorkout(parseFn, errorPrefix) {
    let workout;
    try {
      workout = parseFn();
    } catch (err) {
      uploadView.showError(`${errorPrefix}${err.message}`);
      return false;
    }

    if (pendingScheduledStartTimestamp !== null) {
      const startTimestamp = pendingScheduledStartTimestamp;
      pendingScheduledStartTimestamp = null;
      uploadView.clearScheduleStatus();
      saveSchedule(workout, startTimestamp);
      armSchedule(workout, startTimestamp);
      return true;
    }

    switchToPlayerScreen(workout);
    return true;
  }

  /** 課表資料就緒（不管是新解析的還是排程流程給的）切到執行頁的共用邏輯 */
  function switchToPlayerScreen(workout) {
    currentWorkout = workout;
    client.init(workout);
    appBanner.hide();
    uploadMount.classList.add('hidden');
    waitingMount.classList.add('hidden');
    playerMount.classList.remove('hidden');
  }

  /**
   * 已經有一份課表跟排定開始時間，決定「立刻開始」還是「進等待畫面」——
   * 開機時從 localStorage 復原排程、或剛設定完排程且課表也載入成功時，都會
   * 呼叫這裡（規格：時間已經過去就直接立刻開始播放，不用等畫面）。
   */
  function armSchedule(workout, startTimestamp) {
    if (startTimestamp <= Date.now()) {
      startScheduledWorkoutNow(workout);
    } else {
      enterWaitingScreen(workout, startTimestamp);
    }
  }

  /** 排定時間到了（或一開機就發現已經過去）：清掉排程紀錄，直接切到執行頁並開始播放 */
  function startScheduledWorkoutNow(workout) {
    stopScheduleRuntimeIfRunning();
    clearSchedule();
    switchToPlayerScreen(workout);
    client.play();
  }

  /** 排定時間還沒到：切到等待畫面，顯示課表基本資訊＋即時倒數，時間到自動觸發開始 */
  function enterWaitingScreen(workout, startTimestamp) {
    stopScheduleRuntimeIfRunning();
    appBanner.hide();
    uploadMount.classList.add('hidden');
    playerMount.classList.add('hidden');
    waitingMount.classList.remove('hidden');
    waitingView.update(workout, startTimestamp - Date.now());

    scheduleRuntime = createScheduledStartRuntime({
      startTimestamp,
      onTick: (remainingMs) => waitingView.update(workout, remainingMs),
      onReached: () => startScheduledWorkoutNow(workout),
    });
    scheduleRuntime.start();
  }

  function stopScheduleRuntimeIfRunning() {
    if (scheduleRuntime) {
      scheduleRuntime.stop();
      scheduleRuntime = null;
    }
  }

  /**
   * 「設定開始時間」按下「設定」的當下（見 uploadView.js）：這個 click
   * handler 全程同步呼叫到這裡，藉此在使用者互動當下解鎖瀏覽器的自動播放
   * 權限（unlockAudioAndSpeechForAutoplay()），確保排定時間到、由
   * setInterval 自動觸發播放時，提示音／語音能正常運作，不會被瀏覽器擋掉。
   */
  function handleScheduledStartTimeSet(date) {
    pendingScheduledStartTimestamp = date.getTime();
    unlockAudioAndSpeechForAutoplay();
  }

  function handleScheduledStartTimeCancel() {
    pendingScheduledStartTimestamp = null;
  }

  /** 等待畫面「取消排程」：清掉排程紀錄，回到上傳畫面 */
  function handleCancelSchedule() {
    stopScheduleRuntimeIfRunning();
    clearSchedule();
    waitingMount.classList.add('hidden');
    uploadMount.classList.remove('hidden');
    appBanner.show();
    uploadView.clearError();
  }

  // 檔案選擇輸入框故意不設 accept 屬性（見 uploadView.js 的說明），所以這裡
  // 選到的可能是任何檔案——先看副檔名是不是 .zwo（不分大小寫），不是的話
  // 直接給清楚的錯誤訊息，不用浪費一次讀檔／XML 解析才發現選錯檔案。副檔名
  // 對的話再交給 parseZwoXml() 檢查實際內容是否合法。
  async function handleFileSelected(file) {
    uploadView.clearError();

    if (!/\.zwo$/i.test(file.name)) {
      uploadView.showError('這不是合法的 zwo 檔案，請選擇副檔名為 .zwo 的課表檔案。');
      return;
    }

    let xmlText;
    try {
      xmlText = await file.text();
    } catch {
      uploadView.showError('讀取檔案失敗，請再試一次。');
      return;
    }

    loadWorkout(() => parseZwoXml(xmlText), '無法解析這份 .zwo 檔案：');
  }

  function handlePasteTextSubmit(rawText) {
    uploadView.clearError();
    loadWorkout(() => parseAutoDetectedPasteText(rawText), '無法解析貼上的課表內容：');
  }

  /**
   * 貼的是課表網址：透過對應的代理抓取，拿回課表文字後用對應的 parser 解析。
   * TrainerDay／WhatsOnZwift 走同一套流程，只有 proxy 網址、parser、錯誤訊息
   * 用的服務名稱不同，抽成共用函式避免兩邊各自維護一份幾乎一樣的 fetch／
   * 錯誤處理邏輯。
   */
  async function handleRemoteWorkoutUrlSubmit(url, { proxyUrl, parseText, serviceName, errorPrefix }) {
    uploadView.clearError();
    uploadView.setUrlLoading(true);
    try {
      let response;
      try {
        response = await fetch(`${proxyUrl}?url=${encodeURIComponent(url)}&_t=${Date.now()}`, {
          cache: 'no-store',
        });
      } catch {
        uploadView.showError('連線代理服務失敗，請確認網路連線後再試一次，或改用「貼上課表文字內容」。');
        return;
      }

      if (!response.ok) {
        const message = await extractProxyErrorMessage(response, serviceName);
        uploadView.showError(message);
        return;
      }

      const extractedText = await response.text();
      loadWorkout(() => parseText(extractedText), errorPrefix);
    } finally {
      uploadView.setUrlLoading(false);
    }
  }

  function handleTrainerDayUrlSubmit(url) {
    return handleRemoteWorkoutUrlSubmit(url, {
      proxyUrl: TRAINERDAY_PROXY_URL,
      parseText: parseTrainerDayWorkoutStructureText,
      serviceName: 'TrainerDay',
      errorPrefix: '無法解析 TrainerDay 課表內容：',
    });
  }

  function handleWhatsOnZwiftUrlSubmit(url) {
    return handleRemoteWorkoutUrlSubmit(url, {
      proxyUrl: WHATSONZWIFT_PROXY_URL,
      parseText: parseWhatsOnZwiftText,
      serviceName: 'WhatsOnZwift',
      errorPrefix: '無法解析 WhatsOnZwift 課表內容：',
    });
  }

  async function handleIntervalsIcuSubmit(rawText) {
    uploadView.clearError();

    const eventId = extractEventId(rawText);
    if (!eventId) {
      uploadView.showError('看不出 event ID，請貼完整的 intervals.icu 課表網址，或直接輸入數字 ID。');
      return;
    }

    uploadView.setIntervalsIcuLoading(true);
    try {
      let response;
      try {
        // cache: 'no-store' + 一個每次都不同的 _t 參數：即使中間有任何一層沒
        // 完全遵守 Cache-Control（瀏覽器快取、公司 proxy…），URL 本身每次都
        // 不同也能保證不會拿到別的 eventId 殘留下來的回應（規格 §5.1 修正）。
        response = await fetch(`${INTERVALS_ICU_PROXY_URL}?eventId=${encodeURIComponent(eventId)}&_t=${Date.now()}`, {
          cache: 'no-store',
        });
      } catch {
        uploadView.showError('連線代理服務失敗，請確認網路連線後再試一次。');
        return;
      }

      if (!response.ok) {
        const message = await extractProxyErrorMessage(response);
        uploadView.showError(message);
        return;
      }

      const xmlText = await response.text();
      loadWorkout(() => parseZwoXml(xmlText), '無法解析 intervals.icu 回傳的課表：');
    } finally {
      uploadView.setIntervalsIcuLoading(false);
    }
  }

  // App 開機時檢查 localStorage 有沒有還沒完成的排程（規格：切換分頁／背景／
  // 短暫關閉瀏覽器再打開，排程要還在）——放在所有畫面／handler 都設好之後
  // 才呼叫，armSchedule() 裡用到的 uploadView／waitingView／playerView 這時
  // 才確定都已經存在。找不到、或存的資料壞掉（loadSchedule() 已經處理過
  // 壞資料回傳 null 的情況）就照原本一樣顯示上傳畫面。
  const restoredSchedule = loadSchedule();
  if (restoredSchedule) {
    armSchedule(restoredSchedule.workout, restoredSchedule.startTimestamp);
  }

  return { client };
}

async function extractProxyErrorMessage(response, serviceName = 'intervals.icu') {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    // response body wasn't JSON - fall through to the generic message below
  }
  return `${serviceName} 代理服務回傳錯誤（HTTP ${response.status}）`;
}
