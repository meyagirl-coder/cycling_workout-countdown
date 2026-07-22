/**
 * 瀏覽器本地日期（YYYY-MM-DD），用 local getter 而不是 UTC getter，故意跟
 * 伺服器時區脫鉤（見 api/intervals-events.js 的說明）。多個 localStorage
 * 暫存機制（草稿輸入、執行中課表進度）都用同一個「今天」定義判斷是否過期，
 * 抽出來共用，不要各自維護一份。
 */
export function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
