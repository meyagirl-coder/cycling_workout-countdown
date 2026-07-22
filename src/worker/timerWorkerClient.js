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
    /**
     * 從先前存下來的進度復原（頁面重新整理後用，見 workoutProgressStore.js），
     * 跟 init() 一樣會建立全新的 engine，差別是接著把狀態設回存檔當下的
     * elapsedTotal／powerAdjustPct／status，不是從頭開始。永遠不會恢復成
     * running，只會是 idle／paused／finished（見 timerEngine.js 的 restore()）。
     *
     * @param {object} workout
     * @param {{ elapsedTotal: number, powerAdjustPct?: number, status?: string }} savedState
     */
    restore(workout, savedState) {
      send({ type: 'restore', workout, ...savedState });
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
