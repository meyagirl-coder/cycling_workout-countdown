/**
 * 從使用者貼上的 intervals.icu 課表網址或純數字 ID 中取出 event ID。
 * intervals.icu 的課表連結格式不只一種（行事曆連結、workout builder 連結…），
 * 但 event ID 固定是網址裡最後一段數字，所以直接抓字串裡最後一串數字即可，
 * 不用死板地比對特定網址格式。
 *
 * @param {string} rawInput
 * @returns {string | null} event ID（數字字串），抓不到就回傳 null
 */
export function extractEventId(rawInput) {
  const trimmed = typeof rawInput === 'string' ? rawInput.trim() : '';
  if (!trimmed) return null;

  const matches = trimmed.match(/\d+/g);
  if (!matches || matches.length === 0) return null;

  return matches[matches.length - 1];
}
