import { createTimerWorkerClient } from '../worker/timerWorkerClient.js';
import { createPlayerView } from './renderPlayer.js';
import { FAKE_WORKOUT } from './fakeWorkout.js';

// TODO(Phase 1 步驟 7): 改讀 localStorage 的 user_ftp，目前先寫死方便測試畫面。
const FAKE_FTP = 200;

/**
 * 執行頁的組裝入口：接上 Web Worker 計時引擎 + 假資料課表，串起畫面渲染與
 * 按鈕操作。真的 zwo 上傳／parser 串接留到規格開發順序步驟 5。
 *
 * @param {HTMLElement} rootEl
 * @returns {{ client: ReturnType<typeof createTimerWorkerClient> }}
 */
export function initPlayerApp(rootEl) {
  const client = createTimerWorkerClient();
  let latestState = null;

  const view = createPlayerView(rootEl, {
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
    view.update(FAKE_WORKOUT, state, FAKE_FTP);
  });

  client.init(FAKE_WORKOUT);

  return { client };
}
