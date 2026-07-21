import { extractEventId } from '../integrations/intervalsIcu.js';
import { parsePasteText } from '../parser/pasteTextParser.js';
import { parseAutoDetectedPasteText } from '../parser/pasteTextRouter.js';
import { parseWhatsOnZwiftText } from '../parser/whatsOnZwiftParser.js';
import { parseZwoXml } from '../parser/zwoParser.js';
import { createTimerWorkerClient } from '../worker/timerWorkerClient.js';
import { createAppBanner } from './appBanner.js';
import { handleTimerEvents, playCountdownBeep, speakCountdownWarning } from './countdownAlerts.js';
import { DEFAULT_FTP, loadFtp, saveFtp } from './ftpStore.js';
import { createPlayerView } from './renderPlayer.js';
import { createUploadView } from './uploadView.js';

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
 * @param {HTMLElement} rootEl
 * @returns {{ client: ReturnType<typeof createTimerWorkerClient> }}
 */
export function initPlayerApp(rootEl) {
  rootEl.innerHTML =
    '<div class="app-banner-mount"></div><div class="upload-mount"></div><div class="player-mount hidden"></div>';
  const bannerMount = rootEl.querySelector('.app-banner-mount');
  const uploadMount = rootEl.querySelector('.upload-mount');
  const playerMount = rootEl.querySelector('.player-mount');

  const appBanner = createAppBanner(bannerMount);

  const client = createTimerWorkerClient();
  let latestState = null;
  let currentWorkout = null;

  // 規格 §6：App 啟動時讀 localStorage 的 user_ftp；沒設定過就先用預設值，
  // 畫面上（FTP 輸入欄位）會清楚顯示這個數字，使用者隨時可以改。
  let currentFtp = loadFtp() ?? DEFAULT_FTP;

  const uploadView = createUploadView(uploadMount, {
    onFileSelected: (file) => handleFileSelected(file),
    onIntervalsIcuSubmit: (rawText) => handleIntervalsIcuSubmit(rawText),
    onPasteTextSubmit: (rawText) => handlePasteTextSubmit(rawText),
    onTrainerDayUrlSubmit: (url) => handleTrainerDayUrlSubmit(url),
    onWhatsOnZwiftUrlSubmit: (url) => handleWhatsOnZwiftUrlSubmit(url),
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

  /** 解析成功就切到執行頁；失敗就把訊息顯示在上傳畫面，回傳是否成功 */
  function loadWorkout(parseFn, errorPrefix) {
    let workout;
    try {
      workout = parseFn();
    } catch (err) {
      uploadView.showError(`${errorPrefix}${err.message}`);
      return false;
    }

    currentWorkout = workout;
    client.init(workout);
    appBanner.hide();
    uploadMount.classList.add('hidden');
    playerMount.classList.remove('hidden');
    return true;
  }

  async function handleFileSelected(file) {
    uploadView.clearError();

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
    uploadView.setPasteLoading(true);
    try {
      let response;
      try {
        response = await fetch(`${proxyUrl}?url=${encodeURIComponent(url)}&_t=${Date.now()}`, {
          cache: 'no-store',
        });
      } catch {
        uploadView.showError('連線代理服務失敗，請確認網路連線後再試一次，或改用「直接複製貼上文字內容」。');
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
      uploadView.setPasteLoading(false);
    }
  }

  function handleTrainerDayUrlSubmit(url) {
    return handleRemoteWorkoutUrlSubmit(url, {
      proxyUrl: TRAINERDAY_PROXY_URL,
      parseText: parsePasteText,
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
