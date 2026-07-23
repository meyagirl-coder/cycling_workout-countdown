import { extractEventId } from '../integrations/intervalsIcu.js';
import { parseAutoDetectedPasteText } from '../parser/pasteTextRouter.js';
import { parseTrainerDayWorkoutStructureText } from '../parser/trainerDayWorkoutStructureParser.js';
import { parseWhatsOnZwiftText } from '../parser/whatsOnZwiftParser.js';
import { parseZwoXml } from '../parser/zwoParser.js';
import { createTimerWorkerClient } from '../worker/timerWorkerClient.js';
import { loadAlertMode, saveAlertMode } from './alertModeStore.js';
import { createAppBanner } from './appBanner.js';
import { handleTimerEvents, playCountdownBeeps, speakCountdownWarning, unlockAudioAndSpeechForAutoplay } from './countdownAlerts.js';
import { clearDraftInputs, loadDraftInputs, saveDraftInputs } from './draftInputStore.js';
import { formatMinuteSecondLabel } from './formatTime.js';
import { DEFAULT_FTP, loadFtp, saveFtp } from './ftpStore.js';
import { parseGroupJoinParams } from './groupJoinLinkParser.js';
import { createPlayerView } from './renderPlayer.js';
import { createScheduledStartRuntime } from './scheduledStartRuntime.js';
import { clearSchedule, loadSchedule, saveSchedule } from './scheduleStore.js';
import { createThemeToggle } from './themeToggle.js';
import { createUploadView } from './uploadView.js';
import { createWaitingView } from './waitingView.js';
import { clearWorkoutProgress, loadWorkoutProgress, saveWorkoutProgress } from './workoutProgressStore.js';

const INTERVALS_ICU_PROXY_URL = '/api/intervals-zwo';
const TRAINERDAY_PROXY_URL = '/api/trainerday-workout';
const WHATSONZWIFT_PROXY_URL = '/api/whatsonzwift-workout';

// 「一鍵開團連結」偵測到這台裝置從沒設定過 FTP 時，「先跳過」選項存的預設值
// ——刻意跟一般（沒有透過開團連結進來時）FTP 欄位顯示的預設值 DEFAULT_FTP
// （200）分開：這裡的目的是讓使用者能先加入團練、之後隨時回來調整，用一個
// 保守、不會讓瓦數建議偏高的低預設值比較合理，不是「猜一個接近真實 FTP 的
// 數字」。
const GROUP_JOIN_DEFAULT_FTP = 100;

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
 * 頁面狀態保存（重新整理／切分頁再切回來不遺失資料）：
 *   - 上傳畫面的「貼課表網址」「貼上課表文字內容」草稿內容 debounce 後存進
 *     localStorage（draftInputStore.js），開機時如果有存過就帶回輸入框。
 *   - 執行頁「目前這份課表＋目前進度」（不只是計時器狀態，課表資料本身也
 *     一起存）在 client.onUpdate() 收到新狀態時存進 localStorage
 *     （workoutProgressStore.js）；開機時如果沒有排程要復原，改檢查有沒有
 *     這筆進度，有的話透過 client.restore()（不是 client.init()）復原到
 *     「同一份課表、停在同一個進度點」，狀態固定回到 paused／idle／
 *     finished（永遠不會自動恢復成 running，見 timerEngine.js 的
 *     restore()）。使用者按下「回到主畫面」時清掉這筆進度（returnToHome()）。
 *     存檔本身用 saveWorkoutProgressThrottled() 包一層：running 狀態下最多
 *     每秒存一次（不是跟著 Worker 的 200ms tick 每次都存），復原精度上完全
 *     夠用；任何失敗（例如瀏覽器判定 localStorage quota 已滿）只在 console
 *     留錯誤，不會拋出去中斷同一個 tick 裡排在後面的畫面渲染／提示邏輯——
 *     這是修過一次真實回報的當機（長時間播放中途畫面卡死不動）之後補上的
 *     保護，跟 countdownAlerts.js 已經有的同類型錯誤隔離是同一套邏輯。
 *   - 兩者都用「當天」當簡單的過期規則（見 utils/localDate.js）：隔天重新
 *     整理不會忽然冒出好幾天前殘留的草稿或進度。
 *
 * @param {HTMLElement} rootEl
 * @returns {{ client: ReturnType<typeof createTimerWorkerClient> }}
 */
