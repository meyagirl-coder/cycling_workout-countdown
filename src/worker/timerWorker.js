/**
 * 真正在瀏覽器 Web Worker 執行緒裡跑的進入點。
 * 所有邏輯都在 workerRuntime.js（可測試），這裡只負責接上
 * self.onmessage / self.postMessage。用 createTimerWorkerClient()
 * 建立這支檔案的 Worker 實例（見 timerWorkerClient.js）。
 */
import { createWorkerRuntime } from './workerRuntime.js';

const runtime = createWorkerRuntime({
  postMessage: (message) => self.postMessage(message),
});

self.onmessage = (event) => runtime.handleMessage(event.data);
