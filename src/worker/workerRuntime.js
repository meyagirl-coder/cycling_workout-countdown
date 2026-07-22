/**
 * Web Worker 執行核心 — Phase 1 技術規格 §4.1
 *
 * 把 timerEngine 搬進 Web Worker 執行，主執行緒只透過 postMessage 送出指令
 * （play/pause/skip/redo/stop/adjustPower），worker 內部用 setInterval 定期呼叫
 * engine.tick(now)，再把最新狀態 post 回主執行緒。
 *
 * 這裡刻意把「跟 self / postMessage 綁定」的部分抽掉，換成依賴注入
 * （postMessage / setIntervalFn / clearIntervalFn / now），這樣測試時可以完全
 * 掌控時間與 interval 觸發時機，直接模擬「分頁切到背景、setInterval 被降頻」
 * 的情境，而不需要真的啟動一個 Worker 執行緒。真正的 timerWorker.js 只是把這
 * 個 runtime 接到瀏覽器的 self.onmessage / self.postMessage 上的薄薄一層。
 */
import { createTimerEngine } from '../engine/timerEngine.js';

const DEFAULT_TICK_INTERVAL_MS = 200;

export function createWorkerRuntime({
  postMessage,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
} = {}) {
  let engine = null;
  let intervalId = null;

  function emit(events) {
    postMessage({ type: 'state', state: engine.getState(), events });
  }

  function startLoop() {
    if (intervalId !== null) return;
    intervalId = setIntervalFn(() => {
      const { events } = engine.tick(now());
      emit(events);
      stopLoopIfFinished();
    }, tickIntervalMs);
  }

  function stopLoop() {
    if (intervalId !== null) {
      clearIntervalFn(intervalId);
      intervalId = null;
    }
  }

  function stopLoopIfFinished() {
    if (engine.getState().status === 'finished') stopLoop();
  }

  function requireEngine() {
    if (!engine) {
      throw new Error('workerRuntime: received a command before "init" — no workout loaded yet');
    }
    return engine;
  }

  function handleMessage(message) {
    switch (message.type) {
      case 'init': {
        engine = createTimerEngine(message.workout);
        emit([]);
        return;
      }
      case 'restore': {
        // 頁面重新整理後復原之前存在 localStorage 的進度（見
        // workoutProgressStore.js）——跟 'init' 一樣建立全新的 engine 實例，
        // 差別是接著呼叫 engine.restore() 把 elapsedTotal／powerAdjustPct／
        // status 設回存檔當下的樣子，不是從頭（elapsedTotal 0、idle）開始。
        engine = createTimerEngine(message.workout);
        const { events } = engine.restore({
          elapsedTotal: message.elapsedTotal,
          powerAdjustPct: message.powerAdjustPct,
          status: message.status,
        });
        emit(events);
        return;
      }
      case 'play': {
        const { events } = requireEngine().play(now());
        startLoop();
        emit(events);
        stopLoopIfFinished();
        return;
      }
      case 'pause': {
        const { events } = requireEngine().pause(now());
        stopLoop();
        emit(events);
        return;
      }
      case 'skip': {
        const { events } = requireEngine().skip(now());
        emit(events);
        stopLoopIfFinished();
        return;
      }
      case 'redo': {
        const { events } = requireEngine().redo(now());
        emit(events);
        return;
      }
      case 'stop': {
        const { events } = requireEngine().stop(now());
        stopLoop();
        emit(events);
        return;
      }
      case 'adjustPower': {
        const { events } = requireEngine().adjustPower(message.delta);
        emit(events);
        return;
      }
      default:
        throw new Error(`workerRuntime: unknown message type "${message.type}"`);
    }
  }

  return {
    handleMessage,
    stopLoop,
    isLoopRunning: () => intervalId !== null,
    getState: () => (engine ? engine.getState() : null),
  };
}