export function initPlayerApp(rootEl) {
  rootEl.innerHTML =
    '<div class="theme-toggle-mount"></div><div class="app-banner-mount"></div><div class="upload-mount"></div><div class="waiting-mount hidden"></div><div class="player-mount hidden"></div>';
  const themeToggleMount = rootEl.querySelector('.theme-toggle-mount');
  const bannerMount = rootEl.querySelector('.app-banner-mount');
  const uploadMount = rootEl.querySelector('.upload-mount');
  const waitingMount = rootEl.querySelector('.waiting-mount');
  const playerMount = rootEl.querySelector('.player-mount');

  // 主題切換不屬於任何單一畫面（跟 app-banner 只在首頁顯示不同），上傳畫面／
  // 等待畫面／執行頁都要看得到、都能切換，所以掛載在最外層，不放進任何一個
  // 會被 hidden 的 *-mount 容器裡。
  createThemeToggle(themeToggleMount);

  const appBanner = createAppBanner(bannerMount);

  const client = createTimerWorkerClient();
  let latestState = null;
  let currentWorkout = null;

  // 規格 §6：App 啟動時讀 localStorage 的 user_ftp；沒設定過就先用預設值，
  // 畫面上（FTP 輸入欄位）會清楚顯示這個數字，使用者隨時可以改。
  let currentFtp = loadFtp() ?? DEFAULT_FTP;

  // 規格 §4.4：倒數提示模式（語音報數／逼逼聲倒數，見 alertModeStore.js），
  // 兩者互斥，預設語音報數（維持既有行為，不影響老使用者）。
  let currentAlertMode = loadAlertMode();

  // 團體訓練排程：使用者按下「設定」時先記在這裡（還沒有課表可以配對），
  // 等下一次任何方式的課表載入成功時才真正套用、存進 localStorage、清掉這個
  // 暫存值（見 loadWorkout()）。scheduleRuntime 是等待畫面倒數用的可停止
  // 計時器（見 scheduledStartRuntime.js），同時間最多只有一個在跑。
  let pendingScheduledStartTimestamp = null;
  let scheduleRuntime = null;

  // 「一鍵開團連結」進來時，如果這台裝置還沒設定過 FTP，先把解析好的開團
  // 資訊記在這裡，等使用者透過 FTP 欄位輸入或按下「先跳過」解決 FTP 之後
  // 才真正繼續（見 resumePendingGroupJoinIfAny()）。
  let pendingGroupJoin = null;

  // saveWorkoutProgressThrottled() 用來判斷「這一整秒存過了沒」，見下方定義。
  let lastSavedProgressElapsedSecond = null;

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
      resumePendingGroupJoinIfAny();
    },
    onFtpSkipToDefault: () => {
      currentFtp = GROUP_JOIN_DEFAULT_FTP;
      saveFtp(GROUP_JOIN_DEFAULT_FTP);
      uploadView.setFtpValue(GROUP_JOIN_DEFAULT_FTP);
      resumePendingGroupJoinIfAny();
    },
    onAlertModeChange: (mode) => {
      currentAlertMode = mode;
      saveAlertMode(mode);
    },
    onDraftInputChange: (draft) => saveDraftInputs(draft),
  });
  uploadView.setFtpValue(currentFtp);
  uploadView.setAlertMode(currentAlertMode);

  // 上傳畫面的「貼課表網址」「貼上課表文字內容」草稿：開機時如果有存過
  // （而且是今天存的，見 draftInputStore.js）就帶回輸入框，不用重新打字。
  const restoredDraft = loadDraftInputs();
  if (restoredDraft) {
    uploadView.setDraftInputs(restoredDraft);
  }

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
    // 使用者主動離開執行頁了，不再是「目前正在進行的課表」——清掉存檔，
    // 避免下次開機時把已經離開的課表又復原回來（見 workoutProgressStore.js）。
    clearWorkoutProgress();
  }

  /**
   * saveWorkoutProgress() 的節流＋錯誤隔離包裝（規格：真實回報過長時間播放
   * 中途畫面卡死不動，見上方模組說明）：
   *   - running 狀態下，同一個「整數秒」只存一次，不是每個 200ms 的 Worker
   *     tick 都存（88 分鐘的課表沒節流的話等於連續寫入 localStorage 兩萬多
   *     次）——復原用途本來就只需要抓到大概的進度點，差個一秒以內完全感覺
   *     不出來。非 running 狀態（idle／paused／finished）不節流，一定立刻
   *     存，因為這類狀態改變是離散事件、不會像 running tick 一樣高頻重複
   *     觸發，該存的時候（例如使用者按下暫停）要立刻反映，不能被節流延後。
   *   - 呼叫本身包 try-catch：`localStorage.setItem()` 在某些情況下會丟出
   *     例外（例如瀏覽器判定 quota 已滿），沒有這層保護的話，例外會一路
   *     往外拋、中斷 client.onUpdate() 這個 callback 當下排在後面（甚至下
   *     一輪 tick）的畫面渲染——這裡的呼叫點特意放在 playerView.update() 之
   *     後，就算存檔失敗，畫面至少已經先更新過了。
   */
  function saveWorkoutProgressThrottled(workout, state) {
    if (state.status === 'running') {
      const currentSecond = Math.floor(state.elapsedTotal);
      if (currentSecond === lastSavedProgressElapsedSecond) return;
      lastSavedProgressElapsedSecond = currentSecond;
    } else {
      lastSavedProgressElapsedSecond = Math.floor(state.elapsedTotal);
    }

    try {
      saveWorkoutProgress(workout, state);
    } catch (err) {
      console.error('playerApp: saveWorkoutProgress() failed', err);
    }
  }

  client.onUpdate((state, events) => {
    latestState = state;
    if (!currentWorkout) return;

    // 畫面渲染／提示邏輯放在存檔之前：存檔本身包了 try-catch（見下方
    // saveWorkoutProgressThrottled()），但即使沒包，也不該讓存檔的失敗擋住
    // 這次 tick 該做的畫面更新跟語音/嗶聲提示——這是這個專案已經在
    // countdownAlerts.js 修過一次的同類型 bug（見該檔案「使用者回報過語音
    // 播放中途出錯，後續提示全部消失」的說明），這裡的存檔呼叫也要有一樣
    // 的隔離：任何一步的失敗都不該拖累其他步驟。
    playerView.update(currentWorkout, state, currentFtp);
    saveWorkoutProgressThrottled(currentWorkout, state);
    handleTimerEvents(events, {
      workout: currentWorkout,
      state,
      ftp: currentFtp,
      alertMode: currentAlertMode,
      speak: speakCountdownWarning,
      playCountdownBeeps,
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

  /**
   * 課表資料就緒（不管是新解析的、排程流程給的、還是開機時從
   * workoutProgressStore.js 復原的）切到執行頁的共用邏輯。
   *
   * @param {object} workout
   * @param {{elapsedTotal: number, powerAdjustPct: number, status: string}} [restoreState] -
   *   有給就呼叫 client.restore() 復原到這個進度點；不給（一般載入新課表的
   *   情況）就呼叫 client.init() 從頭開始，跟原本行為一致。
   */
  function switchToPlayerScreen(workout, restoreState) {
    currentWorkout = workout;
    if (restoreState) {
      client.restore(workout, restoreState);
    } else {
      client.init(workout);
    }
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
      startScheduledWorkoutNow(workout, startTimestamp);
    } else {
      enterWaitingScreen(workout, startTimestamp);
    }
  }

  /**
   * 排定時間已經到了或已經過去（一開機就發現已經過去、等待畫面倒數到 0、
   * 或一鍵開團連結帶的 startTime 已經過去）：清掉排程紀錄，跳到「現在時間
   * 減掉排定時間」等於過去了幾秒對應的組別／組內剩餘秒數，直接動態進行中
   * 繼續播放——不是從第一組、0 分鐘重新開始（regression：使用者實測遲到
   * 35 分鐘點開開團連結，畫面卻從頭播放，遲到的人完全跟不上團練當下真正
   * 在跑的組別），也不是靜靜停在那個時間點暫停（那樣使用者還要自己按一次
   * 播放才會動）。
   *
   * `client.restore()` 本身設計上永遠不會把狀態設回 running（是給「重新
   * 整理頁面」用，需要使用者自己按播放才會恢復播放，見 timerEngine.js 的
   * restore() 說明）——這裡緊接著呼叫 client.play()，讓它從剛剛還原的
   * elapsedTotal 這個位置往前跑：play() 是用「現在時間 - elapsedTotal」
   * 反推 startTimestamp，之後 tick() 就會自然地從這個位置即時往前推進，
   * 達到「跳到對應組別＋動態進行中」的效果，不需要另外設計一個新的引擎
   * API。
   *
   * 過去的時間如果已經超過整份課表的總時長（例如課表只有 30 分鐘但已經
   * 過去 40 分鐘），沒有一個「對應的組別」可以跳，顯示「課表已結束」提示，
   * 停留在目前畫面（通常是上傳畫面），不會嘗試切到執行頁。
   */
  function startScheduledWorkoutNow(workout, startTimestamp) {
    stopScheduleRuntimeIfRunning();
    clearSchedule();

    const elapsedSeconds = Math.max(0, (Date.now() - startTimestamp) / 1000);
    if (elapsedSeconds >= workout.totalDuration) {
      uploadView.showError(
        `課表已結束：設定的開始時間已經過去 ${formatMinuteSecondLabel(elapsedSeconds)}，超過這份課表 ${formatMinuteSecondLabel(workout.totalDuration)} 的總時長，請重新設定開始時間，或直接手動開始播放。`
      );
      return;
    }

    switchToPlayerScreen(workout, { elapsedTotal: elapsedSeconds, powerAdjustPct: 0, status: 'paused' });
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
      onReached: () => startScheduledWorkoutNow(workout, startTimestamp),
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

  /**
   * 「一鍵開團連結」網址參數解析成功、且 FTP 也確定好了（不管是使用者輸入
   * 還是按了「先跳過」）之後才真正繼續：設定排程開始時間，並依 source 呼叫
   * 對應的課表下載/解析流程——這條路完全沿用「手動貼網址前先按過『設定開始
   * 時間』」的既有邏輯（loadWorkout() 偵測到 pendingScheduledStartTimestamp
   * 就會自動走 armSchedule()），不用另外重新實作一次排程判斷。
   */
  function startGroupJoinFlow({ source, sourceUrl, startTime }) {
    pendingScheduledStartTimestamp = startTime.getTime();

    // 跟 handleScheduledStartTimeSet() 不同：這裡是頁面載入當下自動觸發，不是
    // 使用者按鈕點擊的當下，瀏覽器的自動播放權限解鎖
    // （unlockAudioAndSpeechForAutoplay()）需要「使用者互動當下」的呼叫堆疊
    // 才有效，這裡沒有那個時機，所以不呼叫——語音／嗶聲提示可能要等使用者在
    // 頁面上做過一次真正的互動（例如點擊任何按鈕）之後才會正常播放，這是
    // 瀏覽器自動播放政策的既有限制，不是這裡漏寫。

    // source 目前只支援 'TD'（parseGroupJoinParams() 已經驗證過，這裡不會是
    // 其他值），未來擴充 TP／intervals.icu 時在這裡加對應的呼叫就好。
    if (source === 'TD') {
      handleTrainerDayUrlSubmit(sourceUrl);
    }
  }

  /** FTP 確定好了，如果有暫存的開團連結資訊就收起提示、繼續執行 */
  function resumePendingGroupJoinIfAny() {
    if (!pendingGroupJoin) return;
    const groupJoin = pendingGroupJoin;
    pendingGroupJoin = null;
    uploadView.hideFtpSetupPrompt();
    startGroupJoinFlow(groupJoin);
  }

  /**
   * App 開機時檢查網址有沒有帶「一鍵開團連結」參數（source／source_url／
   * startTime，見 groupJoinLinkParser.js）——只有在沒有排程／進度可以復原的
   * 全新開機才會走到這裡（見下方呼叫處），避免蓋掉使用者原本正在進行中的
   * 排程或課表。
   *
   * 三種結果：
   *   1. 網址完全沒帶開團參數（一般開啟方式）：parseGroupJoinParams() 回傳
   *      null，什麼都不做，正常顯示上傳畫面。
   *   2. 帶了但格式錯誤／缺漏／來源不支援：丟出例外，直接顯示清楚的錯誤
   *      訊息在上傳畫面，不會讓使用者卡在一個看不懂發生什麼事的畫面。
   *   3. 合法：檢查這台裝置有沒有設定過 FTP，沒有就先跳出提示（可以先跳過用
   *      100W），有設定過就直接繼續（下載課表＋設定排程）。
   */
  function handleGroupJoinLinkBoot() {
    const searchParams = new URLSearchParams(window.location.search);

    let groupJoin;
    try {
      groupJoin = parseGroupJoinParams(searchParams);
    } catch (err) {
      uploadView.showError(err.message);
      return;
    }
    if (!groupJoin) return;

    if (loadFtp() === null) {
      pendingGroupJoin = groupJoin;
      uploadView.showFtpSetupPrompt();
      return;
    }

    startGroupJoinFlow(groupJoin);
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
  //
  // 排程優先於「執行中課表進度」復原：兩者理論上不會同時有意義的資料（一個
  // 代表「還沒開始、等排定時間」，一個代表「已經在執行頁上」），但如果真的
  // 兩筆都存在，排程是使用者更晚、更明確設定的動作，優先處理；只有沒有
  // 排程要復原時才檢查有沒有進行中的課表進度。
  const restoredSchedule = loadSchedule();
  if (restoredSchedule) {
    armSchedule(restoredSchedule.workout, restoredSchedule.startTimestamp);
  } else {
    const restoredProgress = loadWorkoutProgress();
    if (restoredProgress) {
      switchToPlayerScreen(restoredProgress.workout, {
        elapsedTotal: restoredProgress.elapsedTotal,
        powerAdjustPct: restoredProgress.powerAdjustPct,
        status: restoredProgress.status,
      });
    } else {
      // 兩者都沒有時才檢查網址是不是「一鍵開團連結」——避免蓋掉使用者原本
      // 已經在進行中的排程／課表進度（見 handleGroupJoinLinkBoot() 的說明）。
      handleGroupJoinLinkBoot();
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
