/** 目前這組剩餘秒數 → "mm:ss"，符合規格 §5 的倒數計時顯示格式 */
export function formatMMSS(totalSeconds) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 課表總時長標示：超過一小時才顯示時數，否則就是 mm:ss */
export function formatDurationLabel(totalSeconds) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 口語化的「X 分鐘」／「X 秒」／「X 分 Y 秒」時長標示，給倒數 10 秒的下一組
 * 預告用（視覺 banner 跟語音都唸這個格式，比 mm:ss 更適合唸出來、也更符合
 * 「下一組：5 分鐘 · 75% FTP」這種提示文字的語氣）。
 */
export function formatMinuteSecondLabel(totalSeconds) {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;

  if (minutes === 0) return `${seconds} 秒`;
  if (seconds === 0) return `${minutes} 分鐘`;
  return `${minutes} 分 ${seconds} 秒`;
}

/**
 * 排定開始時間的人類可讀格式，例如 "2026/07/24 20:00"——「已設定開始時間」
 * 狀態顯示（uploadView.js）跟「一鍵開團連結」的加入確認畫面
 * （groupJoinConfirmView.js）共用同一個格式，不重複寫一份。
 */
export function formatDateTimeLabel(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}
