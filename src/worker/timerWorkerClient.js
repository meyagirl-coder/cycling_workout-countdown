/**
 * 主執行緒用來操作 timerWorker.js 的薄包裝。UI 層只需要呼叫這裡的方法
 * （init/play/pause/skip/redo/stop/adjustPower）並訂閱 onUpdate，不用直接
 * 碰 postMessage。
 *
 * @param {string | URL} [workerUrl] - 預設載入同目錄的 timerWorker.js
 */
export function createTimerWorkerClient(workerUrl = new URL('./timerWorker.js', import.meta.url)) {
  const worker = new Worker(workerUrl, { type: 'module' });
  const listeners = new Set();

  worker.onmessage = (event) => {
    if (event.data.type === 'state') {
      for (const listener of listeners) listener(event.data.state, event.data.events);
    }
  };

  function send(message) {
    worker.postMessage(message);
  }

  return {
    /** @param {(state: object, events: string[]) => void} listener */
    onUpdate(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    init(workout) {
      send({ type: 'init', workout });
    },
    play() {
      send({ type: 'play' });
    },
    pause() {
      send({ type: 'pause' });
    },
    skip() {
      send({ type: 'skip' });
    },
    redo() {
      send({ type: 'redo' });
    },
    stop() {
      send({ type: 'stop' });
    },
    adjustPower(deltaPct) {
      send({ type: 'adjustPower', delta: deltaPct });
    },
    terminate() {
      worker.terminate();
    },
  };
}
