import { extractEventId } from '../integrations/intervalsIcu.js';
import { parseZwoXml } from '../parser/zwoParser.js';
import { createTimerWorkerClient } from '../worker/timerWorkerClient.js';
import { createAppBanner } from './appBanner.js';
import { handleTimerEvents, playCountdownBeep, speakCountdownWarning } from './countdownAlerts.js';
import { createPlayerView } from './renderPlayer.js';
import { createUploadView } from './uploadView.js';

// TODO(Phase 1 步驟 7): 改讀 localStorage 的 user_ftp，目前先寫死方便先跑通上傳流程。
const DEFAULT_FTP = 200;

const INTERVALS_ICU_PROXY_URL = '/api/intervals-zwo';

/**
 * 執行頁的組裝入口：先顯示上傳畫面，使用者可以選 .zwo 檔案，或貼 intervals.icu
 * 課表網址／ID 透過 /api/intervals-zwo 這個 Vercel Serverless Function 代理下載。
 * 不管哪種來源，拿到 XML 字串後都用同一個 parseZwoXml() 解析成 Workout JSON，
 * 成功才切到執行頁並接上 Web Worker 計時引擎；解析或下載失敗則在上傳畫面顯示
 * 錯誤訊息，讓使用者重試。
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

  const uploadView = createUploadView(uploadMount, {
    onFileSelected: (file) => handleFileSelected(file),
    onIntervalsIcuSubmit: (rawText) => handleIntervalsIcuSubmit(rawText),
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
    uploadMount.classList.remove('hidden');
    appBanner.show();
    uploadView.clearError();
    currentWorkout = null;
  }

  client.onUpdate((state, events) => {
    latestState = state;
    if (!currentWorkout) return;

    playerView.update(currentWorkout, state, DEFAULT_FTP);
    handleTimerEvents(events, {
      workout: currentWorkout,
      state,
      ftp: DEFAULT_FTP,
      playBeep: playCountdownBeep,
      speak: speakCountdownWarning,
      showNextIntervalBanner: playerView.showNextIntervalBanner,
    });
  });

  /** 解析成功就切到執行頁；失敗就把訊息顯示在上傳畫面，回傳是否成功 */
  function loadWorkoutFromXml(xmlText, errorPrefix) {
    let workout;
    try {
      workout = parseZwoXml(xmlText);
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

    loadWorkoutFromXml(xmlText, '無法解析這份 .zwo 檔案：');
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
        response = await fetch(`${INTERVALS_ICU_PROXY_URL}?eventId=${encodeURIComponent(eventId)}`);
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
      loadWorkoutFromXml(xmlText, '無法解析 intervals.icu 回傳的課表：');
    } finally {
      uploadView.setIntervalsIcuLoading(false);
    }
  }

  return { client };
}

async function extractProxyErrorMessage(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === 'string') return body.error;
  } catch {
    // response body wasn't JSON - fall through to the generic message below
  }
  return `intervals.icu 代理服務回傳錯誤（HTTP ${response.status}）`;
}
