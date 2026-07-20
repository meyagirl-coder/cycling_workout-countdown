import { parseZwoXml } from '../parser/zwoParser.js';
import { createTimerWorkerClient } from '../worker/timerWorkerClient.js';
import { createPlayerView } from './renderPlayer.js';
import { createUploadView } from './uploadView.js';

// TODO(Phase 1 步驟 7): 改讀 localStorage 的 user_ftp，目前先寫死方便先跑通上傳流程。
const DEFAULT_FTP = 200;

/**
 * 執行頁的組裝入口：先顯示上傳畫面，使用者選好 .zwo 檔案後用 parseZwoXml()
 * 解析成 Workout JSON，成功才切到執行頁並接上 Web Worker 計時引擎；解析失敗
 * 則在上傳畫面顯示錯誤訊息，讓使用者重新選檔案。
 *
 * @param {HTMLElement} rootEl
 * @returns {{ client: ReturnType<typeof createTimerWorkerClient> }}
 */
export function initPlayerApp(rootEl) {
  rootEl.innerHTML = '<div class="upload-mount"></div><div class="player-mount hidden"></div>';
  const uploadMount = rootEl.querySelector('.upload-mount');
  const playerMount = rootEl.querySelector('.player-mount');

  const client = createTimerWorkerClient();
  let latestState = null;
  let currentWorkout = null;

  const uploadView = createUploadView(uploadMount, {
    onFileSelected: (file) => handleFileSelected(file),
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
  });

  client.onUpdate((state) => {
    latestState = state;
    if (currentWorkout) playerView.update(currentWorkout, state, DEFAULT_FTP);
  });

  async function handleFileSelected(file) {
    uploadView.clearError();

    let xmlText;
    try {
      xmlText = await file.text();
    } catch {
      uploadView.showError('讀取檔案失敗，請再試一次。');
      return;
    }

    let workout;
    try {
      workout = parseZwoXml(xmlText);
    } catch (err) {
      uploadView.showError(`無法解析這份 .zwo 檔案：${err.message}`);
      return;
    }

    currentWorkout = workout;
    client.init(workout);
    uploadMount.classList.add('hidden');
    playerMount.classList.remove('hidden');
  }

  return { client };
}
