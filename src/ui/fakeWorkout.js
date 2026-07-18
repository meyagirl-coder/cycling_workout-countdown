/**
 * 假資料課表，只用來在真的接上檔案上傳／parser 之前(規格開發順序 步驟4)測試
 * 執行頁畫面。時長刻意壓短（50 秒）方便手動在瀏覽器裡看完整個切組流程。
 */
export const FAKE_WORKOUT = {
  id: 'demo-fake-workout-001',
  name: '假資料測試課表（Demo Workout）',
  source: 'zwo',
  totalDuration: 50,
  intervals: [
    { type: 'warmup', duration: 12, powerStart: 50, powerEnd: 70, cadence: null },
    { type: 'steady', duration: 10, powerStart: 88, powerEnd: 88, cadence: 90 },
    { type: 'ramp', duration: 8, powerStart: 60, powerEnd: 110, cadence: null },
    { type: 'freeride', duration: 8, powerStart: null, powerEnd: null, cadence: null },
    { type: 'cooldown', duration: 12, powerStart: 70, powerEnd: 50, cadence: null },
  ],
};
