/**
 * Screen Wake Lock API 包裝：課表執行頁播放中、或等待排程開始的倒數畫面時，
 * 保持螢幕常亮，避免手機裝置自動變暗／鎖螢幕，讓使用者不用一直手動點螢幕
 * 或調整系統的自動鎖定時間。
 *
 * 用工廠函式 + 依賴注入（navigatorRef／documentRef）而不是直接在模組頂層
 * 綁死 window.navigator／document，方便在 jsdom（沒有真的 Wake Lock API）
 * 下用假物件測試，也方便測「這個瀏覽器根本不支援」的降級情境。
 *
 * 相容性：Wake Lock API（`navigator.wakeLock`）不是所有瀏覽器都支援（例如
 * 部分較舊的 Safari／Firefox 版本），呼叫前一定先判斷 `'wakeLock' in
 * navigator` 存不存在；`request()` 本身也可能因為瀏覽器政策（例如低電量
 * 模式、分頁當下不可見）而被拒絕，兩種情況都只在 console 留下錯誤方便除錯，
 * 不會拋出例外、不會跳提示訊息打擾使用者——這個功能本來就是錦上添花，
 * 不支援或申請失敗就安靜地讓瀏覽器維持原本的自動鎖定行為，不影響其他功能
 * 正常運作。
 *
 * 分頁切到背景時，瀏覽器會自動釋放已經拿到的 wake lock（規範行為，不是
 * bug）；切回前景後，如果當下還應該保持螢幕常亮（enable() 之後、還沒呼叫
 * disable()），要重新申請一次，不然螢幕還是會被系統自動鎖定——監聽
 * `visibilitychange`，切回前景（`document.visibilityState === 'visible'`）
 * 時，如果「應該保持常亮」的狀態還是 true、但目前手上沒有有效的 lock，就
 * 重新申請。
 */
export function createWakeLockManager({
  navigatorRef = typeof navigator !== 'undefined' ? navigator : undefined,
  documentRef = typeof document !== 'undefined' ? document : undefined,
} = {}) {
  let currentLock = null;
  // 呼叫端目前「希望」保持螢幕常亮的狀態，不等於「目前手上真的握著一個
  // lock」——分頁切到背景時系統會自動釋放 currentLock，但呼叫端的意圖
  // （例如「課表還在播放中」）並沒有改變，這個旗標是切回前景時判斷要不要
  // 重新申請的依據。
  let desiredActive = false;

  function isSupported() {
    return Boolean(navigatorRef && 'wakeLock' in navigatorRef);
  }

  async function requestLock() {
    if (!isSupported()) return;

    try {
      const lock = await navigatorRef.wakeLock.request('screen');
      currentLock = lock;
      // 系統（不只是我們自己呼叫 disable()）也可能主動釋放這個 lock（例如
      // 分頁切到背景），監聽 release 事件才能讓 currentLock 正確反映「手上
      // 目前還有沒有有效的 lock」，不會誤以為還握著一個其實已經失效的物件。
      lock.addEventListener('release', () => {
        if (currentLock === lock) currentLock = null;
      });
    } catch (err) {
      // 常見原因：瀏覽器政策擋掉（低電量模式）、申請當下分頁剛好不可見、
      // 或裝置根本不允許——安靜失敗，不影響其他功能。
      console.error('wakeLockManager: navigator.wakeLock.request() failed', err);
      currentLock = null;
    }
  }

  function handleVisibilityChange() {
    if (desiredActive && documentRef.visibilityState === 'visible' && !currentLock) {
      requestLock();
    }
  }

  if (documentRef) {
    documentRef.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return {
    /** 開始（或維持）保持螢幕常亮；不支援的瀏覽器或申請失敗都安靜地不做任何事 */
    async enable() {
      desiredActive = true;
      if (currentLock) return; // 已經握著有效的 lock，不用重複申請
      await requestLock();
    },
    /** 不再需要保持螢幕常亮，釋放目前握著的 lock（如果有的話） */
    disable() {
      desiredActive = false;
      if (currentLock) {
        const lock = currentLock;
        currentLock = null;
        lock.release().catch(() => {}); // release() 失敗也不影響——反正就是不再需要它了
      }
    },
    isSupported,
    /** 目前手上是不是真的握著一個有效的 lock（測試／除錯用，不是給一般呼叫端判斷邏輯用） */
    isActive: () => currentLock !== null,
  };
}
